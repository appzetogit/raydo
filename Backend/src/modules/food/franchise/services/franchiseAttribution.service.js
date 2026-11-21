import mongoose from 'mongoose';
import FranchiseApplication from '../../admin/models/franchiseApplication.model.js';
import FranchiseLedger from '../../admin/models/franchiseLedger.model.js';
import { creditFoodOrder, reverseFoodOrder } from '../../admin/services/franchiseLedger.service.js';
import { logger } from '../../../../utils/logger.js';

/**
 * FRANCHISE ATTRIBUTION (stage 3): which franchise an order, restaurant or ride belongs to,
 * and getting its earning into the franchise ledger.
 *
 * Food
 *   - An order is tagged at placement with the franchise operating the restaurant's food zone.
 *     The tag never changes afterwards, so moving a franchise's territory never moves money
 *     that was already earned.
 *   - When the order is delivered its earning is credited right away (creditOrderSoon), and a
 *     sweep every 10 minutes credits anything that was missed and reverses refunds.
 *   - Restaurants carry the franchise of their zone as a label for the franchise's lists.
 * Taxi
 *   - Rides are attributed by the driver's taxi zone when the ride is settled
 *     (franchiseTaxi.service.js creditFranchiseForRide), and the sweep retries missed ones.
 *
 * "Operating" means approved, joining fee paid or waived, not suspended or terminated, not
 * archived. A suspended franchise is not given new orders.
 *
 * Nothing before ATTRIBUTION_STARTED_AT is credited: orders tagged by the previous raydo.in
 * were never verified against this ledger, and back-dating money is the admin's call
 * (Franchise > Reconcile), not an automatic one.
 *
 * Every function here swallows its own errors. Attribution must never stop an order being
 * placed or delivered, or a ride being completed.
 */
export const ATTRIBUTION_STARTED_AT = new Date('2026-11-21T00:00:00+05:30');

const OPERATING_FOOD = {
    status: 'approved',
    franchiseFeeStatus: { $in: ['paid', 'waived'] },
    accountStatus: { $nin: ['suspended', 'terminated'] },
    archived: { $ne: true },
    selectedModules: 'food',
};

const isId = (v) => Boolean(v) && mongoose.Types.ObjectId.isValid(String(v));
const model = (name) => mongoose.models[name] || null;

/** The operating franchise of a food zone, or null. Oldest wins if two ever claim one zone. */
export async function foodFranchiseForZone(zoneId) {
    if (!isId(zoneId)) return null;
    const app = await FranchiseApplication.findOne({ ...OPERATING_FOOD, zoneId })
        .sort({ createdAt: 1 }).select('_id').lean();
    return app?._id || null;
}

/** Franchise id for a new order of this restaurant. Never throws: no franchise is a normal answer. */
export async function franchiseForNewOrder(restaurant) {
    try {
        return await foodFranchiseForZone(restaurant?.zoneId);
    } catch (err) {
        logger.warn(`[Franchise] order attribution failed for restaurant ${restaurant?._id}: ${err?.message || err}`);
        return null;
    }
}

/** Credit a delivered order's earning. Fire-and-forget: the delivery has already succeeded. */
export function creditOrderSoon(orderId) {
    setImmediate(async () => {
        try {
            const FoodOrder = model('FoodOrder');
            const order = FoodOrder && await FoodOrder.findById(orderId).lean();
            if (!order?.franchiseId || new Date(order.createdAt) < ATTRIBUTION_STARTED_AT) return;
            await creditFoodOrder(order);
        } catch (err) {
            logger.warn(`[Franchise] credit failed for order ${orderId}; the sweep will retry: ${err?.message || err}`);
        }
    });
}

/**
 * Keep restaurant labels in step with zone ownership: a restaurant belongs to the operating
 * franchise of its zone, or to none. Returns how many restaurants changed.
 */
export async function syncRestaurantLabels() {
    const FoodRestaurant = model('FoodRestaurant');
    if (!FoodRestaurant) return 0;
    const owners = await FranchiseApplication.find({ ...OPERATING_FOOD, zoneId: { $ne: null } })
        .sort({ createdAt: 1 }).select('_id zoneId').lean();
    const byZone = new Map();
    owners.forEach((a) => { if (!byZone.has(String(a.zoneId))) byZone.set(String(a.zoneId), a._id); });

    let changed = 0;
    for (const [zoneId, fid] of byZone) {
        const r = await FoodRestaurant.updateMany(
            { zoneId: new mongoose.Types.ObjectId(zoneId), franchiseId: { $ne: fid } },
            { $set: { franchiseId: fid } },
        );
        changed += r.modifiedCount || 0;
    }
    // Labelled with a franchise that no longer operates their zone.
    const zones = [...byZone.keys()].map((z) => new mongoose.Types.ObjectId(z));
    const stale = await FoodRestaurant.updateMany(
        { franchiseId: { $ne: null }, $or: [{ zoneId: { $nin: zones } }, { zoneId: null }] },
        { $set: { franchiseId: null } },
    );
    return changed + (stale.modifiedCount || 0);
}

