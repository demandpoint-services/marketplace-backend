const SpaceBooking = require("../models/SpaceBooking");

const { checkBookingConflicts } = require("./spaceAvailabilityService");

function createPaymentError(message, code, status = 409) {
  const error = new Error(message);

  error.code = code;
  error.status = status;

  return error;
}

function normalizeMetadata(metadata) {
  if (!metadata) return {};

  if (typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata;
  }

  if (typeof metadata === "string") {
    try {
      const parsed = JSON.parse(metadata);

      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return {};
    }
  }

  return {};
}

async function confirmPaidSpaceBooking({ bookingId, transaction, expectedClientId = null }) {
  const booking = await SpaceBooking.findById(bookingId);

  if (!booking) {
    throw createPaymentError("Space booking not found.", "SPACE_BOOKING_NOT_FOUND", 404);
  }

  if (expectedClientId && String(booking.client) !== String(expectedClientId)) {
    throw createPaymentError(
      "You do not have access to this booking.",
      "SPACE_BOOKING_FORBIDDEN",
      403
    );
  }

  const reference = String(transaction?.reference || "").trim();

  if (!reference) {
    throw createPaymentError(
      "Payment transaction has no reference.",
      "SPACE_PAYMENT_REFERENCE_MISSING"
    );
  }

  if (booking.payment?.reference && booking.payment.reference !== reference) {
    throw createPaymentError(
      "Payment reference does not match this booking.",
      "SPACE_PAYMENT_REFERENCE_MISMATCH"
    );
  }

  const metadata = normalizeMetadata(transaction?.metadata);

  if (metadata.type && metadata.type !== "space_booking") {
    throw createPaymentError(
      "This payment does not belong to a space booking.",
      "SPACE_PAYMENT_TYPE_MISMATCH"
    );
  }

  if (metadata.bookingId && String(metadata.bookingId) !== String(booking._id)) {
    throw createPaymentError(
      "Payment metadata does not match this booking.",
      "SPACE_PAYMENT_METADATA_MISMATCH"
    );
  }

  if (String(transaction?.status || "") !== "success") {
    throw createPaymentError("Payment was not successful.", "SPACE_PAYMENT_NOT_SUCCESSFUL");
  }

  const expectedAmountKobo = Number(
    booking.payment?.requestedAmountKobo || booking.pricingSnapshot?.totalKobo
  );

  const paidAmountKobo = Number(transaction?.amount);

  if (!Number.isInteger(expectedAmountKobo) || expectedAmountKobo <= 0) {
    throw createPaymentError(
      "This booking has an invalid payment amount.",
      "INVALID_SPACE_PAYMENT_AMOUNT"
    );
  }

  /*
   * Same rule as marketplace checkout:
   *
   * Paystack may report a higher amount when
   * transaction fees are passed to the customer.
   */
  if (!Number.isInteger(paidAmountKobo) || paidAmountKobo < expectedAmountKobo) {
    booking.payment.status = "failed";

    booking.payment.failureReason =
      `Payment amount is insufficient. ` +
      `Expected at least ${expectedAmountKobo} kobo, ` +
      `received ${paidAmountKobo} kobo.`;

    booking.payment.verifiedAt = new Date();

    await booking.save();

    throw createPaymentError(
      "The amount paid is less than the booking total.",
      "SPACE_PAYMENT_AMOUNT_MISMATCH"
    );
  }

  const expectedCurrency = String(
    booking.payment?.currency || booking.pricingSnapshot?.currency || "NGN"
  ).toUpperCase();

  const receivedCurrency = String(transaction?.currency || "").toUpperCase();

  if (receivedCurrency !== expectedCurrency) {
    booking.payment.failureReason =
      `Payment currency mismatch. Expected ` +
      `${expectedCurrency}, received ` +
      `${receivedCurrency || "unknown"}.`;

    booking.payment.verifiedAt = new Date();

    await booking.save();

    throw createPaymentError(
      "Payment currency does not match the booking currency.",
      "SPACE_PAYMENT_CURRENCY_MISMATCH"
    );
  }

  /*
   * ========================================================
   * FINANCIAL TRUTH
   * ========================================================
   *
   * From here onward Paystack says real money was received.
   * Record that before attempting reservation confirmation.
   */

  const paidAt = transaction?.paid_at ? new Date(transaction.paid_at) : new Date();

  booking.payment.reference = reference;
  booking.payment.status = "paid";
  booking.payment.requestedAmountKobo = expectedAmountKobo;
  booking.payment.amountPaidKobo = paidAmountKobo;
  booking.payment.currency = receivedCurrency;
  booking.payment.transactionId = transaction?.id != null ? String(transaction.id) : "";
  booking.payment.channel = transaction?.channel || "";
  booking.payment.paidAt = paidAt;
  booking.payment.verifiedAt = new Date();
  booking.payment.failureReason = "";

  /*
   * Idempotency.
   *
   * Browser callback may already have confirmed it
   * before the webhook arrives, or vice versa.
   */
  if (booking.status === "confirmed") {
    await booking.save();

    return {
      booking,
      alreadyConfirmed: true,
      needsResolution: false,
    };
  }

  if (booking.status === "completed") {
    await booking.save();

    return {
      booking,
      alreadyConfirmed: true,
      needsResolution: false,
    };
  }

  /*
   * If the booking was deliberately cancelled or
   * declined before payment completed, money was still
   * received but we must not resurrect the reservation.
   */
  if (["cancelled", "declined"].includes(booking.status)) {
    booking.payment.status = "needs_resolution";

    booking.payment.failureReason = `Payment succeeded after booking became ${booking.status}.`;

    await booking.save();

    return {
      booking,
      alreadyConfirmed: false,
      needsResolution: true,
      reason: "BOOKING_NO_LONGER_CONFIRMABLE",
    };
  }

  /*
   * ========================================================
   * RESERVATION SAFETY
   * ========================================================
   *
   * Exclude this booking itself and see whether another
   * active hold/confirmed reservation now occupies the slot.
   */
  const conflict = await checkBookingConflicts({
    spaceId: booking.space,
    startAt: booking.startAt,
    endAt: booking.endAt,
    excludeBookingId: booking._id,
  });

  if (conflict) {
    booking.payment.status = "needs_resolution";

    booking.payment.failureReason =
      "Payment succeeded, but the booking slot is no longer available.";

    await booking.save();

    return {
      booking,
      alreadyConfirmed: false,
      needsResolution: true,
      reason: "SPACE_SLOT_CONFLICT_AFTER_PAYMENT",
      conflictingBookingId: conflict._id,
    };
  }

  /*
   * No competing reservation exists.
   *
   * This is safe even when the original 15-minute
   * hold technically expired, provided nobody else
   * claimed the slot.
   */
  booking.status = "confirmed";
  booking.confirmedAt = booking.confirmedAt || new Date();

  booking.holdExpiresAt = null;

  const alreadyHasConfirmedHistory = booking.statusHistory.some(
    (item) => item.status === "confirmed"
  );

  if (!alreadyHasConfirmedHistory) {
    booking.statusHistory.push({
      status: "confirmed",
      changedBy: null,
      note: "Payment verified successfully. Space booking confirmed.",
      createdAt: new Date(),
    });
  }

  await booking.save();

  return {
    booking,
    alreadyConfirmed: false,
    needsResolution: false,
  };
}

module.exports = {
  normalizeMetadata,
  confirmPaidSpaceBooking,
};
