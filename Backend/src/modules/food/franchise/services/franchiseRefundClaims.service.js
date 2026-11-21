import mongoose from 'mongoose';
import FranchiseApplication from '../../admin/models/franchiseApplication.model.js';
import FranchiseLedger from '../../admin/models/franchiseLedger.model.js';
import { postRowsInSession, reverseFoodOrder } from '../../admin/services/franchiseLedger.service.js';
import { writeAudit } from '../../admin/services/franchiseAudit.service.js';
import { toPaise, fromPaise } from '../../admin/services/franchiseMoney.js';
import { withTransaction, opts } from '../../admin/services/franchiseTx.js';
import { logger } from '../../../../utils/logger.js';

/**
 * FRANCHISE REFUND CLAIMS
 *
 * A franchise sometimes refunds a customer itself (a cash order cancelled at the door, a
 * complaint settled on the spot) and asks the platform for that money back. The partner
 * files a claim with how it paid and the payment reference; the platform super admin
 * checks it and approves (the wallet is credited once) or rejects it.
 *
 * Rules
 *  - Only the franchise's own orders (order.franchiseId), delivered or cancelled, placed in
 *    the last CLAIM_WINDOW_DAYS days.
 *  - A claim is at most: order total - what the platform already refunded on the order -
 *    every other open or approved claim on it. So the customer's money is paid back at
 *    most once in total, whoever paid it.
 *  - One open claim per order. The partner can withdraw it while it waits.
 *  - Approving is one transaction: the claim is taken from "waiting" to "approved" only if
 *    it is still waiting, and the reimbursement row (unique per claim) and wallet move with
 *    it. Then the franchise's earning on the refunded share is taken back, as for any refund.
 *
 * This replaces the claim functions in franchise.public.service.js / franchise.service.js,
 * which required an order flag ("refund paid by the franchise") that nothing ever sets.
 */
export const CLAIM_WINDOW_DAYS = 30;
const WAITING = 'claimed_from_admin';
const APPROVED = 'approved_by_admin';
const OPEN = [WAITING];
const COUNTED = [WAITING, APPROVED, 'pending', 'processed'];

export class ClaimError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
    }
}

const AMOUNT = /^\d+(\.\d{1,2})?$/;
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));
const model = (name) => mongoose.models[name] || null;
const orderLabel = (o) => o.order_id || o.orderId || String(o._id).slice(-8);

const claimDto = (c) => ({
    id: c.id,
    orderId: c.orderMongoId ? String(c.orderMongoId) : c.orderId,
    orderCode: c.orderId,
    restaurantName: c.merchantName || '',
    amount: c.amount,
    paidVia: c.paidVia || '',
    paymentReference: c.paymentReference || '',
    reason: c.reason || c.claimReason || '',
    status: c.status === 'cancelled' ? 'cancelled'
        : c.status === APPROVED || c.status === 'processed' ? 'approved'
        : c.status === 'rejected' ? 'rejected' : 'waiting',
    adminNote: c.adminNote || '',
    claimedAt: c.claimedAt || c.requestedTime || null,
    decidedAt: c.decidedAt || c.processedAt || null,
});

const sameOrder = (c, order) => (c.orderMongoId && String(c.orderMongoId) === String(order._id))
    || c.orderId === String(order._id) || c.orderId === orderLabel(order);

/** Paise still claimable on an order, given the claims already on the franchise. */
function claimablePaise(order, claims, { exceptId = null } = {}) {
    const total = toPaise(Number(order.pricing?.total) || 0);
    const refund = order.payment?.refund;
    const platformRefunded = refund?.status === 'processed' ? toPaise(Number(refund.amount) || 0) : 0;
    const claimed = claims
        .filter((c) => c.id !== exceptId && COUNTED.includes(c.status) && sameOrder(c, order))
        .reduce((s, c) => s + toPaise(Number(c.amount) || 0), 0);
    return Math.max(0, total - platformRefunded - claimed);
}

async function loadClaims(franchiseId) {
    const app = await FranchiseApplication.findById(franchiseId).select('refundRequests').lean();
    if (!app) throw new ClaimError('Franchise not found', 404);
    return { app, claims: app.refundRequests || [] };
}

async function franchiseOrder(franchiseId, orderId) {
    const FoodOrder = model('FoodOrder');
    if (!FoodOrder || !isId(orderId)) throw new ClaimError('Order not found', 404);
    const order = await FoodOrder.findOne({ _id: orderId, franchiseId })
        .select('order_id orderId restaurantId orderStatus pricing.total payment.refund payment.method createdAt').lean();
    if (!order) throw new ClaimError('Order not found', 404);
    return order;
}

