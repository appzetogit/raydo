/**
 * Franchise stage 2: partner logins, scoped to their own franchise.
 *
 * Run: node tests/franchise-portal.smoke.mjs
 *
 *   - a franchise login gets a FRANCHISE token from /auth/franchise/login, and only that;
 *   - the token opens /v1/franchise and is still refused by the admin and taxi APIs;
 *   - everything it reads or changes is its own franchise's: another franchise's riders,
 *     drivers and orders answer 404 or are simply not listed;
 *   - suspending the franchise shuts the session and stops refresh tokens;
 *   - only the agreed writes are mounted (support message, rider and driver decisions).
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
    await mongoose.connect(mongo.getUri(), { dbName: 'franchise_portal' });

    const { default: authRoutes } = await import('../src/core/auth/auth.routes.js');
    const { default: portalRoutes } = await import('../src/modules/food/franchise/routes/franchisePortal.routes.js');
    const { default: errorHandler } = await import('../src/middleware/errorHandler.js');
    const { FoodAdmin } = await import('../src/core/admin/admin.model.js');
    const { default: FranchiseApplication } = await import('../src/modules/food/admin/models/franchiseApplication.model.js');
    const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
    const { Driver: TaxiDriver } = await import('../src/modules/taxi/driver/models/Driver.js');
    const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
    const { signAccessToken } = await import('../src/core/auth/token.util.js');
    const { authMiddleware } = await import('../src/core/auth/auth.middleware.js');
    const { authenticate } = await import('../src/modules/taxi/middlewares/authMiddleware.js');
    const { adminLogin, refreshAccessToken } = await import('../src/core/auth/auth.service.js');
    const service = await import('../src/modules/food/admin/services/franchise.service.js');

    await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).createCollection().catch(() => {})));

    const app = express();
    app.use(express.json());
    app.use('/v1/auth', authRoutes);
    app.use('/v1/franchise', portalRoutes);
    app.use(errorHandler);
    const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (method, path, { token, body } = {}) => {
        const res = await fetch(`${base}${path}`, {
            method,
            headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        const json = await res.json().catch(() => ({}));
        return { status: res.status, data: json.data, message: json.message };
    };

    /* ---------------------------------------------------------- two franchises */
    const id = () => new mongoose.Types.ObjectId();
    const [foodZoneA, foodZoneB, taxiZoneA, taxiZoneB] = [id(), id(), id(), id()];

    const franchiseA = await FranchiseApplication.create({
        applicantName: 'Alpha', email: 'alpha@test.in', phone: '9500000010', state: 'MP', city: 'Indore',
        selectedModules: ['food', 'taxi'], zoneId: foodZoneA, taxiZoneId: taxiZoneA, status: 'approved', franchiseFeeStatus: 'paid',
    });
    const franchiseB = await FranchiseApplication.create({
        applicantName: 'Beta', email: 'beta@test.in', phone: '9500000011', state: 'MP', city: 'Bhopal',
        selectedModules: ['food'], zoneId: foodZoneB, status: 'approved', franchiseFeeStatus: 'paid',
    });

    // A's login is made the way the admin panel makes it; B's directly.
    const madeA = await service.syncFranchiseSubAdmin(franchiseA._id, { overrideFeeCheck: true, password: 'Alpha-pass-123' });
    const loginB = await FoodAdmin.create({ email: 'beta@test.in', password: 'Beta-pass-123', name: 'Beta', admin_type: 'franchise', franchiseId: franchiseB._id, isActive: true });
    await FranchiseApplication.updateOne({ _id: franchiseB._id }, { $set: { subAdminId: loginB._id } });
    await FoodAdmin.create({ email: 'owner@test.in', password: 'Owner-pass-123', name: 'Owner', adminLevel: 'platform_superadmin', admin_type: 'superadmin', permissions: ['*'], isActive: true });

    const rider = (name, zoneId, phone) => FoodDeliveryPartner.collection.insertOne({ name, phone, zoneId, status: 'pending', createdAt: new Date() }).then((r) => r.insertedId);
    const riderA = await rider('Rider A', foodZoneA, '9600000001');
    const riderB = await rider('Rider B', foodZoneB, '9600000002');
    const driver = (name, zoneId, phone) => TaxiDriver.collection.insertOne({ name, phone, zoneId, approve: false, status: 'pending', deletedAt: null, createdAt: new Date() }).then((r) => r.insertedId);
    const driverA = await driver('Driver A', taxiZoneA, '9700000001');
    const driverB = await driver('Driver B', taxiZoneB, '9700000002');
    await FoodOrder.collection.insertMany([
        { orderId: 'ORD-A', franchiseId: franchiseA._id, restaurantId: id(), customerName: 'Cust A', customerPhone: '9800000001', orderStatus: 'delivered', pricing: { total: 200 }, payment: { method: 'cash', status: 'paid' }, createdAt: new Date() },
        { orderId: 'ORD-B', franchiseId: franchiseB._id, restaurantId: id(), customerName: 'Cust B', customerPhone: '9800000002', orderStatus: 'delivered', pricing: { total: 300 }, payment: { method: 'cash', status: 'paid' }, createdAt: new Date() },
    ]);

    /* ------------------------------------------------------------------ login */
    console.log('\nlogging in');
    let tokenA;
    let refreshA;
    let tokenB;
    await check('the admin panel makes a franchise login that can sign in to the portal', async () => {
        assert.ok(madeA);
        const res = await call('POST', '/v1/auth/franchise/login', { body: { email: 'alpha@test.in', password: 'Alpha-pass-123' } });
        assert.equal(res.status, 200, res.message);
        assert.equal(res.data.user.role, 'FRANCHISE');
        assert.equal(res.data.user.franchise.id, String(franchiseA._id));
        tokenA = res.data.accessToken;
        refreshA = res.data.refreshToken;
        const b = await call('POST', '/v1/auth/franchise/login', { body: { email: 'beta@test.in', password: 'Beta-pass-123' } });
        assert.equal(b.status, 200, b.message);
        tokenB = b.data.accessToken;
    });
    await check('a wrong password is refused', async () => {
        assert.equal((await call('POST', '/v1/auth/franchise/login', { body: { email: 'alpha@test.in', password: 'wrong-pass-123' } })).status, 401);
    });
    await check('a platform admin cannot use the franchise login', async () => {
        const res = await call('POST', '/v1/auth/franchise/login', { body: { email: 'owner@test.in', password: 'Owner-pass-123' } });
        assert.equal(res.status, 401);
    });
    await check('the admin login still refuses franchise accounts', async () => {
        await assert.rejects(() => adminLogin('alpha@test.in', 'Alpha-pass-123'), /Franchise accounts/);
    });

    /* ------------------------------------------------------- the other doors */
    console.log('\nthe FRANCHISE token opens nothing else');
    const coreStatus = (token) => new Promise((resolve) => {
        const req = { headers: { authorization: `Bearer ${token}` } };
        const res = { status(c) { this.c = c; return this; }, json() { resolve(this.c); return this; } };
        authMiddleware(req, res, () => resolve('allowed'));
    });
    await check('refused by the core admin API', async () => {
        assert.equal(await coreStatus(tokenA), 403);
    });
    await check('refused by the taxi admin API', async () => {
        const status = await new Promise((resolve) => {
            authenticate(['admin'])({ headers: { authorization: `Bearer ${tokenA}` } }, {}, (err) => resolve(err ? (err.statusCode || err.status) : 'allowed'));
        });
        assert.notEqual(status, 'allowed');
    });
    await check('an ADMIN token for the same account is refused by the portal', async () => {
        const raw = await FoodAdmin.collection.findOne({ email: 'alpha@test.in' });
        const res = await call('GET', '/v1/franchise/me', { token: signAccessToken({ userId: String(raw._id), role: 'ADMIN' }) });
        assert.equal(res.status, 403);
    });
    await check('a platform admin token is refused by the portal', async () => {
        const owner = await FoodAdmin.findOne({ email: 'owner@test.in' });
        assert.equal((await call('GET', '/v1/franchise/me', { token: signAccessToken({ userId: String(owner._id), role: 'ADMIN' }) })).status, 403);
    });
    await check('no token, no portal', async () => {
        assert.equal((await call('GET', '/v1/franchise/me')).status, 401);
    });

    /* -------------------------------------------------------------- isolation */
    console.log('\nonly its own franchise');
    await check('/me is its own franchise', async () => {
        const res = await call('GET', '/v1/franchise/me', { token: tokenA });
        assert.equal(res.status, 200, res.message);
        assert.equal(res.data.partnerInfo.applicantName, 'Alpha');
        assert.equal(res.data.territoryOrders.length, 1);
        assert.ok(!JSON.stringify(res.data).includes('9800000001'), 'customer phone on the dashboard');
        assert.ok(!JSON.stringify(res.data).includes('ORD-B'));
    });
    await check('riders: only its zone is listed', async () => {
        const res = await call('GET', '/v1/franchise/riders', { token: tokenA });
        assert.equal(res.status, 200, res.message);
        assert.deepEqual(res.data.items.map((r) => r.name), ['Rider A']);
    });
    await check("another franchise's rider answers 404 and cannot be approved", async () => {
        assert.equal((await call('GET', `/v1/franchise/riders/${riderB}`, { token: tokenA })).status, 404);
        assert.equal((await call('POST', `/v1/franchise/riders/${riderB}/decision`, { token: tokenA, body: { action: 'approve' } })).status, 404);
        assert.equal((await FoodDeliveryPartner.collection.findOne({ _id: riderB })).status, 'pending');
    });
    await check('its own rider can be rejected, with the decision audited', async () => {
        const res = await call('POST', `/v1/franchise/riders/${riderA}/decision`, { token: tokenA, body: { action: 'reject', reason: 'Documents unclear' } });
        assert.equal(res.status, 200, res.message);
        assert.equal((await FoodDeliveryPartner.collection.findOne({ _id: riderA })).status, 'rejected');
        const audit = await mongoose.model('FranchiseAuditLog').findOne({ franchiseId: franchiseA._id, action: 'rider.reject' }).lean();
        assert.ok(audit);
    });
    await check('orders: only its own, without customer phone numbers', async () => {
        const res = await call('GET', '/v1/franchise/orders', { token: tokenA });
        assert.equal(res.status, 200, res.message);
        const rows = res.data.items || res.data.orders || [];
        assert.equal(rows.length, 1);
        assert.ok(!JSON.stringify(res.data).includes('9800000002'));
        assert.ok(!JSON.stringify(res.data).includes('9800000001'));
    });
    await check('a query operator cannot widen a list', async () => {
        const res = await call('GET', '/v1/franchise/orders?status[$ne]=x&franchiseId=' + franchiseB._id, { token: tokenA });
        assert.equal(res.status, 200, res.message);
        assert.ok(!JSON.stringify(res.data).includes('ORD-B'));
    });
    await check('taxi drivers: only its taxi zone', async () => {
        const res = await call('GET', '/v1/franchise/taxi/drivers', { token: tokenA });
        assert.equal(res.status, 200, res.message);
        assert.deepEqual(res.data.items.map((d) => d.name), ['Driver A']);
        assert.equal((await call('GET', `/v1/franchise/taxi/drivers/${driverB}`, { token: tokenA })).status, 404);
        assert.equal((await call('POST', `/v1/franchise/taxi/drivers/${driverB}/decision`, { token: tokenA, body: { action: 'approve' } })).status, 404);
        assert.equal((await TaxiDriver.collection.findOne({ _id: driverB })).status, 'pending');
    });
    await check('its own driver can be approved', async () => {
        const res = await call('POST', `/v1/franchise/taxi/drivers/${driverA}/decision`, { token: tokenA, body: { action: 'approve' } });
        assert.equal(res.status, 200, res.message);
        assert.equal((await TaxiDriver.collection.findOne({ _id: driverA })).status, 'approved');
    });
    await check('a food-only franchise cannot open the taxi pages', async () => {
        assert.equal((await call('GET', '/v1/franchise/taxi/drivers', { token: tokenB })).status, 403);
        assert.equal((await call('GET', '/v1/franchise/taxi/overview', { token: tokenB })).status, 403);
    });
    await check("B sees none of A's riders or orders", async () => {
        const riders = await call('GET', '/v1/franchise/riders', { token: tokenB });
        assert.deepEqual(riders.data.items.map((r) => r.name), ['Rider B']);
        const orders = await call('GET', '/v1/franchise/orders', { token: tokenB });
        assert.ok(!JSON.stringify(orders.data).includes('ORD-A'));
    });

    /* ------------------------------------------------------------- what is on */
    console.log('\nwhat is switched on');
    await check('the only writes are support messages and rider / driver decisions', async () => {
        const writes = portalRoutes.stack
            .filter((layer) => layer.route && Object.keys(layer.route.methods).some((m) => m !== 'get'))
            .map((layer) => layer.route.path)
            .sort();
        assert.deepEqual(writes, ['/riders/:riderId/decision', '/support-messages', '/taxi/drivers/:driverId/decision']);
    });

    /* -------------------------------------------------------------- shutting */
    console.log('\nsuspending the franchise');
    await FranchiseApplication.updateOne({ _id: franchiseA._id }, { $set: { accountStatus: 'suspended' } });
    await check('its token stops working on the next request', async () => {
        assert.equal((await call('GET', '/v1/franchise/me', { token: tokenA })).status, 403);
    });
    await check('its refresh token is refused and removed', async () => {
        await assert.rejects(() => refreshAccessToken(refreshA), /not active/);
        await assert.rejects(() => refreshAccessToken(refreshA), /Invalid refresh token/);
    });
    await check('it cannot log in again', async () => {
        assert.equal((await call('POST', '/v1/auth/franchise/login', { body: { email: 'alpha@test.in', password: 'Alpha-pass-123' } })).status, 401);
    });
    await check('a login the franchise no longer names gets nothing', async () => {
        await FranchiseApplication.updateOne({ _id: franchiseB._id }, { $set: { subAdminId: id() } });
        assert.equal((await call('GET', '/v1/franchise/me', { token: tokenB })).status, 403);
    });

    server.close();
    await mongoose.disconnect();
    await mongo.stop();

    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
