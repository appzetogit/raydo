/**
 * Franchise refund claims: the partner refunded a customer itself and claims it back.
 *
 * Run: node tests/franchise-refund-claims.smoke.mjs
 *
 *   - only the franchise's own delivered / cancelled orders from the last 30 days;
 *   - evidence is required; the amount is capped by what is left on the order after the
 *     platform's own refund and other claims; one open claim per order, even when two race;
 *   - the partner can withdraw a waiting claim, and only its own;
 *   - the admin approves once (wallet credited once, earning on that share taken back) or
 *     rejects with a reason; an approval re-checks the cap against the order as it is now.
 */
import assert from 'node:assert/strict';

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'ci-test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'ci-test-refresh-secret';
process.env.RAZORPAY_KEY_ID = '';
process.env.RAZORPAY_KEY_SECRET = '';

const { default: mongoose } = await import('mongoose');
const { MongoMemoryReplSet } = await import('mongodb-memory-server');
const { default: express } = await import('express');

let failed = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${String(err.stack || err.message).split('\n').slice(0, 4).join('\n        ')}`);
    }
};

const main = async () => {
    const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(mongo.getUri(), { dbName: 'franchise_claims' });

    const { default: authRoutes } = await import('../src/core/auth/auth.routes.js');
    const { default: portalRoutes } = await import('../src/modules/food/franchise/routes/franchisePortal.routes.js');
    const { default: errorHandler } = await import('../src/middleware/errorHandler.js');
    const { FoodAdmin } = await import('../src/core/admin/admin.model.js');
    const { default: FranchiseApplication } = await import('../src/modules/food/admin/models/franchiseApplication.model.js');
    const { default: FranchiseLedger } = await import('../src/modules/food/admin/models/franchiseLedger.model.js');
    const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
    const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
    await import('../src/modules/food/orders/models/foodTransaction.model.js');
    const claimsSvc = await import('../src/modules/food/franchise/services/franchiseRefundClaims.service.js');
    const { creditFoodOrder } = await import('../src/modules/food/admin/services/franchiseLedger.service.js');
    await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).createCollection().catch(() => {})));
    await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).init().catch(() => {})));

    const app = express();
    app.use(express.json());
    app.use('/v1/auth', authRoutes);
    app.use('/v1/franchise', portalRoutes);
    app.use(errorHandler);
    const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const call = async (method, path, { token, body } = {}) => {
        const res = await fetch(`${baseUrl}${path}`, {
            method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        const json = await res.json().catch(() => ({}));
        return { status: res.status, data: json.data, message: json.message };
    };

    const make = async (name, email) => {
        const fr = await FranchiseApplication.create({
            applicantName: name, email, phone: '9500000000', state: 'MP', city: 'Indore', status: 'approved',
            selectedModules: ['food'], franchiseFeeStatus: 'paid',
        });
        const login = await FoodAdmin.create({ email, password: 'Partner-pass-1', name, admin_type: 'franchise', franchiseId: fr._id, isActive: true });
        await FranchiseApplication.updateOne({ _id: fr._id }, { $set: { subAdminId: login._id } });
        const res = await call('POST', '/v1/auth/franchise/login', { body: { email, password: 'Partner-pass-1' } });
        return { fr, token: res.data.accessToken };
    };
    const A = await make('Alpha', 'alpha@test.in');
    const B = await make('Beta', 'beta@test.in');
    const restaurant = (await FoodRestaurant.collection.insertOne({ restaurantName: 'Sapna Sweets' })).insertedId;
    const order = (fields = {}) => FoodOrder.collection.insertOne({
        order_id: `RD${Math.floor(Math.random() * 1e6)}`, restaurantId: restaurant, franchiseId: A.fr._id, orderStatus: 'delivered',
        pricing: { total: 500, restaurantCommission: 80, platformFee: 20 }, payment: { method: 'cash', status: 'paid' },
        createdAt: new Date(), updatedAt: new Date(), ...fields,
    }).then((r) => r.insertedId);

    const delivered = await order();
    const preparing = await order({ orderStatus: 'preparing' });
    const old = await order({ createdAt: new Date(Date.now() - 40 * 86400000) });
    const platformRefunded = await order({ orderStatus: 'cancelled_by_restaurant', payment: { method: 'razorpay', status: 'refunded', refund: { status: 'processed', amount: 300 } } });
    const othersOrder = await order({ franchiseId: B.fr._id });
    await creditFoodOrder(await FoodOrder.findById(delivered).lean());
    const wallet = async () => (await FranchiseApplication.findById(A.fr._id).lean()).walletBalance || 0;
    const good = { paidVia: 'upi', paymentReference: 'UPI4455667788', reason: 'Wrong item delivered, refunded the customer at the door' };

    console.log('\nwhich orders');
    await check("another franchise's order is not found", async () => {
        assert.equal((await call('POST', '/v1/franchise/refund-claims', { token: A.token, body: { ...good, orderId: String(othersOrder), amount: '100' } })).status, 404);
        assert.equal((await call('GET', `/v1/franchise/refund-claims/order/${othersOrder}`, { token: A.token })).status, 404);
    });
    await check('an order still in progress, or older than 30 days, cannot be claimed', async () => {
        assert.equal((await call('POST', '/v1/franchise/refund-claims', { token: A.token, body: { ...good, orderId: String(preparing), amount: '100' } })).status, 400);
        assert.equal((await call('POST', '/v1/franchise/refund-claims', { token: A.token, body: { ...good, orderId: String(old), amount: '100' } })).status, 400);
    });
    await check('the claimable amount excludes what the platform already refunded', async () => {
        const r = await call('GET', `/v1/franchise/refund-claims/order/${platformRefunded}`, { token: A.token });
        assert.equal(r.status, 200, r.message);
        assert.equal(r.data.claimable, 200);
        assert.equal((await call('POST', '/v1/franchise/refund-claims', { token: A.token, body: { ...good, orderId: String(platformRefunded), amount: '250' } })).status, 400);
    });

    console.log('\nfiling');
    await check('evidence is required', async () => {
        const base = { orderId: String(delivered), amount: '100' };
        assert.equal((await call('POST', '/v1/franchise/refund-claims', { token: A.token, body: { ...base, ...good, paidVia: 'gift' } })).status, 400);
        assert.equal((await call('POST', '/v1/franchise/refund-claims', { token: A.token, body: { ...base, ...good, paymentReference: '' } })).status, 400);
        assert.equal((await call('POST', '/v1/franchise/refund-claims', { token: A.token, body: { ...base, ...good, reason: 'bad' } })).status, 400);
        assert.equal((await call('POST', '/v1/franchise/refund-claims', { token: A.token, body: { ...base, ...good, amount: '600' } })).status, 400);
    });
    let firstId;
    await check('two claims on one order at the same moment: one is filed', async () => {
        const body = { ...good, orderId: String(delivered), amount: '200' };
        const results = await Promise.all([1, 2].map(() => call('POST', '/v1/franchise/refund-claims', { token: A.token, body })));
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
        const fr = await FranchiseApplication.findById(A.fr._id).lean();
        assert.equal(fr.refundRequests.filter((c) => c.status === 'claimed_from_admin').length, 1);
        firstId = fr.refundRequests[0].id;
        assert.equal(fr.refundRequests[0].paymentReference, 'UPI4455667788');
    });
    await check('another franchise cannot withdraw it', async () => {
        assert.equal((await call('POST', `/v1/franchise/refund-claims/${firstId}/withdraw`, { token: B.token })).status, 404);
    });
    await check('the partner can withdraw it once, and file again', async () => {
        assert.equal((await call('POST', `/v1/franchise/refund-claims/${firstId}/withdraw`, { token: A.token })).status, 200);
        assert.equal((await call('POST', `/v1/franchise/refund-claims/${firstId}/withdraw`, { token: A.token })).status, 409);
        const r = await call('POST', '/v1/franchise/refund-claims', { token: A.token, body: { ...good, orderId: String(delivered), amount: '200' } });
        assert.equal(r.status, 200, r.message);
        assert.equal(r.data.waiting, 1);
    });

    console.log('\nthe admin decides');
    const waitingId = () => FranchiseApplication.findById(A.fr._id).lean().then((f) => f.refundRequests.find((c) => c.status === 'claimed_from_admin').id);
    await check('a withdrawn claim cannot be approved', async () => {
        await assert.rejects(() => claimsSvc.decideClaim(A.fr._id, firstId, { decision: 'approve' }), /already cancelled/);
    });
    await check('rejecting needs a reason', async () => {
        const wid = await waitingId();
        await assert.rejects(() => claimsSvc.decideClaim(A.fr._id, wid, { decision: 'reject' }), /reason/);
    });
    await check('approving credits the wallet once and takes back the earning on that share', async () => {
        const before = await wallet();
        const id = await waitingId();
        await claimsSvc.decideClaim(A.fr._id, id, { decision: 'approve', adminNote: 'Checked the UPI reference' }, { id: null, name: 'Owner' });
        const rows = await FranchiseLedger.find({ franchiseId: A.fr._id }).lean();
        const reimbursed = rows.filter((r) => r.type === 'refund_reimbursement');
        assert.equal(reimbursed.length, 1);
        assert.equal(reimbursed[0].amount, 200);
        const reversal = rows.find((r) => r.type === 'earning_reversal' && r.refId.endsWith(`claim:${id}`));
        assert.ok(reversal, 'no earning reversal');
        assert.equal(reversal.amount, -40); // 200 of 500 refunded -> 40% of the 100 earned
        assert.ok(await wallet() > before);
        await assert.rejects(() => claimsSvc.decideClaim(A.fr._id, id, { decision: 'approve' }), /already/);
        assert.equal((await FranchiseLedger.find({ type: 'refund_reimbursement' }).lean()).length, 1);
    });
    await check('the partner sees it approved; the cap now counts it', async () => {
        const list = await call('GET', '/v1/franchise/refund-claims', { token: A.token });
        assert.ok(list.data.items.some((c) => c.status === 'approved' && c.amount === 200));
        const left = await call('GET', `/v1/franchise/refund-claims/order/${delivered}`, { token: A.token });
        assert.equal(left.data.claimable, 300);
    });
    await check('an approval re-checks the cap: a platform refund meanwhile blocks it', async () => {
        const r = await call('POST', '/v1/franchise/refund-claims', { token: A.token, body: { ...good, orderId: String(delivered), amount: '300' } });
        assert.equal(r.status, 200, r.message);
        await FoodOrder.collection.updateOne({ _id: delivered }, { $set: { 'payment.refund': { status: 'processed', amount: 100 } } });
        const pendingId = await waitingId();
        await assert.rejects(() => claimsSvc.decideClaim(A.fr._id, pendingId, { decision: 'approve' }), /Only ₹200/);
        await claimsSvc.decideClaim(A.fr._id, await waitingId(), { decision: 'reject', adminNote: 'Platform already refunded part' });
        const list = await call('GET', '/v1/franchise/refund-claims', { token: A.token });
        assert.ok(list.data.items.some((c) => c.status === 'rejected' && c.adminNote));
    });

    server.close();
    await mongoose.disconnect();
    await mongo.stop();
    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
