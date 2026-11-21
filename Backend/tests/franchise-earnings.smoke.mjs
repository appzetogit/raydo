/**
 * Franchise stage 3: orders, restaurants and rides are attributed to the zone's franchise,
 * and its earnings reach the ledger.
 *
 * Run: node tests/franchise-earnings.smoke.mjs
 *
 *   - a new order gets the franchise operating its restaurant's zone, and only an operating one;
 *   - restaurant labels follow zone ownership;
 *   - delivered orders are credited once, never twice, and nothing from before the cutoff;
 *   - refunds and cancellations take the earning back, never more than was credited;
 *   - settled taxi rides are credited to the driver's zone franchise and stamped;
 *   - the schemas keep the franchise fields (strict mode used to drop them).
 */
import assert from 'node:assert/strict';

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'ci-test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'ci-test-refresh-secret';

const { default: mongoose } = await import('mongoose');
const { MongoMemoryReplSet } = await import('mongodb-memory-server');

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
    await mongoose.connect(mongo.getUri(), { dbName: 'franchise_earnings' });

    const attribution = await import('../src/modules/food/franchise/services/franchiseAttribution.service.js');
    const { default: FranchiseApplication } = await import('../src/modules/food/admin/models/franchiseApplication.model.js');
    const { default: FranchiseLedger } = await import('../src/modules/food/admin/models/franchiseLedger.model.js');
    const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
    const { FoodRestaurant } = await import('../src/modules/food/restaurant/models/restaurant.model.js');
    const { Ride } = await import('../src/modules/taxi/user/models/Ride.js');
    const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
    await import('../src/modules/food/orders/models/foodTransaction.model.js');
    await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).createCollection().catch(() => {})));
    await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).init().catch(() => {})));

    const id = () => new mongoose.Types.ObjectId();
    const [zoneA, zoneSuspended, zoneUnpaid, zoneNone, taxiZone] = [id(), id(), id(), id(), id()];
    const base = { email: 'x@t.in', phone: '9500000000', state: 'MP', city: 'Indore', status: 'approved' };
    const A = await FranchiseApplication.create({ ...base, applicantName: 'A', selectedModules: ['food', 'taxi'], zoneId: zoneA, taxiZoneId: taxiZone, franchiseFeeStatus: 'paid' });
    const S = await FranchiseApplication.create({ ...base, applicantName: 'Suspended', selectedModules: ['food'], zoneId: zoneSuspended, franchiseFeeStatus: 'paid', accountStatus: 'suspended' });
    await FranchiseApplication.create({ ...base, applicantName: 'Unpaid', selectedModules: ['food'], zoneId: zoneUnpaid, franchiseFeeStatus: 'pending' });

    const wallet = async (fid) => (await FranchiseApplication.findById(fid).lean()).walletBalance || 0;
    const rows = (sourceId) => FranchiseLedger.find({ sourceId: String(sourceId) }).lean();
    const after = new Date(attribution.ATTRIBUTION_STARTED_AT.getTime() + 3600000);
    const now = new Date(Math.max(Date.now(), after.getTime()));

    console.log('\nwho an order belongs to');
    await check('an order in an operating franchise\'s zone gets that franchise', async () => {
        assert.equal(String(await attribution.franchiseForNewOrder({ zoneId: zoneA })), String(A._id));
    });
    await check('a suspended franchise, an unpaid one or no franchise: no tag', async () => {
        assert.equal(await attribution.franchiseForNewOrder({ zoneId: zoneSuspended }), null);
        assert.equal(await attribution.franchiseForNewOrder({ zoneId: zoneUnpaid }), null);
        assert.equal(await attribution.franchiseForNewOrder({ zoneId: zoneNone }), null);
        assert.equal(await attribution.franchiseForNewOrder({}), null);
        assert.equal(await attribution.franchiseForNewOrder(null), null);
    });
    await check('the order, restaurant and ride schemas keep the franchise fields', async () => {
        assert.equal(String(new FoodOrder({ franchiseId: A._id }).franchiseId), String(A._id));
        assert.equal(String(new FoodRestaurant({ franchiseId: A._id }).franchiseId), String(A._id));
        assert.equal(String(new Ride({ franchiseApplicationId: A._id }).franchiseApplicationId), String(A._id));
    });

    console.log('\nrestaurant labels');
    const [rA, rOld] = [id(), id()];
    await FoodRestaurant.collection.insertMany([
        { _id: rA, restaurantName: 'In A', zoneId: zoneA },
        { _id: rOld, restaurantName: 'Labelled by a suspended franchise', zoneId: zoneSuspended, franchiseId: S._id },
    ]);
    await check('restaurants follow the operating franchise of their zone', async () => {
        await attribution.syncRestaurantLabels();
        assert.equal(String((await FoodRestaurant.findById(rA).lean()).franchiseId), String(A._id));
        assert.equal((await FoodRestaurant.findById(rOld).lean()).franchiseId, null);
    });

    console.log('\nfood earnings');
    const order = (fields) => FoodOrder.collection.insertOne({
        orderId: `O-${id()}`, restaurantId: rA, franchiseId: A._id, orderStatus: 'delivered',
        pricing: { total: 500, restaurantCommission: 80, platformFee: 20 },
        payment: { method: 'cash', status: 'paid' }, createdAt: now, updatedAt: now, ...fields,
    }).then((r) => r.insertedId);
    const delivered = await order({});
    const legacy = await order({ createdAt: new Date('2026-10-01T00:00:00Z') });
    const notDelivered = await order({ orderStatus: 'preparing' });
    const otherZone = await order({ franchiseId: null });

    await check('a delivered order is credited: earning minus the platform share', async () => {
        await attribution.creditMissedFoodOrders();
        const r = await rows(delivered);
        const earning = r.find((x) => x.type === 'earning');
        assert.ok(earning, 'no earning row');
        assert.equal(earning.amount, 100);
        const commission = r.find((x) => x.type === 'platform_commission');
        const net = 100 + (commission ? commission.amount : 0);
        assert.equal(await wallet(A._id), net);
    });
    await check('running the sweep again credits nothing twice', async () => {
        const before = await wallet(A._id);
        await attribution.creditMissedFoodOrders();
        assert.equal(await wallet(A._id), before);
        assert.equal((await rows(delivered)).filter((x) => x.type === 'earning').length, 1);
    });
    await check('orders from before the cutoff, undelivered or untagged earn nothing', async () => {
        assert.equal((await rows(legacy)).length, 0);
        assert.equal((await rows(notDelivered)).length, 0);
        assert.equal((await rows(otherZone)).length, 0);
    });
    await check('the instant hook credits too, and stays idempotent', async () => {
        const fresh = await order({});
        attribution.creditOrderSoon(fresh);
        attribution.creditOrderSoon(fresh);
        await new Promise((r) => setTimeout(r, 1500));
        assert.equal((await rows(fresh)).filter((x) => x.type === 'earning').length, 1);
    });

    console.log('\nrefunds');
    await check('a partial refund takes back that share', async () => {
        await FoodOrder.collection.updateOne({ _id: delivered }, { $set: { 'payment.refund': { status: 'processed', amount: 250 } } });
        const before = await wallet(A._id);
        await attribution.reverseRefundedFoodOrders();
        const r = await rows(delivered);
        assert.equal(r.find((x) => x.type === 'earning_reversal').amount, -50);
        assert.ok(await wallet(A._id) < before);
        const again = await wallet(A._id);
        await attribution.reverseRefundedFoodOrders();
        assert.equal(await wallet(A._id), again, 'the same refund was reversed twice');
    });
    await check('a full refund afterwards takes back only what is left', async () => {
        await FoodOrder.collection.updateOne({ _id: delivered }, { $set: { 'payment.status': 'refunded' } });
        await attribution.reverseRefundedFoodOrders();
        const r = await rows(delivered);
        const net = r.reduce((s, x) => s + x.amount, 0);
        assert.equal(Math.round(net * 100), 0, `order still nets ${net}`);
    });

    console.log('\ntaxi earnings');
    const driver = (await Driver.collection.insertOne({ name: 'D', phone: '9700000000', zoneId: taxiZone })).insertedId;
    const ride = (await Ride.collection.insertOne({
        driverId: driver, status: 'completed', serviceType: 'ride', fare: 300, commissionAmount: 45,
        walletSettledAt: new Date(), completedAt: new Date(), franchiseApplicationId: null,
    })).insertedId;
    const { creditPendingFranchiseRides } = await import('../src/modules/food/admin/services/franchiseTaxi.service.js');
    await check('a settled ride in the franchise\'s taxi zone is credited and stamped', async () => {
        assert.equal(await creditPendingFranchiseRides({ windowHours: 1 }), 1);
        const r = await rows(ride);
        assert.equal(r.find((x) => x.type === 'earning').amount, 45);
        assert.equal(String((await Ride.findById(ride).lean()).franchiseApplicationId), String(A._id));
    });
    await check('and never twice', async () => {
        assert.equal(await creditPendingFranchiseRides({ windowHours: 1 }), 0);
        assert.equal((await rows(ride)).filter((x) => x.type === 'earning').length, 1);
    });

    console.log('\nthe scheduled job');
    await check('the full sweep runs every step without failing', async () => {
        const r = await attribution.runFranchiseEarningsSweep();
        for (const [k, v] of Object.entries(r)) assert.ok(typeof v === 'number', `${k}: ${v}`);
    });

    await mongoose.disconnect();
    await mongo.stop();
    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
