import FranchiseApplication from '../../admin/models/franchiseApplication.model.js';
import { FoodAdmin } from '../../../../core/admin/admin.model.js';
import { availableBalance } from '../../admin/services/franchiseLedger.service.js';
import { writeAudit } from '../../admin/services/franchiseAudit.service.js';
import { toPaise, fromPaise } from '../../admin/services/franchiseMoney.js';

/**
 * FRANCHISE PAYOUTS, the partner's side.
 *
 * The partner asks; the platform super admin pays by bank or UPI transfer and records the
 * reference (franchise.service.js updatePayoutRequestStatus), which debits the wallet in
 * the same transaction. This side never moves money.
 *
 * Guard rails, because a payout is where a stolen login turns into stolen money:
 *  - A payout always goes to the SAVED payee details, never to details sent with the request.
 *  - Changing payee details needs the login password again, is refused while a payout is
 *    pending, is audited, and stamps paymentAccountInfo.updatedAt so the admin's payout
 *    screen can flag a request made right after a change.
 *  - One pending request at a time, claimed with a single conditional update, so a double
 *    click or two tabs can never reserve the same balance twice.
 */
export class PayoutError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
    }
}

const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT = /^\d{9,18}$/;
const UPI = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/;
const AMOUNT = /^\d+(\.\d{1,2})?$/;

const maskAccount = (v) => (v ? `${'•'.repeat(Math.max(0, Math.min(8, v.length - 4)))}${v.slice(-4)}` : '');
const maskUpi = (v) => {
    if (!v) return '';
    const [name, handle] = String(v).split('@');
    return `${name.slice(0, 2)}${'•'.repeat(Math.max(1, Math.min(6, name.length - 2)))}@${handle || ''}`;
};

const payeeDto = (p = {}) => ({
    accountHolderName: p.accountHolderName || '',
    bankName: p.bankName || '',
    accountNumber: maskAccount(p.accountNumber),
    ifscCode: p.ifscCode || '',
    upiId: maskUpi(p.upiId),
    hasBank: Boolean(p.accountNumber && p.ifscCode),
    hasUpi: Boolean(p.upiId),
    updatedAt: p.updatedAt || null,
});

const requestDto = (r) => ({
    requestId: r.requestId,
    amount: r.amount,
    payoutMethod: r.payoutMethod,
    payTo: r.payoutMethod === 'upi' ? maskUpi(r.accountDetails?.upiId) : maskAccount(r.accountDetails?.accountNumber),
    status: r.status,
    requestedAt: r.requestedAt,
    processedAt: r.processedAt || null,
    reference: r.status === 'approved' ? (r.transactionId || '') : '',
    adminNote: r.status === 'rejected' ? (r.adminNote || '') : '',
});

const feeSettled = (app) => ['paid', 'waived'].includes(app.franchiseFeeStatus);

async function loadApp(franchiseId) {
    const app = await FranchiseApplication.findById(franchiseId)
        .select('applicantName franchiseFeeStatus walletBalance walletBalancePaise payoutRequests payoutCycle minPayoutThreshold paymentAccountInfo')
        .lean();
    if (!app) throw new PayoutError('Franchise not found', 404);
    return app;
}

const actorFor = (req) => ({ id: req.user?.userId || null, name: 'Franchise partner', email: '', level: 'franchise', ip: String(req.ip || '').slice(0, 64) });

/** Everything the payout screen needs. */
export async function getPayouts(franchiseId) {
    const app = await loadApp(franchiseId);
    const requests = [...(app.payoutRequests || [])].sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
    return {
        wallet: fromPaise(Number.isFinite(app.walletBalancePaise) ? app.walletBalancePaise : toPaise(app.walletBalance)),
        available: availableBalance(app),
        minPayout: Number(app.minPayoutThreshold) || 0,
        payoutCycle: app.payoutCycle || 'weekly',
        feeSettled: feeSettled(app),
        payee: payeeDto(app.paymentAccountInfo),
        pending: requests.find((r) => r.status === 'pending') ? requestDto(requests.find((r) => r.status === 'pending')) : null,
        requests: requests.slice(0, 50).map(requestDto),
    };
}

