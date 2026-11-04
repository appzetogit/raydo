/**
 * The fare for a ride, from its vehicle's price row.
 *
 * One calculation, used by the booking (rideService.createRideRecord) and by the
 * quote the app shows before booking (POST /rides/quote), so the figure a rider
 * confirms and the figure they are charged cannot drift apart. The app used to
 * run its own copy of this, which disagreed in three ways -- it charged time
 * inside the base distance, and knew nothing of the platform fee or surge -- and
 * fell back to another vehicle's rates when a vehicle had none.
 *
 * The rules, exactly as the booking has always charged them:
 *   - Within the base distance the fare is the base price alone.
 *   - Past it: base + (km past the base) x per-km + minutes x per-minute.
 *   - Raised to the row's minimum fare, then its night percentage on top while
 *     the night window runs (India time). Neither applies to outstation rides.
 *   - Service tax on that subtotal, then the platform fee on top, untaxed.
 *   - Rounded to a whole rupee, then the zone's surge (also whole rupees) added,
 *     so the total a rider is charged never carries paise.
 *
 * Returns null when there is nothing to charge from: no row, or a row whose
 * prices are all zero. A caller must refuse the ride then -- never fall back to
 * a figure the app sent.
 */
import { resolvePlatformFee } from './platformFee.js';
import { localClock, parseTime } from './surgeSlot.js';

const money = (value) => Math.round(value * 100) / 100;

/** A window whose end is at or before its start runs past midnight. 22:00-06:00 is the default. */
export function isNightFareTime(pricingRule, at = new Date()) {
    const start = parseTime(pricingRule?.night_fare_start) ?? parseTime('22:00');
    const end = parseTime(pricingRule?.night_fare_end) ?? parseTime('06:00');
    const { minute } = localClock(at);
    return start > end ? (minute >= start || minute < end) : (minute >= start && minute < end);
}

export function computeRideFare({
    pricingRule,
    transportType = 'taxi',
    distanceMeters = 0,
    durationMinutes = 0,
    surgeAmount = 0,
    // A flat charge added to the vehicle's own base price (a parcel's weight
    // slot). It is part of the subtotal, so tax and the platform fee apply to it
    // exactly as they do to the base.
    extraAmount = 0,
    at = new Date(),
} = {}) {
    if (!pricingRule) return null;

    const isIntercity = String(transportType || '').trim().toLowerCase() === 'intercity';
    const rate = (outstation, local) =>
        Math.max(0, Number(pricingRule[isIntercity ? outstation : local] || 0));

    const basePrice = rate('outstation_base_price', 'base_price');
    const baseDistanceKm = rate('outstation_base_distance', 'base_distance');
    const perKm = rate('outstation_price_per_distance', 'price_per_distance');
    const perMinute = rate('outstation_time_price', 'time_price');
    const serviceTaxPercent = Math.max(0, Number(pricingRule.service_tax || 0));

    const distanceKm = Math.max(0, Number(distanceMeters) || 0) / 1000;
    const minutes = Math.max(0, Number(durationMinutes) || 0);
    const withinBase = baseDistanceKm > 0 && distanceKm <= baseDistanceKm;
    const weightCharge = Math.max(0, Number(extraAmount) || 0);

    const distanceFare = withinBase ? 0 : Math.max(0, distanceKm - baseDistanceKm) * perKm;
    const timeFare = withinBase ? 0 : minutes * perMinute;
    const meteredSubtotal = basePrice + weightCharge + distanceFare + timeFare;
    if (!(meteredSubtotal > 0)) return null;

    const minFare = isIntercity ? 0 : Math.max(0, Number(pricingRule.min_fare) || 0);
    const minFareTopUp = Math.max(0, minFare - meteredSubtotal);
    const nightPercent = isIntercity ? 0 : Math.max(0, Number(pricingRule.night_fare_percent) || 0);
    const nightCharge = nightPercent > 0 && isNightFareTime(pricingRule, at)
        ? ((meteredSubtotal + minFareTopUp) * nightPercent) / 100
        : 0;
    const subtotal = meteredSubtotal + minFareTopUp + nightCharge;

    const serviceTax = (subtotal * serviceTaxPercent) / 100;
    const platformFee = resolvePlatformFee(pricingRule, subtotal);
    // GST charged on top of the platform fee (untaxed itself). The rider sees it
    // folded into the platform-fee line as "Platform fee [₹10 + 18% GST]".
    const platformFeeGstPercent = Math.max(0, Number(pricingRule.platform_fee_gst || 0));
    const platformFeeGst = (platformFee * platformFeeGstPercent) / 100;
    const fareBeforeSurge = Math.max(0, Math.round(subtotal + serviceTax + platformFee + platformFeeGst));
    const surge = Math.round(Math.max(0, Number(surgeAmount) || 0));

    const lines = {
        baseFare: money(basePrice),
        weightCharge: money(weightCharge),
        distanceFare: money(distanceFare),
        timeFare: money(timeFare),
        minFareTopUp: money(minFareTopUp),
        nightCharge: money(nightCharge),
        serviceTax: money(serviceTax),
        platformFee: money(platformFee),
        platformFeeGst: money(platformFeeGst),
    };
    // Taken against the printed lines rather than the unrounded sum, so the
    // rows a rider sees add up to the total to the paisa.
    const printed = Object.values(lines).reduce((sum, value) => sum + value, 0);

    return {
        ...lines,
        subtotal: money(subtotal),
        serviceTaxPercent,
        platformFeeGstPercent,
        roundOff: money(fareBeforeSurge - printed),
        fareBeforeSurge,
        surge,
        total: money(fareBeforeSurge + surge),
    };
}
