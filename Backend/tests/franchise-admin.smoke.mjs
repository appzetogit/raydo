/**
 * Franchise stage 1: admins can manage franchises, and nothing else has opened.
 *
 * Run: node tests/franchise-admin.smoke.mjs
 *
 * Partner logins, public applications and anything that pays out or rewrites the ledger
 * are not on yet, so these checks fail if any of them is switched on by accident.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'ci-test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'ci-test-refresh-secret';
process.env.RAZORPAY_KEY_ID = '';
process.env.RAZORPAY_KEY_SECRET = '';

const { default: mongoose } = await import('mongoose');
const { MongoMemoryReplSet } = await import('mongodb-memory-server');

let failed = 0;
const check = async (label, fn) => {
    try {
        await fn();
        console.log(`  PASS  ${label}`);
    } catch (err) {
        failed += 1;
        console.log(`  FAIL  ${label}\n        ${err.message}`);
    }
};

const main = async () => {
    const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(mongo.getUri(), { dbName: 'franchise_admin' });

    const { default: adminRoutes } = await import('../src/modules/food/admin/routes/admin.routes.js');
    const { requireFinanceAdmin } = await import('../src/modules/food/admin/controllers/franchiseFinance.controller.js');
    const { default: FranchiseApplication } = await import('../src/modules/food/admin/models/franchiseApplication.model.js');
    const service = await import('../src/modules/food/admin/services/franchise.service.js');
    const { FoodAdmin } = await import('../src/core/admin/admin.model.js');
    const { adminLogin } = await import('../src/core/auth/auth.service.js');
    const { signAccessToken } = await import('../src/core/auth/token.util.js');
    const { authMiddleware } = await import('../src/core/auth/auth.middleware.js');

    await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).createCollection().catch(() => {})));
    await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init().catch(() => {})));

    const routes = adminRoutes.stack
        .filter((layer) => layer.route)
        .map((layer) => ({ path: layer.route.path, methods: Object.keys(layer.route.methods) }));
    const franchiseRoutes = routes.filter((r) => r.path.startsWith('/franchise'));

    console.log('\nwhat is switched on');
    await check('the admin franchise routes exist', async () => {
        assert.ok(franchiseRoutes.length > 40, `only ${franchiseRoutes.length} routes`);
        assert.ok(franchiseRoutes.some((r) => r.path === '/franchise/applications'));
    });
    await check('nothing that pays out or rewrites the ledger is mounted', async () => {
        const paths = franchiseRoutes.map((r) => r.path);
        assert.equal(paths.filter((p) => /payout-requests|refund-requests/.test(p)).length, 0);
        assert.ok(!franchiseRoutes.some((r) => r.path.endsWith('/reconcile') && r.methods.includes('post')));
    });
    await check('public applications are not mounted; /v1/franchise is only the partner portal', async () => {
        const index = readFileSync(new URL('../src/routes/index.js', import.meta.url), 'utf8');
        assert.ok(!/franchise\.routes/.test(index));
        const mounts = index.match(/router\.use\('\/v1\/franchise[^']*',[^)]*\)/g) || [];
        assert.deepEqual(mounts, ["router.use('/v1/franchise', franchisePortalRoutes)"]);
    });

    console.log('\nwho may use it');
    const guardedBySuperAdmin = adminRoutes.stack.some((layer) => !layer.route && layer.regexp?.test('/franchise/applications'));
    await check('a guard sits on every /franchise route', async () => {
        assert.ok(guardedBySuperAdmin);
    });
    const finance = (ctx) => new Promise((resolve) => {
        requireFinanceAdmin({ adminContext: ctx }, {}, (err) => resolve(err ? 'refused' : 'allowed'));
    });
    await check('only the platform super admin can change franchise money', async () => {
        assert.equal(await finance({ adminLevel: 'platform_superadmin', admin_type: 'superadmin' }), 'allowed');
        assert.equal(await finance({ adminLevel: 'food_superadmin', admin_type: 'superadmin' }), 'refused');
        assert.equal(await finance({ adminLevel: 'subadmin', admin_type: 'subadmin' }), 'refused');
        assert.equal(await finance({ adminLevel: 'platform_superadmin', franchiseId: 'x' }), 'refused');
        assert.equal(await finance({}), 'refused');
    });

    console.log('\nmanaging a franchise');
    const app = await FranchiseApplication.create({
        applicantName: 'Partner', email: 'partner@test.in', phone: '9500000000', state: 'Madhya Pradesh', city: 'Indore',
        selectedModules: ['food'], franchiseFeeStatus: 'paid',
    });
    await check('applications can be listed and read', async () => {
        const list = await service.getApplications({});
        const rows = list.applications || list.results || list.items || list.data || [];
        assert.ok(rows.some((row) => String(row._id) === String(app._id)));
        assert.equal(String((await service.getApplicationById(app._id))._id), String(app._id));
    });
    await check('an old franchise from the database reads without error', async () => {
        const _id = new mongoose.Types.ObjectId();
        await FranchiseApplication.collection.insertOne({ _id, applicantName: 'Old', email: 'old@test.in', phone: '9500000001', state: 'X', city: 'Y', status: 'approved' });
        assert.equal((await service.getApplicationById(_id)).applicantName, 'Old');
    });

    console.log('\nthe login it creates stays locked');
    let credentials = null;
    await check('approving creates a franchise login', async () => {
        const result = await service.syncFranchiseSubAdmin(app._id, { overrideFeeCheck: true, regeneratePassword: true });
        credentials = result.credentialsInfo;
        assert.ok(credentials?.password);
        const raw = await FoodAdmin.collection.findOne({ email: 'partner@test.in' });
        assert.equal(raw.admin_type, 'franchise');
        assert.equal(String(raw.franchiseId), String(app._id));
    });
    await check('that login cannot log in, even with the right password', async () => {
        await assert.rejects(() => adminLogin('partner@test.in', credentials.password), /Franchise accounts/);
    });
    await check('and a token for it is refused', async () => {
        const raw = await FoodAdmin.collection.findOne({ email: 'partner@test.in' });
        const code = await new Promise((resolve) => {
            const req = { headers: { authorization: `Bearer ${signAccessToken({ userId: String(raw._id), role: 'ADMIN' })}` } };
            const res = { status(c) { this.c = c; return this; }, json() { resolve(this.c); return this; } };
            authMiddleware(req, res, () => resolve('allowed'));
        });
        assert.equal(code, 403);
    });

    await mongoose.disconnect();
    await mongo.stop();

    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
