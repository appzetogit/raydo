/**
 * An approved driver for Play Store / App Store review, on a fixed-OTP number
 * (REVIEW_OTP_PHONES in the server's .env; see core/otp/reviewOtp.js).
 *
 * Zone, location and vehicle are copied from an existing approved driver, so it
 * behaves like a real one. The password is random: this account signs in by OTP.
 * The delivery-app record is built from this driver on first login. Safe to
 * re-run: if the driver already exists it is only reported, never duplicated.
 *
 *   node scripts/seed-play-review-driver.mjs            # dry run
 *   node scripts/seed-play-review-driver.mjs --apply
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import mongoose from 'mongoose';

const PHONE = '7470311228';
const NAME = 'Raydo Test Driver';
const apply = process.argv.includes('--apply');

await mongoose.connect(process.env.MONGODB_URI);
try {
    const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
    const { hashPassword } = await import('../src/modules/taxi/driver/services/authService.js');

    const existing = await Driver.findOne({ phone: { $regex: new RegExp(`${PHONE}$`) } }).lean();
    if (existing) {
        console.log(`exists: ${existing.name} (${existing._id}) status=${existing.status} approve=${existing.approve}`);
    } else {
        const t = await Driver.findOne({
            approve: true, status: 'approved', deletedAt: null,
            vehicleTypeId: { $ne: null }, zoneId: { $ne: null },
        }).lean();
        if (!t) throw new Error('no approved driver with a vehicle and zone to copy from');
        const copy = (keys) => Object.fromEntries(keys.filter((k) => t[k] !== undefined).map((k) => [k, t[k]]));
        const doc = {
            ...copy(['service_location_id', 'country', 'zoneId', 'location', 'city', 'vehicleType', 'vehicleTypeId',
                'vehicleIconType', 'vehicleMake', 'vehicleModel', 'vehicleColor', 'registerFor', 'serviceCategories']),
            name: NAME,
            phone: PHONE,
            email: 'review-driver@quickdropsindia.com',
            gender: 'male',
            password: await hashPassword(crypto.randomBytes(24).toString('hex')),
            vehicleNumber: 'MP09RV0001',
            serviceCapabilities: ['taxi', 'delivery'],
            approve: true,
            status: 'approved',
            isOnline: false,
        };
        if (!apply) {
            console.log(`would create ${NAME} on ${PHONE}: ${doc.vehicleType} in ${doc.city || 'unknown city'}, zone ${doc.zoneId}`);
        } else {
            const d = await Driver.create(doc);
            console.log(`created ${NAME} (${d._id}) on ${PHONE}: status=approved`);
        }
    }
} finally {
    await mongoose.disconnect();
}
