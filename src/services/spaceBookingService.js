const SpaceBooking = require("../models/SpaceBooking");

async function expireStaleSpaceBookingHolds() {
  const now = new Date();

  const staleBookings = await SpaceBooking.find({
    status: "pending_payment",

    holdExpiresAt: {
      $lte: now,
    },
  }).select("_id");

  if (staleBookings.length === 0) {
    return {
      expiredCount: 0,
    };
  }

  const ids = staleBookings.map((booking) => booking._id);

  const result = await SpaceBooking.updateMany(
    {
      _id: {
        $in: ids,
      },

      status: "pending_payment",

      holdExpiresAt: {
        $lte: now,
      },
    },
    {
      $set: {
        status: "expired",
        expiredAt: now,
      },

      $push: {
        statusHistory: {
          status: "expired",
          changedBy: null,
          note: "Payment reservation hold expired.",
          createdAt: now,
        },
      },
    }
  );

  return {
    expiredCount: result.modifiedCount || 0,
  };
}

module.exports = {
  expireStaleSpaceBookingHolds,
};
