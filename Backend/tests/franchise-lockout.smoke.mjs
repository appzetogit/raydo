/**
 * Franchise accounts from the previous raydo.in are refused at every door.
 *
 * Run: node tests/franchise-lockout.smoke.mjs
 *
 * Their older tokens say role ADMIN, the admin policy gives them full access, and this
 * code has no franchise isolation, so one of those tokens would reach the whole platform.
 * Inserted through the raw collection because franchiseId is not in the admin schema.
 */
import assert from 'node:assert/strict';

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'ci-test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'ci-test-refresh-secret';

const { default: mongoose } = await import('mongoose');
const { MongoMemoryServer } = await import('mongodb-memory-server');

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
    const mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), { dbName: 'franchise_lockout' });

    const { FoodAdmin } = await import('../src/core/admin/admin.model.js');
    const { signAccessToken } = await import('../src/core/auth/token.util.js');
    const { authMiddleware } = await import('../src/core/auth/auth.middleware.js');
    const { authenticate } = await import('../src/modules/taxi/middlewares/authMiddleware.js');
    const { adminLogin } = await import('../src/core/auth/auth.service.js');
    const { isFranchiseAccount } = await import('../src/core/admin/franchiseLockout.js');

    const insert = async (fields) => {
        const _id = new mongoose.Types.ObjectId();
        await FoodAdmin.collection.insertOne({ _id, email: `${_id}@test.in`, isActive: true, ...fields });
        return _id;
    };
    const franchiseWithAdminRole = await insert({ role: 'ADMIN', admin_type: 'franchise', franchiseId: new mongoose.Types.ObjectId(), permissions: ['orders'], servicesAccess: ['food', 'taxi'] });
    const franchiseRole = await insert({ role: 'franchise', admin_type: 'franchise', franchiseId: new mongoose.Types.ObjectId() });
    const partnerType = await insert({ role: 'ADMIN', admin_type: 'franchise_partner' });
    const platformAdmin = await insert({ role: 'ADMIN', admin_type: 'superadmin', adminLevel: 'platform_superadmin', permissions: ['*'], servicesAccess: ['food', 'taxi'] });
    const subAdmin = await insert({ role: 'ADMIN', admin_type: 'subadmin', adminLevel: 'subadmin', permissions: ['orders'], servicesAccess: ['food'] });

    const callCore = (id, role = 'ADMIN') => new Promise((resolve) => {
        const req = { headers: { authorization: `Bearer ${signAccessToken({ userId: String(id), role })}` } };
        const res = { status(code) { this.code = code; return this; }, json() { resolve(this.code); return this; } };
        authMiddleware(req, res, () => resolve('allowed'));
    });
    const callTaxi = async (id) => {
        const req = { headers: { authorization: `Bearer ${signAccessToken({ userId: String(id), sub: String(id), role: 'admin' })}` } };
        const res = {};
        return new Promise((resolve) => {
            authenticate(['admin'])(req, res, (err) => resolve(err ? (err.statusCode || err.status) : 'allowed'));
        });
    };

    console.log('\nthe API');
    await check('an old token saying ADMIN is refused on the core admin API', async () => {
        assert.equal(await callCore(franchiseWithAdminRole), 403);
    });
    await check('a token saying franchise is refused', async () => {
        assert.equal(await callCore(franchiseRole, 'franchise'), 403);
    });
    await check('franchise_partner accounts are refused too', async () => {
        assert.equal(await callCore(partnerType), 403);
    });
    await check('an old token is refused on the taxi admin API', async () => {
        assert.equal(await callTaxi(franchiseWithAdminRole), 403);
    });

    console.log('\nnobody else is affected');
    await check('the platform admin still gets in on both APIs', async () => {
        assert.equal(await callCore(platformAdmin), 'allowed');
        assert.equal(await callTaxi(platformAdmin), 'allowed');
    });
    await check('a sub-admin still gets in', async () => {
        assert.equal(await callCore(subAdmin), 'allowed');
    });
    await check('customers and riders are not looked up as admins', async () => {
        assert.equal(isFranchiseAccount({ role: 'ADMIN', admin_type: 'subadmin' }), false);
        assert.equal(isFranchiseAccount(null), false);
    });

    console.log('\nlogging in');
    await check('a franchise account with the right password cannot log in', async () => {
        const doc = await FoodAdmin.create({ email: 'fr@test.in', password: 'Str0ng-pass-word', name: 'Fr', isActive: true });
        await FoodAdmin.collection.updateOne({ _id: doc._id }, { $set: { admin_type: 'franchise', franchiseId: new mongoose.Types.ObjectId() } });
        await assert.rejects(() => adminLogin('fr@test.in', 'Str0ng-pass-word'), /Franchise accounts/);
    });
    await check('a normal admin with the right password still can', async () => {
        await FoodAdmin.create({ email: 'ok@test.in', password: 'Str0ng-pass-word', name: 'Ok', isActive: true, adminLevel: 'platform_superadmin', admin_type: 'superadmin', permissions: ['*'] });
        const result = await adminLogin('ok@test.in', 'Str0ng-pass-word');
        assert.ok(result.accessToken);
    });

    await mongoose.disconnect();
    await mongo.stop();

    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
