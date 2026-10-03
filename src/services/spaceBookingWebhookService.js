const SpaceBooking = require("../models/SpaceBooking");

const { normalizeMetadata, confirmPaidSpaceBooking } = require("./spaceBookingPaymentService");

function isSpaceBookingEvent(event) {
  if (!event?.data) {
    return false;
  }

  const metadata = normalizeMetadata(event.data.metadata);

  return metadata.type === "space_booking";
}

async function processSpaceBookingEvent(event) {
  if (!event?.event || !event?.data) {
    return {
      handled: false,
      reason: "Invalid space booking webhook event.",
    };
  }

  if (event.event !== "charge.success") {
    return {
      handled: false,
      reason: `Unsupported space booking event type: ${event.event}`,
    };
  }

  const transaction = event.data;

  const metadata = normalizeMetadata(transaction.metadata);

  if (metadata.type !== "space_booking") {
    return {
      handled: false,
      reason: "The payment is not a space booking.",
    };
  }

  const reference = String(transaction.reference || "").trim();

  if (!reference) {
    throw Object.assign(new Error("Space booking payment webhook has no transaction reference."), {
      code: "SPACE_PAYMENT_REFERENCE_MISSING",
    });
  }

  let booking = null;

  if (metadata.bookingId) {
    booking = await SpaceBooking.findById(metadata.bookingId);
  }

  if (!booking) {
    booking = await SpaceBooking.findOne({
      "payment.reference": reference,
    });
  }

  if (!booking) {
    throw Object.assign(new Error(`Space booking not found for payment reference ${reference}.`), {
      code: "SPACE_BOOKING_NOT_FOUND",
    });
  }

  if (booking.payment?.reference && booking.payment.reference !== reference) {
    throw Object.assign(new Error("Space booking payment reference mismatch."), {
      code: "SPACE_PAYMENT_REFERENCE_MISMATCH",
    });
  }

  const result = await confirmPaidSpaceBooking({
    bookingId: booking._id,
    transaction,
  });

  return {
    handled: true,

    bookingId: booking._id,

    reference,

    alreadyConfirmed: Boolean(result.alreadyConfirmed),

    needsResolution: Boolean(result.needsResolution),

    reason: result.reason || null,
  };
}

module.exports = {
  isSpaceBookingEvent,
  processSpaceBookingEvent,
};
