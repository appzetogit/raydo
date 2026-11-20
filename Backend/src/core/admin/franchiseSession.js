import mongoose from 'mongoose';
import { FoodAdmin } from './admin.model.js';
import { isFranchiseAccount } from './franchiseLockout.js';
import { verifyAccessToken } from '../auth/token.util.js';
import { sendError } from '../../utils/response.js';

/**
 * Franchise partner logins (stage 2).
 *
 * A franchise login is an admin account with franchiseId set. It is still refused at
 * every admin, taxi and socket door (franchiseLockout.js): those APIs have no franchise
 * isolation. Instead it gets its own token, role FRANCHISE, from POST /auth/franchise/login,
 * and that token opens only the /v1/franchise API, where every query is limited to the
 * franchise by construction.
 *
 * The franchise id is never read from the token or the request. On every request it is
 * looked up from the login account, and the franchise must point back at that same login
 * (subAdminId), be approved, active and not archived. Suspending a franchise, terminating
 * it or locking the login for an unpaid fee shuts the session on the next request.
 */
export const FRANCHISE_ROLE = 'FRANCHISE';

export class FranchiseSessionError extends Error {
    constructor(message, statusCode = 403) {
        super(message);
        this.name = 'FranchiseSessionError';
        this.statusCode = statusCode;
    }
}

const INACTIVE = 'This franchise account is not active. Please contact support.';

/**
 * The login account and its franchise, or throws. `adminId` is the token's subject.
 * Read from the raw collection: franchiseId is in the schema now, but older logins
 * carry fields (status, active) the schema does not declare.
 */
export async function resolveFranchiseLogin(adminId) {
    const key = String(adminId || '');
    if (!mongoose.Types.ObjectId.isValid(key)) throw new FranchiseSessionError('Franchise login required', 401);
    const _id = new mongoose.Types.ObjectId(key);

    const admin = await FoodAdmin.collection.findOne(
        { _id },
        { projection: { email: 1, name: 1, role: 1, admin_type: 1, adminLevel: 1, module: 1, franchiseId: 1, isActive: 1, active: 1 } },
    );
    if (!admin || !isFranchiseAccount(admin) || !admin.franchiseId) {
        throw new FranchiseSessionError('Franchise login required', 401);
    }
    if (admin.isActive === false || admin.active === false) throw new FranchiseSessionError(INACTIVE);

    const { default: FranchiseApplication } = await import('../../modules/food/admin/models/franchiseApplication.model.js');
    const app = await FranchiseApplication.findById(admin.franchiseId)
        .select('applicantName companyName selectedModules zoneId taxiZoneId status accountStatus archived subAdminId')
        .lean();
    // The franchise must name this account as its login: a login left linked to a
    // franchise that has since been given a different login gets nothing.
    if (!app || String(app.subAdminId || '') !== key) throw new FranchiseSessionError(INACTIVE);
    // Records made before accountStatus existed have none: they are active.
    if (app.archived || app.status !== 'approved' || (app.accountStatus || 'active') !== 'active') {
        throw new FranchiseSessionError(INACTIVE);
    }
    return { admin, franchise: app };
}

/**
 * Guard for the /v1/franchise API. Accepts only a FRANCHISE token; an admin, user,
 * rider or store token is refused here just as a franchise token is refused elsewhere.
 * Sets req.user.franchiseId and req.franchise from the database.
 */
export async function requireFranchiseSession(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return sendError(res, 401, 'Authentication token missing');

    let decoded;
    try {
        decoded = verifyAccessToken(token);
    } catch {
        return sendError(res, 401, 'Invalid or expired token');
    }
    if (String(decoded.role || '').toUpperCase() !== FRANCHISE_ROLE) {
        return sendError(res, 403, 'Franchise login required');
    }

    try {
        const userId = String(decoded.userId || decoded.sub || '');
        const { franchise } = await resolveFranchiseLogin(userId);
        req.user = { userId, role: FRANCHISE_ROLE, franchiseId: String(franchise._id) };
        req.franchise = franchise;
        return next();
    } catch (err) {
        if (err instanceof FranchiseSessionError) return sendError(res, err.statusCode, err.message);
        return next(err);
    }
}
