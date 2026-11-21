import express from 'express';
import { sendError, sendResponse } from '../../../../utils/response.js';
import { requireFranchiseSession } from '../../../../core/admin/franchiseSession.js';
import { normalizeModules } from '../../admin/services/franchisePlan.js';
import * as portal from '../services/franchisePortal.service.js';
import * as partner from '../services/franchise.public.service.js';
import * as overview from '../../admin/services/franchiseOverview.service.js';
import * as taxi from '../../admin/services/franchiseTaxi.service.js';
import * as payouts from '../services/franchisePayouts.service.js';
import * as claims from '../services/franchiseRefundClaims.service.js';
import { sensitiveActionRateLimiter } from '../../../../middleware/rateLimit.js';

/**
 * /v1/franchise: the franchise partner's own API (stage 2).
 *
 * Every route runs behind requireFranchiseSession, which takes the franchise from the
 * login account, never from the request. Each handler passes req.user.franchiseId to
 * a service that matches on it, so no id in a path or query can reach another
 * franchise's rows. Records outside the franchise answer 404.
 *
 * Not mounted yet, on purpose: delivery fee changes, and the public application and fee
 * payment. Payouts and refund claims go through franchisePayouts.service.js and
 * franchiseRefundClaims.service.js, never the older partner functions in
 * franchise.public.service.js (a payee per request; a claim check that can never pass).
 */
const router = express.Router();
router.use(requireFranchiseSession);

// The list services copy some query values straight into a Mongo filter. They are
// already limited to the franchise, but keep operators like status[$ne]= out anyway.
router.use((req, _res, next) => {
    for (const [key, value] of Object.entries(req.query || {})) {
        if (typeof value !== 'string') delete req.query[key];
    }
    next();
});

const fid = (req) => req.user.franchiseId;
const wrap = (fn, message) => async (req, res, next) => {
    try {
        return sendResponse(res, 200, message, await fn(req));
    } catch (err) {
        return next(err);
    }
};

const requireModule = (module) => (req, res, next) => (
    normalizeModules(req.franchise?.selectedModules).includes(module)
        ? next()
        : sendError(res, 403, `Your franchise does not include the ${module === 'food' ? 'Food' : 'Taxi'} module`)
);

// Customers' phone numbers stay with the platform.
const withoutKeys = (keys) => (data) => ({
    ...data,
    items: (data?.items || []).map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)))),
});

// Some services hand back live mongoose subdocuments: spreading one copies its internal
// fields, payee details included, so turn it into a plain object first.
const maskedPayout = (row) => {
    const { accountDetails, ...p } = typeof row?.toObject === 'function' ? row.toObject() : row;
    return {
        ...p,
        payTo: p.payoutMethod === 'upi' ? payouts.maskUpi(accountDetails?.upiId) : payouts.maskAccount(accountDetails?.accountNumber),
    };
};

/* ---------------------------------------------------------------- account */
router.get('/me', wrap(async (req) => {
    const data = await partner.getPartnerDashboardData(null, null, { franchiseId: fid(req) });
    if (!data) return data;
    // The dashboard's recent-orders list carries customer phones as well, and the money
    // section the full payee details: /payouts serves those, masked.
    const { paymentAccountInfo, franchiseFeePaymentDetails, ...financialSettings } = data.financialSettings || {};
    return {
        ...data,
        financialSettings,
        payoutRequests: (data.payoutRequests || []).map(maskedPayout),
        territoryOrders: withoutKeys(['customerPhone'])({ items: data.territoryOrders }).items,
    };
}, 'Franchise fetched'));
router.get('/finance', wrap((req) => partner.getPartnerFinance(fid(req), req.query), 'Finance fetched'));
router.get('/ledger', wrap(async (req) => {
    const data = await overview.listFranchiseLedger(fid(req), req.query);
    return { ...data, payouts: (data.payouts || []).map(maskedPayout) };
}, 'Ledger fetched'));
router.post('/support-messages', wrap((req) => partner.submitPartnerSupportMessage(fid(req), req.body || {}), 'Message sent'));

/* ---------------------------------------------------------------- payouts */
router.get('/payouts', wrap((req) => payouts.getPayouts(fid(req)), 'Payouts fetched'));
router.post('/payouts', sensitiveActionRateLimiter, wrap((req) => payouts.requestPayout(req, req.body || {}), 'Payout requested'));
router.post('/payouts/:requestId/cancel', sensitiveActionRateLimiter, wrap((req) => payouts.cancelPayout(req, req.params.requestId), 'Payout cancelled'));
router.put('/payee', sensitiveActionRateLimiter, wrap((req) => payouts.updatePayee(req, req.body || {}), 'Payment details saved'));

/* ------------------------------------------------------------------- food */
const food = requireModule('food');
router.get('/restaurants', food, wrap((req) => overview.listFranchiseRestaurants(fid(req), req.query), 'Restaurants fetched'));
router.get('/orders', food, wrap(async (req) => withoutKeys(['customerPhone'])(await overview.listFranchiseOrders(fid(req), req.query)), 'Orders fetched'));
router.get('/payments', food, wrap((req) => portal.listFoodPayments(fid(req), req.query), 'Payments fetched'));
router.get('/delivery-fees', food, wrap((req) => portal.getDeliveryFees(fid(req)), 'Delivery fees fetched'));
router.get('/riders', food, wrap((req) => portal.listRiders(fid(req), req.query), 'Riders fetched'));
router.get('/riders/:riderId', food, wrap((req) => portal.getRider(fid(req), req.params.riderId), 'Rider fetched'));
router.post('/riders/:riderId/decision', food, wrap((req) => portal.decideRider(req, req.params.riderId, req.body || {}), 'Rider updated'));
// Refund claims: money the franchise paid a customer itself, claimed back from the platform.
router.get('/refund-claims', food, wrap((req) => claims.listClaims(fid(req)), 'Refund claims fetched'));
router.get('/refund-claims/order/:orderId', food, wrap((req) => claims.claimableForOrder(fid(req), req.params.orderId), 'Order checked'));
router.post('/refund-claims', food, sensitiveActionRateLimiter, wrap((req) => claims.createClaim(req, req.body || {}), 'Refund claim filed'));
router.post('/refund-claims/:claimId/withdraw', food, sensitiveActionRateLimiter, wrap((req) => claims.cancelClaim(req, req.params.claimId), 'Refund claim withdrawn'));

/* ------------------------------------------------------------------- taxi */
const cab = requireModule('taxi');
router.get('/taxi/overview', cab, wrap((req) => taxi.getTaxiOverview(fid(req)), 'Taxi overview fetched'));
router.get('/taxi/rides', cab, wrap(async (req) => withoutKeys(['riderPhone'])(await taxi.listTaxiRides(fid(req), req.query)), 'Rides fetched'));
router.get('/taxi/drivers', cab, wrap((req) => taxi.listTaxiDrivers(fid(req), req.query), 'Drivers fetched'));
// Bus, pooling and rental bookings credited to this franchise (?service=bus|pooling|rental).
router.get('/taxi/bookings', cab, wrap((req) => taxi.listTaxiBookings(fid(req), req.query), 'Bookings fetched'));
router.get('/taxi/drivers/:driverId', cab, wrap((req) => portal.getTaxiDriver(fid(req), req.params.driverId), 'Driver fetched'));
router.post('/taxi/drivers/:driverId/decision', cab, wrap((req) => portal.decideTaxiDriver(req, req.params.driverId, req.body || {}), 'Driver updated'));

export default router;
