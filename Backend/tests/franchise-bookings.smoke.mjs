/**
 * Franchise earnings from bus, pooling and rental bookings.
 *
 * Run: node tests/franchise-bookings.smoke.mjs
 *
 *   - bus: a confirmed, paid ticket earns once its travel day is over; the base is the ticket
 *     amount x the bus's commission %; unpaid, not-yet-travelled and pre-cutoff tickets earn nothing;
 *   - pooling: a completed, paid booking earns its recorded Raydo commission, for the franchise
 *     whose taxi zone contains the pickup stop; rental: the admin-set % of what was paid;
 *   - pooling and rental only when switched on in the franchise taxi settings;
 *   - stamps are kept by the schemas, nothing is credited twice, and the sweep moves past a full batch.
 */
import assert from 'node:assert/strict';

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
    await mongoose.connect(mongo.getUri(), { dbName: 'franchise_bookings' });

    const { default: FranchiseApplication } = await import('../src/modules/food/admin/models/franchiseApplication.model.js');
    const { default: FranchiseLedger } = await import('../src/modules/food/admin/models/franchiseLedger.model.js');
    const { default: FranchiseFormConfig } = await import('../src/modules/food/admin/models/franchiseFormConfig.model.js');
    const { ATTRIBUTION_STARTED_AT } = await import('../src/modules/food/franchise/services/franchiseAttribution.service.js');
    const attribution = await import('../src/modules/food/franchise/services/franchiseAttribution.service.js');
    const taxi = await import('../src/modules/food/admin/services/franchiseTaxi.service.js');
    // The sweep registers the taxi models itself; run it once to load them.
    await attribution.runFranchiseEarningsSweep();
    const M = (n) => mongoose.model(n);
    await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).createCollection().catch(() => {})));
    await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).init().catch(() => {})));

    const id = () => new mongoose.Types.ObjectId();
    const square = (lng, lat, d = 0.05) => ({ type: 'Polygon', coordinates: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]] });
    const zone = (await M('TaxiZone').collection.insertOne({ name: 'Indore taxi', geometry: square(75.85, 22.72) })).insertedId;
    const A = await FranchiseApplication.create({
        applicantName: 'A', email: 'a@t.in', phone: '9500000000', state: 'MP', city: 'Indore', status: 'approved',
        selectedModules: ['taxi'], taxiZoneId: zone, franchiseFeeStatus: 'paid',
        createdAt: new Date(ATTRIBUTION_STARTED_AT.getTime() - 86400000),
    });
    await FranchiseApplication.collection.updateOne({ _id: A._id }, { $set: { createdAt: new Date(ATTRIBUTION_STARTED_AT.getTime() - 86400000), franchiseFeePaidAt: null, reviewedAt: null } });
    const after = new Date(Math.max(Date.now(), ATTRIBUTION_STARTED_AT.getTime() + 3600000));
    const before = new Date(ATTRIBUTION_STARTED_AT.getTime() - 3600000);
    const istDay = (offsetDays) => new Date(Date.now() + 330 * 60000 + offsetDays * 86400000).toISOString().slice(0, 10);
    const rows = (sid) => FranchiseLedger.find({ sourceId: String(sid) }).lean();
    const earning = async (sid) => (await rows(sid)).find((r) => r.type === 'earning');

    console.log('\nbus');
    const bus = (await M('TaxiBusService').collection.insertOne({ busName: 'Indore Express', franchiseId: A._id, adminCommissionPercentage: 10, status: 'active' })).insertedId;
    const ticket = (fields) => M('TaxiBusBooking').collection.insertOne({
        busServiceId: bus, bookingCode: `B${Math.random().toString(36).slice(2, 7)}`, travelDate: istDay(-1), amount: 500,
        status: 'confirmed', payment: { status: 'paid' }, createdAt: after, franchiseCreditCheckedAt: null, ...fields,
    }).then((r) => r.insertedId);
    const travelled = await ticket({});
    const today = await ticket({ travelDate: istDay(0) });
    const unpaid = await ticket({ payment: { status: 'created' } });
    const old = await ticket({ createdAt: before });

    await check('a travelled, paid ticket earns 10% of the fare as the base', async () => {
        await taxi.creditFranchiseForBusBookings();
        assert.equal((await earning(travelled))?.amount, 50);
        const b = await M('TaxiBusBooking').findById(travelled).lean();
        assert.equal(String(b.franchiseApplicationId), String(A._id), 'franchise stamp not kept');
        assert.ok(b.franchiseCreditCheckedAt, 'checked stamp not kept');
    });
    await check("today's trip, unpaid and pre-cutoff tickets earn nothing", async () => {
        assert.equal((await rows(today)).length, 0);
        assert.equal((await rows(unpaid)).length, 0);
        assert.equal((await rows(old)).length, 0);
        assert.ok((await M('TaxiBusBooking').findById(old).lean()).franchiseCreditCheckedAt, 'pre-cutoff ticket should be marked checked');
    });
    await check('running again credits nothing twice', async () => {
        assert.equal(await taxi.creditFranchiseForBusBookings(), 0);
        assert.equal((await rows(travelled)).filter((r) => r.type === 'earning').length, 1);
    });
    await check('the sweep moves past a full batch', async () => {
        const many = await Promise.all([1, 2, 3].map(() => ticket({})));
        await taxi.creditFranchiseForBusBookings(2);
        await taxi.creditFranchiseForBusBookings(2);
        for (const t of many) assert.ok(await earning(t), `ticket ${t} never credited`);
    });

    console.log('\npooling and rental');
    const route = (await M('TaxiPoolingRoute').collection.insertOne({ name: 'R', stops: [{ id: 's1', latitude: 22.72, longitude: 75.85 }] })).insertedId;
    const pool = (await M('TaxiPoolingBooking').collection.insertOne({
        route, pickupStopId: 's1', fare: 300, adminCommissionAmount: 30, bookingStatus: 'completed', paymentStatus: 'paid', createdAt: after, franchiseCreditCheckedAt: null,
    })).insertedId;
    const rental = (await M('TaxiRentalBookingRequest').collection.insertOne({
        serviceLocation: { latitude: 22.72, longitude: 75.85 }, totalCost: 1000, status: 'completed', paymentStatus: 'paid', createdAt: after, franchiseCreditCheckedAt: null,
    })).insertedId;

    await check('switched off (the default): nothing earned and nothing marked', async () => {
        await taxi.creditFranchiseForPoolingAndRental();
        assert.equal((await rows(pool)).length, 0);
        assert.equal((await rows(rental)).length, 0);
        assert.equal((await M('TaxiPoolingBooking').findById(pool).lean()).franchiseCreditCheckedAt, null);
    });
    await check('switched on: pooling earns its recorded commission, rental the set %', async () => {
        await FranchiseFormConfig.collection.updateOne({}, { $set: { taxiSettings: { services: { pooling: true, rental: true }, serviceCommission: { pooling: 10, rental: 10 } } } }, { upsert: true });
        taxi.invalidateTaxiSettings();
        await taxi.creditFranchiseForPoolingAndRental();
        assert.equal((await earning(pool))?.amount, 30);
        assert.equal((await earning(rental))?.amount, 100);
        assert.equal(String((await M('TaxiPoolingBooking').findById(pool).lean()).franchiseApplicationId), String(A._id));
        assert.equal(await taxi.creditFranchiseForPoolingAndRental(), 0);
    });

    console.log('\nthe partner sees them');
    await check('each kind lists only what was credited to the franchise', async () => {
        const busList = await taxi.listTaxiBookings(A._id, { service: 'bus' });
        assert.equal(busList.items.length, 4);
        assert.ok(busList.items.every((r) => r.franchiseEarned > 0));
        assert.equal((await taxi.listTaxiBookings(A._id, { service: 'pooling' })).items.length, 1);
        assert.equal((await taxi.listTaxiBookings(A._id, { service: 'rental' })).items.length, 1);
    });
    await check('the full sweep runs the new steps', async () => {
        const r = await attribution.runFranchiseEarningsSweep();
        assert.equal(typeof r.busCredited, 'number', `bus: ${r.busCredited}`);
        assert.equal(typeof r.poolingRentalCredited, 'number', `pooling/rental: ${r.poolingRentalCredited}`);
    });

    await mongoose.disconnect();
    await mongo.stop();
    console.log(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed\n');
    process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('FAILED:', err); process.exit(1); });