const actorFor = (req) => ({ id: req.user?.userId || null, name: 'Franchise partner', email: '', level: 'franchise', ip: String(req.ip || '').slice(0, 64) });

/* =============================== PARTNER =============================== */

export async function listClaims(franchiseId) {
    const { claims } = await loadClaims(franchiseId);
    const rows = [...claims].sort((a, b) => new Date(b.claimedAt || b.requestedTime) - new Date(a.claimedAt || a.requestedTime));
    return {
        windowDays: CLAIM_WINDOW_DAYS,
        items: rows.slice(0, 100).map(claimDto),
        waiting: rows.filter((c) => OPEN.includes(c.status)).length,
    };
}

/** What can still be claimed on one order (for the claim form). */
export async function claimableForOrder(franchiseId, orderId) {
    const order = await franchiseOrder(franchiseId, orderId);
    const { claims } = await loadClaims(franchiseId);
    const reason = eligibility(order);
    return {
        orderId: String(order._id),
        orderCode: orderLabel(order),
        total: Number(order.pricing?.total) || 0,
        platformRefunded: order.payment?.refund?.status === 'processed' ? Number(order.payment.refund.amount) || 0 : 0,
        claimable: reason ? 0 : fromPaise(claimablePaise(order, claims)),
        openClaim: claims.some((c) => OPEN.includes(c.status) && sameOrder(c, order)),
        notAllowed: reason || '',
    };
}

function eligibility(order) {
    const delivered = order.orderStatus === 'delivered';
    const cancelled = /^cancel/.test(String(order.orderStatus || ''));
    if (!delivered && !cancelled) return 'Only delivered or cancelled orders can have a refund claim';
    if (Date.now() - new Date(order.createdAt).getTime() > CLAIM_WINDOW_DAYS * 86400000) {
        return `Claims can be made for orders from the last ${CLAIM_WINDOW_DAYS} days`;
    }
    return '';
}

