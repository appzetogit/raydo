/**
 * Subscription passes: who may work, and that a pass really costs what it costs.
 *
 * Run: node tests/subscriptions.smoke.mjs
 *
 * Drives the real driver and delivery-partner services and the real getRiderFinance
 * against an in-memory Mongo replica set (buying from the driver wallet is a transaction):
 *
 *   - with subscriptions off nothing changes for anybody;
 *   - subscription-only blocks work without a live pass, and a pass opens it;
 *   - a pass bought from the Pocket leaves the balance, so it cannot also be withdrawn;
 *   - nobody can spend more than they have, or the COD cash they hold;
 *   - an admin grant, or a pass paid online, costs the balance nothing;
 *   - one Razorpay payment can only ever create one pass.
 */
import assert from 'node:assert/strict';

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

const rejects = async (fn, pattern) => {
    let error = null;
    try {
        await fn();
    } catch (err) {
        error = err;
    }
    assert.ok(error, 'expected this to be refused');
    assert.match(error.message, pattern);
};

const main = async () => {
    const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(mongo.getUri(), { dbName: 'subscriptions' });

    const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
    const { SubscriptionPlan } = await import('../src/modules/taxi/admin/models/SubscriptionPlan.js');
    const { AdminBusinessSetting } = await import('../src/modules/taxi/admin/models/AdminBusinessSetting.js');
    const { DriverSubscription } = await import('../src/modules/taxi/driver/models/DriverSubscription.js');
    const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
    const { FoodDeliveryPartnerSubscription: Pass } = await import('../src/modules/food/delivery/models/deliveryPartnerSubscription.model.js');
    const { FoodOrder } = await import('../src/modules/food/orders/models/order.model.js');
    const driverCore = await import('../src/modules/taxi/driver/services/driverSubscriptionCore.js');
    const driverService = await import('../src/modules/taxi/driver/services/driverSubscriptionService.js');
    const delivery = await import('../src/modules/food/delivery/services/deliverySubscription.service.js');
    const { getDeliveryPartnerWalletEnhanced, requestDeliveryWithdrawal } = await import('../src/modules/food/delivery/services/deliveryFinance.service.js');
    const { ensureDriverWalletCanAcceptRide } = await import('../src/modules/taxi/driver/services/walletService.js');

    // A transaction cannot create a collection while its indexes are still being built.
    await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).createCollection().catch(() => {})));
    await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init().catch(() => {})));

    const oid = () => new mongoose.Types.ObjectId();
    let phone = 9400000000;
    const setDriverMode = (mode) => AdminBusinessSetting.updateOne({ scope: 'default' }, { $set: { 'subscription.mode': mode } }, { upsert: true });
    const makeDriver = async (balance = 0) => {
        const _id = oid();
        await Driver.collection.insertOne({ _id, name: 'Driver', phone: String(phone++), approve: true, wallet: { balance, isBlocked: false }, registerFor: 'taxi', location: { type: 'Point', coordinates: [77, 28] } });
        return _id;
    };
    const makePartner = async () => {
        const _id = oid();
        await FoodDeliveryPartner.collection.insertOne({ _id, name: 'Rider', phone: String(phone++), status: 'approved', upiId: 'rider@upi' });
        return _id;
    };
    const earn = (partner, { earning = 0, total = 0, method = 'razorpay' } = {}) => FoodOrder.collection.insertOne({
        _id: oid(), orderStatus: 'delivered', dispatch: { deliveryPartnerId: partner },
        payment: { method }, pricing: { total }, riderEarning: earning, createdAt: new Date(),
    });
    const walletOf = (id) => getDeliveryPartnerWalletEnhanced(String(id));

    const driverPlan = await SubscriptionPlan.create({ audience: 'driver', name: 'Week', amount: 100, duration: 7, transport_type: 'all', active: true });
    const foodPlan = await SubscriptionPlan.create({ audience: 'delivery', service_type: 'food', name: 'Food week', amount: 200, duration: 7, active: true });

    // --- drivers ----------------------------------------------------------------
    console.log('\ndrivers');

    await check('commission-only (the default): no pass needed, none can be bought', async () => {
        const d = await makeDriver(500);
        await driverCore.assertDriverMaySubscriptionWork(d);
        assert.equal((await driverCore.filterDriversBySubscription([{ _id: d }])).length, 1);
        assert.equal(await driverCore.subscriptionWaivesCommission(d), false);
        await rejects(() => driverService.purchaseDriverSubscription({ driverId: d, planId: driverPlan._id }), /not available/i);
    });

    await setDriverMode('subscriptionOnly');

    await check('subscription-only: no pass means no requests and no accepting', async () => {
        const d = await makeDriver(500);
        await rejects(() => driverCore.assertDriverMaySubscriptionWork(d), /subscription is required/i);
        assert.equal((await driverCore.filterDriversBySubscription([{ _id: d }])).length, 0);
        await rejects(() => ensureDriverWalletCanAcceptRide(d), /subscription is required/i);
    });

    await check('buying takes the money from the wallet and opens work', async () => {
        const d = await makeDriver(500);
        await driverService.purchaseDriverSubscription({ driverId: d, planId: driverPlan._id });
        assert.equal((await Driver.findById(d).lean()).wallet.balance, 400);
        await driverCore.assertDriverMaySubscriptionWork(d);
        assert.equal((await driverCore.filterDriversBySubscription([{ _id: d }])).length, 1);
        assert.equal(await driverCore.subscriptionWaivesCommission(d), true);
    });

    await check('too little in the wallet: refused, nothing taken, no pass', async () => {
        const d = await makeDriver(50);
        await rejects(() => driverService.purchaseDriverSubscription({ driverId: d, planId: driverPlan._id }), /insufficient/i);
        assert.equal((await Driver.findById(d).lean()).wallet.balance, 50);
        assert.equal(await DriverSubscription.countDocuments({ driverId: d }), 0);
    });

    await check('a renewal starts when the running pass ends', async () => {
        const d = await makeDriver(500);
        await driverService.purchaseDriverSubscription({ driverId: d, planId: driverPlan._id });
        const second = await driverService.purchaseDriverSubscription({ driverId: d, planId: driverPlan._id });
        assert.equal(second.startsLater, true);
        assert.equal((await Driver.findById(d).lean()).wallet.balance, 300);
    });

    await check('an expired pass no longer counts', async () => {
        const d = await makeDriver(0);
        const past = Date.now() - 2 * 86400000;
        await DriverSubscription.collection.insertOne({ driverId: d, status: 'active', startedAt: new Date(past - 86400000), expiresAt: new Date(past) });
        await rejects(() => driverCore.assertDriverMaySubscriptionWork(d), /subscription is required/i);
    });

    await check('two taps at once cannot both spend the same rupees', async () => {
        const d = await makeDriver(100);
        const results = await Promise.allSettled([
            driverService.purchaseDriverSubscription({ driverId: d, planId: driverPlan._id }),
            driverService.purchaseDriverSubscription({ driverId: d, planId: driverPlan._id }),
        ]);
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        assert.equal((await Driver.findById(d).lean()).wallet.balance, 0);
        assert.equal(await DriverSubscription.countDocuments({ driverId: d }), 1);
    });

    await setDriverMode('commissionOnly');

    // --- delivery partners ------------------------------------------------------
    console.log('\ndelivery partners');

    await check('modes default to off, and food cannot be set to "both"', async () => {
        assert.equal((await delivery.getDeliverySubscriptionModes()).food, 'commissionOnly');
        const p = await makePartner();
        await delivery.assertPartnerMayWork(p, 'food');
        await rejects(() => delivery.updateDeliverySubscriptionModes({ food: 'both' }), /only/i);
    });

    await delivery.updateDeliverySubscriptionModes({ food: 'subscriptionOnly' });

    await check('subscription-only food: no pass means no orders', async () => {
        const p = await makePartner();
        await rejects(() => delivery.assertPartnerMayWork(p, 'food'), /subscription is required/i);
        assert.ok((await delivery.partnerIdsMissingPass([p], 'food')).has(String(p)));
    });

    await check('a pass from the Pocket leaves the balance and opens work', async () => {
        const p = await makePartner();
        await earn(p, { earning: 500 });
        await delivery.purchasePartnerSubscription({ partnerId: p, planId: foodPlan._id });
        const wallet = await walletOf(p);
        assert.equal(wallet.pocketBalance, 300);
        assert.equal(wallet.withdrawableBalance, 300);
        await delivery.assertPartnerMayWork(p, 'food');
        assert.equal((await delivery.partnerIdsMissingPass([p], 'food')).size, 0);
    });

    await check('money spent on a pass cannot also be withdrawn', async () => {
        const p = await makePartner();
        await earn(p, { earning: 500 });
        await delivery.purchasePartnerSubscription({ partnerId: p, planId: foodPlan._id });
        await rejects(() => requestDeliveryWithdrawal(String(p), { amount: 400, paymentMethod: 'upi' }), /insufficient|up to/i);
        await requestDeliveryWithdrawal(String(p), { amount: 300, paymentMethod: 'upi' });
        assert.equal((await walletOf(p)).pocketBalance, 0);
    });

    await check('a pass bought before this code existed still counts against the balance', async () => {
        const p = await makePartner();
        await earn(p, { earning: 500 });
        await Pass.collection.insertOne({ partnerId: p, service: 'food', amount: 150, status: 'active', purchaseSource: 'pocket', startedAt: new Date(), expiresAt: new Date(Date.now() + 86400000) });
        assert.equal((await walletOf(p)).pocketBalance, 350);
    });

    await check('too little in the Pocket: refused, and no pass is left behind', async () => {
        const p = await makePartner();
        await earn(p, { earning: 100 });
        await rejects(() => delivery.purchasePartnerSubscription({ partnerId: p, planId: foodPlan._id }), /insufficient/i);
        assert.equal(await Pass.countDocuments({ partnerId: p }), 0);
        assert.equal((await walletOf(p)).pocketBalance, 100);
    });

    await check('COD cash the rider holds cannot pay for a pass', async () => {
        const p = await makePartner();
        await earn(p, { earning: 300, total: 250, method: 'cash' });
        await rejects(() => delivery.purchasePartnerSubscription({ partnerId: p, planId: foodPlan._id }), /deposit|insufficient/i);
        assert.equal(await Pass.countDocuments({ partnerId: p }), 0);
    });

    await check('two taps at once cannot both spend the same rupees', async () => {
        const p = await makePartner();
        await earn(p, { earning: 200 });
        const results = await Promise.allSettled([
            delivery.purchasePartnerSubscription({ partnerId: p, planId: foodPlan._id }),
            delivery.purchasePartnerSubscription({ partnerId: p, planId: foodPlan._id }),
        ]);
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        assert.equal(await Pass.countDocuments({ partnerId: p }), 1);
        assert.equal((await walletOf(p)).pocketBalance, 0);
    });

    await check('an admin grant opens work and costs the balance nothing', async () => {
        const p = await makePartner();
        await earn(p, { earning: 500 });
        await delivery.grantPartnerSubscription({ partnerId: p, planId: foodPlan._id });
        assert.equal((await walletOf(p)).pocketBalance, 500);
        await delivery.assertPartnerMayWork(p, 'food');
    });

    await check('cancelling a pass closes work again', async () => {
        const p = await makePartner();
        const granted = await delivery.grantPartnerSubscription({ partnerId: p, planId: foodPlan._id });
        await delivery.cancelPartnerSubscription(granted.id, 'test');
        await rejects(() => delivery.assertPartnerMayWork(p, 'food'), /subscription is required/i);
    });

    await check('one Razorpay payment creates one pass, and costs the balance nothing', async () => {
        const p = await makePartner();
        await earn(p, { earning: 500 });
        const rzOrder = {
            id: 'order_1', amount: 20000, receipt: `dsub_${String(p).slice(-8)}_1`,
            notes: { purpose: 'delivery_subscription', deliveryPartnerId: String(p), planId: String(foodPlan._id) },
        };
        const first = await delivery.settlePartnerSubscriptionFromWebhook({ rzOrder, paymentId: 'pay_1', amountPaise: 20000 });
        const again = await delivery.settlePartnerSubscriptionFromWebhook({ rzOrder, paymentId: 'pay_1', amountPaise: 20000 });
        assert.equal(first.recorded, true);
        assert.equal(again.recorded, false);
        assert.equal(await Pass.countDocuments({ partnerId: p }), 1);
        assert.equal((await walletOf(p)).pocketBalance, 500);
    });

    await check('a webhook for the wrong amount or receipt creates no pass', async () => {
        const p = await makePartner();
        const notes = { purpose: 'delivery_subscription', deliveryPartnerId: String(p), planId: String(foodPlan._id) };
        const wrongAmount = await delivery.settlePartnerSubscriptionFromWebhook({
            rzOrder: { id: 'order_2', amount: 20000, receipt: `dsub_${String(p).slice(-8)}_2`, notes }, paymentId: 'pay_2', amountPaise: 100,
        });
        const wrongReceipt = await delivery.settlePartnerSubscriptionFromWebhook({
            rzOrder: { id: 'order_3', amount: 20000, receipt: 'dsub_someoneelse_3', notes }, paymentId: 'pay_3', amountPaise: 20000,
        });
        assert.equal(wrongAmount.recorded, false);
        assert.equal(wrongReceipt.recorded, false);
        assert.equal(await Pass.countDocuments({ partnerId: p }), 0);
    });

    await mongoose.disconnect();
    await mongo.stop();

    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
