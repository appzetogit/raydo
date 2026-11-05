/**
 * Fixed OTP for the accounts handed to Play Store / App Store reviewers, who
 * cannot receive an SMS on our test numbers.
 *
 * Unlike the development shortcuts in otp.service.js, this works in production,
 * so it is a sign-in bypass for exactly these numbers. It is therefore switched
 * on only by the server's environment, nothing here is hard-coded, and clearing
 * either variable turns it off.
 *
 *   REVIEW_OTP_PHONES=<10-digit number>,<10-digit number>
 *   REVIEW_OTP_CODE=<4 digits>
 */
const last10 = (phone) => {
    const digits = String(phone || '').replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-10) : '';
};

export const reviewOtpCode = () => {
    const code = String(process.env.REVIEW_OTP_CODE || '').trim();
    return /^\d{4}$/.test(code) ? code : '';
};

/** True only when the code is configured and this exact number is listed. */
export const isReviewOtpPhone = (phone) => {
    const target = last10(phone);
    if (!target || !reviewOtpCode()) return false;
    return String(process.env.REVIEW_OTP_PHONES || '')
        .split(',')
        .map(last10)
        .includes(target);
};