export async function createClaim(req, body = {}) {
    const fid = req.user.franchiseId;
    const order = await franchiseOrder(fid, body.orderId);
    const notAllowed = eligibility(order);
    if (notAllowed) throw new ClaimError(notAllowed);

    const raw = String(body.amount ?? '').trim();
    if (!AMOUNT.test(raw) || Number(raw) <= 0) throw new ClaimError('Enter the amount you refunded, in rupees, up to 2 decimals');
    const paise = toPaise(Number(raw));
    const paidVia = ['upi', 'bank', 'cash'].includes(body.paidVia) ? body.paidVia : '';
    if (!paidVia) throw new ClaimError('Choose how you paid the customer');
    const reference = String(body.paymentReference || '').trim().slice(0, 60);
    if (paidVia !== 'cash' && reference.length < 4) throw new ClaimError('Enter the UPI / bank payment reference of the refund');
    const reason = String(body.reason || '').trim().slice(0, 500);
    if (reason.length < 10) throw new ClaimError('Say in a sentence why the customer was refunded');

    const { claims } = await loadClaims(fid);
    if (claims.some((c) => OPEN.includes(c.status) && sameOrder(c, order))) {
        throw new ClaimError('This order already has a claim waiting', 409);
    }
    const left = claimablePaise(order, claims);
    if (paise > left) throw new ClaimError(left > 0 ? `You can claim up to ₹${fromPaise(left)} on this order` : 'Nothing is left to claim on this order', 400);

    const Restaurant = model('FoodRestaurant');
    const restaurant = Restaurant ? await Restaurant.findById(order.restaurantId).select('restaurantName').lean() : null;
    const id = `RC-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    const entry = {
        id,
        orderId: orderLabel(order),
        orderMongoId: order._id,
        merchantName: restaurant?.restaurantName || '',
        amount: fromPaise(paise),
        reason,
        claimReason: reason,
        method: paidVia,
        paidVia,
        paymentReference: reference,
        status: WAITING,
        claimedAt: new Date(),
        requestedTime: new Date(),
    };
    // Atomic: no other open claim for this order may have appeared in the meantime.
    const res = await FranchiseApplication.updateOne(
        { _id: fid, refundRequests: { $not: { $elemMatch: { orderMongoId: order._id, status: { $in: OPEN } } } } },
        { $push: { refundRequests: entry } },
    );
    if (res.modifiedCount === 0) throw new ClaimError('This order already has a claim waiting', 409);

    await writeAudit({
        actor: actorFor(req), franchiseId: fid, entity: 'refund_claim', entityId: id, action: 'refund_claim.filed',
        before: null, after: { order: entry.orderId, amount: entry.amount, paidVia, reference }, reason,
    });
    return listClaims(fid);
}

export async function cancelClaim(req, claimId) {
    const fid = req.user.franchiseId;
    const id = String(claimId || '').slice(0, 40);
    const res = await FranchiseApplication.updateOne(
        { _id: fid, refundRequests: { $elemMatch: { id, status: WAITING } } },
        { $set: { 'refundRequests.$.status': 'cancelled', 'refundRequests.$.decidedAt': new Date() } },
    );
    if (res.modifiedCount === 0) {
        const exists = await FranchiseApplication.exists({ _id: fid, 'refundRequests.id': id });
        throw exists ? new ClaimError('This claim is no longer waiting, so it cannot be withdrawn', 409) : new ClaimError('Claim not found', 404);
    }
    await writeAudit({
        actor: actorFor(req), franchiseId: fid, entity: 'refund_claim', entityId: id, action: 'refund_claim.withdrawn',
        before: { status: 'waiting' }, after: { status: 'cancelled' }, reason: 'Withdrawn by the partner',
    });
    return listClaims(fid);
}

/* ================================ ADMIN ================================ */

/**
 * Approve (reimburse) or reject a waiting claim. `decision`: 'approve' | 'reject'.
 * Approving re-checks the cap against the order as it is now.
 */
export async function decideClaim(franchiseId, claimId, { decision, adminNote } = {}, actor = {}) {
    if (!['approve', 'reject'].includes(decision)) throw new ClaimError('Decision must be approve or reject');
    const note = String(adminNote || '').trim().slice(0, 500);
    if (decision === 'reject' && note.length < 3) throw new ClaimError('Give the partner a reason for rejecting');
    if (!isId(franchiseId)) throw new ClaimError('Franchise not found', 404);

    const { app, claims } = await loadClaims(franchiseId);
    const claim = claims.find((c) => c.id === claimId);
    if (!claim) throw new ClaimError('Claim not found', 404);
    if (claim.status !== WAITING) throw new ClaimError(`This claim is already ${claimDto(claim).status}`, 409);

    let order = null;
    let paise = 0;
    if (decision === 'approve') {
        order = await franchiseOrder(app._id, claim.orderMongoId || claim.orderId);
        paise = toPaise(Number(claim.amount) || 0);
        const left = claimablePaise(order, claims, { exceptId: claim.id });
        if (paise <= 0 || paise > left) {
            throw new ClaimError(`Only ₹${fromPaise(left)} can still be paid back on this order (the platform may have refunded it meanwhile). Reject this claim and ask the partner to file the right amount.`, 409);
        }
    }

    const status = decision === 'approve' ? APPROVED : 'rejected';
    await withTransaction(async (session) => {
        const moved = await FranchiseApplication.updateOne(
            { _id: app._id, refundRequests: { $elemMatch: { id: claim.id, status: WAITING } } },
            { $set: {
                'refundRequests.$.status': status,
                'refundRequests.$.adminNote': note,
                'refundRequests.$.decidedAt': new Date(),
                'refundRequests.$.processedAt': new Date(),
            } },
            opts(session),
        );
        if (moved.modifiedCount === 0) throw new ClaimError('This claim was already decided', 409);
        if (decision === 'approve') {
            await postRowsInSession(session, app._id, [{
                franchiseId: app._id, module: 'food', account: 'wallet', type: 'refund_reimbursement',
                amountPaise: paise, amount: fromPaise(paise),
                refType: 'manual', refId: `refund-claim:${claim.id}`, sourceId: String(order._id), engineVersion: 2,
                createdBy: actor?.id || null,
                note: `Refund claim ${claim.id} for order ${claim.orderId} - reimbursed`,
            }]);
        }
        await writeAudit({
            actor, franchiseId: app._id, entity: 'refund_claim', entityId: claim.id, action: `refund_claim.${decision === 'approve' ? 'approved' : 'rejected'}`,
            before: { status: 'waiting', amount: claim.amount }, after: { status: claimDto({ ...claim, status }).status, amount: claim.amount }, reason: note,
        }, { session });
    });

    // The refunded share of the order no longer earns the franchise anything. Idempotent per
    // claim; a failure here is logged and does not undo the reimbursement.
    if (decision === 'approve') {
        try {
            const earned = await FranchiseLedger.exists({ franchiseId: app._id, refType: 'order', type: 'earning', sourceId: String(order._id) });
            if (earned) {
                await reverseFoodOrder(order._id, {
                    refundAmount: fromPaise(paise), orderTotal: Number(order.pricing?.total) || 0,
                    refundKey: `claim:${claim.id}`, note: `Refund claim ${claim.id}`,
                });
            }
        } catch (err) {
            logger.error(`[Franchise] earning reversal after refund claim ${claim.id} failed: ${err?.message || err}`);
        }
    }
    return { claims: (await listClaims(app._id)).items };
}
