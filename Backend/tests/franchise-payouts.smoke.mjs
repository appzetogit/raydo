/**
 * Franchise payouts: the partner asks, the platform super admin pays.
 *
 * Run: node tests/franchise-payouts.smoke.mjs
 *
 *   - payee details need the login password, are validated, and are masked when read back;
 *   - a payout goes to the saved payee only, within the available balance and minimum;
 *   - one pending request at a time, even when two arrive at once;
 *   - payee details cannot change while a payout is pending;
 *   - the partner can cancel a pending request, and only their own;
 *   - the admin marking it paid debits the wallet once, and the partner sees the reference.
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
    await mongoose.connect(mongo.getUri(), { dbName: 'franchise_payouts' });

    const { default: authRoutes } = await import('../src/core/auth/auth.routes.js');
    const { default: portalRoutes } = await import('../src/modules/food/franchise/routes/franchisePortal.routes.js');
    const { default: errorHandler } = await import('../src/middleware/errorHandler.js');
    const { FoodAdmin } = await import('../src/core/admin/admin.model.js');
    const { default: FranchiseApplication } = await import('../src/modules/food/admin/models/franchiseApplication.model.js');
    const { default: FranchiseLedger } = await import('../src/modules/food/admin/models/franchiseLedger.model.js');
    const adminService = await import('../src/modules/food/admin/services/franchise.service.js');
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
            selectedModules: ['food'], franchiseFeeStatus: 'paid', minPayoutThreshold: 100,
            walletBalance: 1000, walletBalancePaise: 100000,
        });
        const login = await FoodAdmin.create({ email, password: 'Partner-pass-1', name, admin_type: 'franchise', franchiseId: fr._id, isActive: true });
        await FranchiseApplication.updateOne({ _id: fr._id }, { $set: { subAdminId: login._id } });
        const res = await call('POST', '/v1/auth/franchise/login', { body: { email, password: 'Partner-pass-1' } });
        return { fr, token: res.data.accessToken };
    };
    const A = await make('Alpha', 'alpha@test.in');
    const B = await make('Beta', 'beta@test.in');
    const goodPayee = { accountHolderName: 'Alpha Foods', bankName: 'State Bank', accountNumber: '123456789012', ifscCode: 'sbin0001234', upiId: 'alpha@okaxis', currentPassword: 'Partner-pass-1' };

    console.log('\npayee details');
    await check('a payout needs saved payee details first', async () => {
        const r = await call('POST', '/v1/franchise/payouts', { token: A.token, body: { amount: '200' } });
        assert.equal(r.status, 400);
        assert.match(r.message, /bank account/);
    });
    await check('changing payee details needs the password', async () => {
        assert.equal((await call('PUT', '/v1/franchise/payee', { token: A.token, body: { ...goodPayee, currentPassword: 'wrong-pass' } })).status, 403);
        assert.equal((await call('PUT', '/v1/franchise/payee', { token: A.token, body: { ...goodPayee, currentPassword: undefined } })).status, 403);
    });
    await check('a wrong IFSC, account number or UPI id is refused', async () => {
        assert.equal((await call('PUT', '/v1/franchise/payee', { token: A.token, body: { ...goodPayee, ifscCode: 'SBIN1234' } })).status, 400);
        assert.equal((await call('PUT', '/v1/franchise/payee', { token: A.token, body: { ...goodPayee, accountNumber: '12AB' } })).status, 400);
        assert.equal((await call('PUT', '/v1/franchise/payee', { token: A.token, body: { ...goodPayee, upiId: 'not-a-upi' } })).status, 400);
    });
    await check('valid details are saved, stamped and read back masked', async () => {
        const r = await call('PUT', '/v1/franchise/payee', { token: A.token, body: goodPayee });
        assert.equal(r.status, 200, r.message);
        assert.equal(r.data.payee.ifscCode, 'SBIN0001234');
        assert.ok(r.data.payee.accountNumber.endsWith('9012') && !r.data.payee.accountNumber.includes('12345678'));
        assert.ok(!r.data.payee.upiId.includes('alpha@'));
        assert.ok(r.data.payee.updatedAt);
        const audit = await mongoose.model('FranchiseAuditLog').findOne({ franchiseId: A.fr._id, action: 'payee.updated' }).lean();
        assert.ok(audit);
    });

    console.log('\nrequesting');
    await check('amounts outside the rules are refused', async () => {
        for (const amount of ['50', '2000', '12.345', '-5', 'abc', '0']) {
            const r = await call('POST', '/v1/franchise/payouts', { token: A.token, body: { amount } });
            assert.equal(r.status, 400, `${amount}: ${r.status} ${r.message}`);
        }
    });
    let firstId;
    await check('a valid request goes to the SAVED account, not one sent with it', async () => {
        const r = await call('POST', '/v1/franchise/payouts', { token: A.token, body: { amount: '400', accountNumber: '999999999999', ifscCode: 'HACK0000001' } });
        assert.equal(r.status, 200, r.message);
        assert.equal(r.data.pending.amount, 400);
        assert.equal(r.data.available, 600);
        firstId = r.data.pending.requestId;
        const stored = (await FranchiseApplication.findById(A.fr._id).lean()).payoutRequests.find((p) => p.requestId === firstId);
        assert.equal(stored.accountDetails.accountNumber, '123456789012');
        assert.equal(stored.accountDetails.ifscCode, 'SBIN0001234');
    });
    await check('a second request while one waits is refused', async () => {
        assert.equal((await call('POST', '/v1/franchise/payouts', { token: A.token, body: { amount: '100' } })).status, 409);
    });
    await check('payee details cannot change while a payout waits', async () => {
        assert.equal((await call('PUT', '/v1/franchise/payee', { token: A.token, body: { ...goodPayee, accountNumber: '111122223333' } })).status, 409);
    });
    await check('no full account number on /me, /ledger or /payouts', async () => {
        for (const path of ['/v1/franchise/me', '/v1/franchise/ledger', '/v1/franchise/payouts']) {
            const r = await call('GET', path, { token: A.token });
            assert.equal(r.status, 200, `${path}: ${r.message}`);
            assert.ok(!JSON.stringify(r.data).includes('123456789012'), `${path} leaks the account number`);
        }
    });

    console.log('\ncancelling');
    await check("another franchise cannot cancel it", async () => {
        assert.equal((await call('POST', `/v1/franchise/payouts/${firstId}/cancel`, { token: B.token })).status, 404);
    });
    await check('the partner can cancel it once', async () => {
        const r = await call('POST', `/v1/franchise/payouts/${firstId}/cancel`, { token: A.token });
        assert.equal(r.status, 200, r.message);
        assert.equal(r.data.pending, null);
        assert.equal(r.data.available, 1000);
        assert.equal((await call('POST', `/v1/franchise/payouts/${firstId}/cancel`, { token: A.token })).status, 409);
    });
    await check('the admin cannot pay a cancelled request', async () => {
        await assert.rejects(() => adminService.updatePayoutRequestStatus(A.fr._id, firstId, { status: 'approved', transactionId: 'UTR123456' }), /already cancelled/);
    });

    console.log('\ntwo at once');
    let paidId;
    await check('two requests at the same moment: exactly one is accepted', async () => {
        const results = await Promise.all([
            call('POST', '/v1/franchise/payouts', { token: A.token, body: { amount: '300' } }),
            call('POST', '/v1/franchise/payouts', { token: A.token, body: { amount: '300', method: 'upi' } }),
        ]);
        assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
        const pending = (await FranchiseApplication.findById(A.fr._id).lean()).payoutRequests.filter((p) => p.status === 'pending');
        assert.equal(pending.length, 1);
        paidId = pending[0].requestId;
    });

    console.log('\npaying');
    await check('the admin marks it paid: the wallet is debited once', async () => {
        await adminService.updatePayoutRequestStatus(A.fr._id, paidId, { status: 'approved', transactionId: 'UTR998877' }, { id: null, name: 'Owner' });
        const fr = await FranchiseApplication.findById(A.fr._id).lean();
        assert.equal(fr.walletBalance, 700);
        assert.equal(await FranchiseLedger.countDocuments({ franchiseId: A.fr._id, type: 'payout' }), 1);
        await assert.rejects(() => adminService.updatePayoutRequestStatus(A.fr._id, paidId, { status: 'approved', transactionId: 'UTR998877' }), /already/);
        assert.equal(await FranchiseLedger.countDocuments({ franchiseId: A.fr._id, type: 'payout' }), 1);
    });
    await check('the partner sees it paid, with the reference', async () => {
        const r = await call('GET', '/v1/franchise/payouts', { token: A.token });
        const row = r.data.requests.find((p) => p.requestId === paidId);
        assert.equal(row.status, 'approved');
        assert.equal(row.reference, 'UTR998877');
        assert.equal(r.data.wallet, 700);
    });
    await check('payee details can change again once nothing is pending', async () => {
        assert.equal((await call('PUT', '/v1/franchise/payee', { token: A.token, body: { ...goodPayee, upiId: '' } })).status, 200);
    });

    server.close();
    await mongoose.disconnect();
    await mongo.stop();
    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
