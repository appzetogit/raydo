import mongoose from 'mongoose';
import { FoodAdmin } from './admin.model.js';

/**
 * Franchise accounts carried over from the previous raydo.in.
 *
 * They hold no level this code recognises, so the admin policy falls through to full
 * access, and their older tokens say role ADMIN. There are no franchise isolation checks
 * here, so such a token would reach every order, restaurant and setting on the platform.
 * Until franchise logins are scoped again they are refused at every door.
 *
 * Read from the raw collection on purpose: franchiseId is not in the admin schema, so a
 * mongoose document would silently drop the one field that identifies these accounts.
 */
const TTL_MS = 15_000;
const cache = new Map();

export const isFranchiseAccount = (admin) => {
    if (!admin) return false;
    const fields = [admin.role, admin.admin_type, admin.adminLevel, admin.module];
    return Boolean(admin.franchiseId) || fields.some((value) => /franchise/i.test(String(value || '')));
};

export const isFranchiseAdminId = async (id) => {
    const key = String(id || '');
    if (!key) return false;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

    if (!mongoose.Types.ObjectId.isValid(key)) return false;

    const admin = await FoodAdmin.collection.findOne(
        { _id: new mongoose.Types.ObjectId(key) },
        { projection: { role: 1, admin_type: 1, adminLevel: 1, module: 1, franchiseId: 1 } },
    );
    const value = isFranchiseAccount(admin);
    cache.set(key, { at: Date.now(), value });
    return value;
};

export const FRANCHISE_LOCKED_MESSAGE = 'Franchise accounts are not available right now. Please contact support.';