/** Delivered, tagged orders from the last `days` with no earning posted yet. */
export async function creditMissedFoodOrders({ days = 7, limit = 500 } = {}) {
    const FoodOrder = model('FoodOrder');
    if (!FoodOrder) return 0;
    const since = new Date(Math.max(ATTRIBUTION_STARTED_AT.getTime(), Date.now() - days * 86400000));
    const orders = await FoodOrder.find({
        franchiseId: { $ne: null },
        orderStatus: 'delivered',
        createdAt: { $gte: ATTRIBUTION_STARTED_AT },
        updatedAt: { $gte: since },
    }).sort({ updatedAt: -1 }).limit(limit).lean();
    if (!orders.length) return 0;

    const posted = new Set((await FranchiseLedger.find({
        refType: 'order', type: 'earning', sourceId: { $in: orders.map((o) => String(o._id)) },
    }).select('sourceId').lean()).map((r) => r.sourceId));

    let credited = 0;
    for (const order of orders) {
        if (posted.has(String(order._id))) continue;
        try {
            if (await creditFoodOrder(order)) credited += 1;
        } catch (err) {
            logger.warn(`[Franchise] sweep credit failed for order ${order._id}: ${err?.message || err}`);
        }
    }
    return credited;
}

/**
 * Take earnings back for credited orders that were later refunded or cancelled.
 *  - payment refunded, or the order cancelled after all: the whole earning (key 'full')
 *  - a processed partial refund: the refunded share (key 'refund')
 * Each key posts once, and reversals never exceed what was credited.
 */
export async function reverseRefundedFoodOrders({ days = 30, limit = 1000 } = {}) {
    const FoodOrder = model('FoodOrder');
    if (!FoodOrder) return 0;
    const earned = await FranchiseLedger.find({
        refType: 'order', type: 'earning', engineVersion: 2,
        createdAt: { $gte: new Date(Date.now() - days * 86400000) },
    }).sort({ createdAt: -1 }).limit(limit).select('sourceId').lean();
    if (!earned.length) return 0;

    const ids = earned.map((r) => r.sourceId).filter(isId);
    const orders = await FoodOrder.find({ _id: { $in: ids } })
        .select('orderStatus payment.status payment.refund pricing.total').lean();

    let reversed = 0;
    for (const o of orders) {
        try {
            const payStatus = String(o.payment?.status || '').toLowerCase();
            const cancelled = /^cancel/.test(String(o.orderStatus || ''));
            const refund = o.payment?.refund;
            let row = null;
            if (payStatus === 'refunded' || cancelled) {
                row = await reverseFoodOrder(o._id, { refundKey: 'full', note: cancelled ? 'Order cancelled' : 'Order refunded' });
            } else if (refund?.status === 'processed' && Number(refund.amount) > 0 && Number(o.pricing?.total) > 0) {
                row = await reverseFoodOrder(o._id, { refundAmount: Number(refund.amount), orderTotal: Number(o.pricing.total), refundKey: 'refund' });
            }
            if (row) reversed += 1;
        } catch (err) {
            logger.warn(`[Franchise] sweep reversal failed for order ${o._id}: ${err?.message || err}`);
        }
    }
    return reversed;
}

/** The 10-minute job (maintenance queue). Each part runs even if another fails. */
export async function runFranchiseEarningsSweep() {
    // The worker process loads no models on its own; register the ones the sweep reads.
    await Promise.all([
        import('../../orders/models/order.model.js'),
        import('../../orders/models/foodTransaction.model.js'),
        import('../../restaurant/models/restaurant.model.js'),
        import('../../../taxi/user/models/Ride.js'),
        import('../../../taxi/driver/models/Driver.js'),
    ]);
    const { creditPendingFranchiseRides } = await import('../../admin/services/franchiseTaxi.service.js');

    const result = {};
    const step = async (key, fn) => {
        try {
            result[key] = await fn();
        } catch (err) {
            result[key] = `failed: ${err?.message || err}`;
            logger.error(`[Franchise] sweep step ${key} failed: ${err?.message || err}`);
        }
    };
    await step('restaurantLabels', syncRestaurantLabels);
    await step('foodCredited', creditMissedFoodOrders);
    await step('foodReversed', reverseRefundedFoodOrders);
    // Rides settled before attribution started are not back-dated either.
    const hoursSinceStart = (Date.now() - ATTRIBUTION_STARTED_AT.getTime()) / 3600000;
    await step('ridesCredited', () => (hoursSinceStart > 0
        ? creditPendingFranchiseRides({ windowHours: Math.min(24, hoursSinceStart) })
        : 0));
    return result;
}
