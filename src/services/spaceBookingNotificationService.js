const { createManyNotifications } = require("./notificationService");

const { NOTIFICATION_TYPES } = require("../constants/notificationTypes");

const { NOTIFICATION_CATEGORIES } = require("../constants/notificationCategories");

const bookingName = (booking) => booking.spaceSnapshot?.name || "your reserved space";

async function notifySpaceBookingConfirmed(booking) {
  if (
    !booking ||
    !["confirmed", "completed"].includes(booking.status) ||
    booking.payment?.status !== "paid"
  ) {
    return [];
  }

  const id = String(booking._id);
  const name = bookingName(booking);
  const date = booking.bookingDate || "the selected date";

  return createManyNotifications([
    {
      recipient: booking.client,

      type: NOTIFICATION_TYPES.PAYMENT_SUCCESS,
      category: NOTIFICATION_CATEGORIES.PAYMENT,

      title: "Space payment confirmed",

      message: `Your payment for ${name} has been received. Your reservation for ${date} is confirmed.`,

      actionUrl: "/space-bookings",

      resourceType: "booking",
      resourceId: booking._id,

      dedupeKey: `space:${id}:payment-success`,

      metadata: {
        bookingId: id,
        spaceId: String(booking.space),
      },
    },

    {
      recipient: booking.owner,
      actor: booking.client,

      type: NOTIFICATION_TYPES.BOOKING_CREATED,
      category: NOTIFICATION_CATEGORIES.BOOKING,

      title: "New paid space reservation",

      message: `A customer has confirmed a reservation for ${name} on ${date}.`,

      actionUrl: "/spaces/bookings",

      resourceType: "booking",
      resourceId: booking._id,

      dedupeKey: `space:${id}:owner-confirmed`,

      metadata: {
        bookingId: id,
        spaceId: String(booking.space),
      },
    },
  ]);
}

module.exports = {
  notifySpaceBookingConfirmed,
};