/** Ask for a payout of `amount` to the saved bank account or UPI id (`method`). */
export async function requestPayout(req, { amount, method } = {}) {
    const fid = req.user.franchiseId;
    const app = await loadApp(fid);
    if (!feeSettled(app)) throw new PayoutError('Pay the franchise fee before requesting payouts');

    const raw = String(amount ?? '').trim();
    if (!AMOUNT.test(raw) || Number(raw) <= 0) throw new PayoutError('Enter an amount in rupees, up to 2 decimals');
    const paise = toPaise(Number(raw));
    const value = fromPaise(paise);
    const min = Number(app.minPayoutThreshold) || 0;
    if (value < min) throw new PayoutError(`The minimum payout is ₹${min}`);
    const available = availableBalance(app);
    if (value > available) throw new PayoutError(`You can request up to ₹${available}`);

    const payee = app.paymentAccountInfo || {};
    const payoutMethod = method === 'upi' ? 'upi' : 'bank';
    if (payoutMethod === 'bank' && !(payee.accountNumber && payee.ifscCode)) throw new PayoutError('Add your bank account first');
    if (payoutMethod === 'upi' && !payee.upiId) throw new PayoutError('Add your UPI id first');

    const requestId = `PAY-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    const entry = {
        requestId,
        amount: value,
        payoutMethod,
        accountDetails: payoutMethod === 'upi'
            ? { upiId: payee.upiId, accountHolderName: payee.accountHolderName || app.applicantName }
            : { bankName: payee.bankName, accountNumber: payee.accountNumber, ifscCode: payee.ifscCode, accountHolderName: payee.accountHolderName || app.applicantName },
        status: 'pending',
        requestedAt: new Date(),
    };
    // Only when nothing is pending: the condition and the push are one atomic update.
    const res = await FranchiseApplication.updateOne(
        { _id: app._id, payoutRequests: { $not: { $elemMatch: { status: 'pending' } } } },
        { $push: { payoutRequests: entry } },
    );
    if (res.modifiedCount === 0) throw new PayoutError('You already have a payout request waiting. Cancel it or wait for it to be paid.', 409);

    await writeAudit({
        actor: actorFor(req), franchiseId: app._id, entity: 'payout', entityId: requestId, action: 'payout.requested',
        before: null, after: { amount: value, method: payoutMethod }, reason: '',
    });
    return getPayouts(fid);
}

/** Withdraw a pending request before the admin pays it. */
export async function cancelPayout(req, requestId) {
    const fid = req.user.franchiseId;
    const id = String(requestId || '').slice(0, 40);
    const res = await FranchiseApplication.updateOne(
        { _id: fid, payoutRequests: { $elemMatch: { requestId: id, status: 'pending' } } },
        { $set: { 'payoutRequests.$.status': 'cancelled', 'payoutRequests.$.processedAt': new Date() } },
    );
    if (res.modifiedCount === 0) {
        const exists = await FranchiseApplication.exists({ _id: fid, 'payoutRequests.requestId': id });
        throw exists ? new PayoutError('This request is no longer waiting, so it cannot be cancelled', 409) : new PayoutError('Payout request not found', 404);
    }
    await writeAudit({
        actor: actorFor(req), franchiseId: fid, entity: 'payout', entityId: id, action: 'payout.cancelled',
        before: { status: 'pending' }, after: { status: 'cancelled' }, reason: 'Cancelled by the partner',
    });
    return getPayouts(fid);
}

/**
 * Save the payee details. Needs the login password; refused while a payout is pending.
 * A bank account (holder, number, IFSC), a UPI id, or both. Empty fields clear that method.
 */
export async function updatePayee(req, body = {}) {
    const fid = req.user.franchiseId;
    const login = await FoodAdmin.findById(req.user.userId);
    if (!login || !body.currentPassword || !(await login.comparePassword(String(body.currentPassword)))) {
        throw new PayoutError('Your password is not correct', 403);
    }
    const app = await loadApp(fid);
    if ((app.payoutRequests || []).some((r) => r.status === 'pending')) {
        throw new PayoutError('You have a payout waiting. Change your payment details after it is paid or cancelled.', 409);
    }

    const s = (v, max) => String(v ?? '').trim().slice(0, max);
    const next = {
        accountHolderName: s(body.accountHolderName, 120),
        bankName: s(body.bankName, 80),
        accountNumber: s(body.accountNumber, 18).replace(/\s+/g, ''),
        ifscCode: s(body.ifscCode, 11).toUpperCase(),
        upiId: s(body.upiId, 120),
    };
    const anyBank = next.accountNumber || next.ifscCode || next.bankName;
    if (anyBank) {
        if (next.accountHolderName.length < 2) throw new PayoutError('Enter the account holder name as on the bank account');
        if (!ACCOUNT.test(next.accountNumber)) throw new PayoutError('The account number must be 9 to 18 digits');
        if (!IFSC.test(next.ifscCode)) throw new PayoutError('The IFSC code looks wrong. It is 11 characters, like SBIN0001234');
        if (next.bankName.length < 2) throw new PayoutError('Enter the bank name');
    }
    if (next.upiId && !UPI.test(next.upiId)) throw new PayoutError('The UPI id looks wrong. It looks like name@bank');
    if (!anyBank && !next.upiId) throw new PayoutError('Add a bank account or a UPI id');

    const updatedAt = new Date();
    // Conditional on still having nothing pending, in case a request arrived meanwhile.
    const res = await FranchiseApplication.updateOne(
        { _id: app._id, payoutRequests: { $not: { $elemMatch: { status: 'pending' } } } },
        { $set: { paymentAccountInfo: { ...next, updatedAt } } },
    );
    if (res.matchedCount === 0) throw new PayoutError('You have a payout waiting. Change your payment details after it is paid or cancelled.', 409);

    await writeAudit({
        actor: actorFor(req), franchiseId: app._id, entity: 'payee', entityId: String(app._id), action: 'payee.updated',
        before: payeeDto(app.paymentAccountInfo), after: payeeDto({ ...next, updatedAt }), reason: 'Changed by the partner',
    });
    return getPayouts(fid);
}

export { maskAccount, maskUpi };
