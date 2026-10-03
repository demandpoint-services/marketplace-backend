const mongoose = require("mongoose");

const statusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      required: true,
    },

    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    note: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: false,
  }
);

const spaceSnapshotSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },

    category: {
      type: String,
      default: "",
    },

    coverImage: {
      type: String,
      default: "",
    },

    location: {
      address: {
        type: String,
        default: "",
      },

      city: {
        type: String,
        default: "",
      },

      state: {
        type: String,
        default: "",
      },

      country: {
        type: String,
        default: "Nigeria",
      },

      landmark: {
        type: String,
        default: "",
      },
    },
  },
  {
    _id: false,
  }
);

const pricingSnapshotSchema = new mongoose.Schema(
  {
    pricingType: {
      type: String,
      enum: ["hourly", "daily", "fixed"],
      required: true,
    },

    baseAmountKobo: {
      type: Number,
      required: true,
      min: 0,
    },

    durationMinutes: {
      type: Number,
      required: true,
      min: 1,
    },

    subtotalKobo: {
      type: Number,
      required: true,
      min: 0,
    },

    totalKobo: {
      type: Number,
      required: true,
      min: 0,
    },

    currency: {
      type: String,
      default: "NGN",
      uppercase: true,
      trim: true,
    },
  },
  {
    _id: false,
  }
);

const spaceBookingSchema = new mongoose.Schema(
  {
    space: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Space",
      required: true,
      index: true,
    },

    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // ==========================================================
    // IMMUTABLE SPACE SNAPSHOT
    // ==========================================================

    spaceSnapshot: {
      type: spaceSnapshotSchema,
      required: true,
    },

    // ==========================================================
    // RESERVATION PERIOD
    // ==========================================================

    bookingDate: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },

    startTime: {
      type: String,
      required: true,
      match: /^([01]\d|2[0-3]):[0-5]\d$/,
    },

    endTime: {
      type: String,
      required: true,
      match: /^([01]\d|2[0-3]):[0-5]\d$/,
    },

    startAt: {
      type: Date,
      required: true,
      index: true,
    },

    endAt: {
      type: Date,
      required: true,
      index: true,
    },

    timezone: {
      type: String,
      default: "Africa/Lagos",
    },

    guests: {
      type: Number,
      required: true,
      min: 1,
    },

    // ==========================================================
    // PRICING
    // ==========================================================

    pricingSnapshot: {
      type: pricingSnapshotSchema,
      required: true,
    },

    // ==========================================================
    // BOOKING STATUS
    // ==========================================================

    status: {
      type: String,

      enum: ["pending_payment", "confirmed", "completed", "cancelled", "expired", "declined"],

      default: "pending_payment",

      index: true,
    },

    // ==========================================================
    // TEMPORARY RESERVATION HOLD
    // ==========================================================

    holdExpiresAt: {
      type: Date,
      default: null,
      index: true,
    },

    // ==========================================================
    // PAYMENT — PREPARED FOR PHASE 4
    // ==========================================================

    payment: {
      provider: {
        type: String,
        default: "paystack",
      },

      reference: {
        type: String,
        trim: true,
        default: "",
      },

      status: {
        type: String,
        enum: ["unpaid", "pending", "paid", "failed", "refunded", "needs_resolution"],
        default: "unpaid",
      },

      requestedAmountKobo: {
        type: Number,
        default: null,
        min: 0,
      },

      amountPaidKobo: {
        type: Number,
        default: null,
        min: 0,
      },

      currency: {
        type: String,
        default: "NGN",
        uppercase: true,
      },

      authorizationUrl: {
        type: String,
        default: "",
      },

      accessCode: {
        type: String,
        default: "",
      },

      transactionId: {
        type: String,
        default: "",
      },

      channel: {
        type: String,
        default: "",
      },

      paidAt: {
        type: Date,
        default: null,
      },

      verifiedAt: {
        type: Date,
        default: null,
      },

      failureReason: {
        type: String,
        default: "",
      },
    },

    // ==========================================================
    // CUSTOMER INFORMATION
    // ==========================================================

    customerNote: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },

    // ==========================================================
    // CANCELLATION
    // ==========================================================

    cancellation: {
      cancelledBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      reason: {
        type: String,
        trim: true,
        maxlength: 500,
        default: "",
      },

      cancelledAt: {
        type: Date,
        default: null,
      },
    },

    // ==========================================================
    // STATUS HISTORY
    // ==========================================================

    statusHistory: {
      type: [statusHistorySchema],
      default: [],
    },

    confirmedAt: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    expiredAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// ============================================================
// INDEXES
// ============================================================

spaceBookingSchema.index({
  space: 1,
  startAt: 1,
  endAt: 1,
  status: 1,
});

spaceBookingSchema.index({
  client: 1,
  createdAt: -1,
});

spaceBookingSchema.index({
  owner: 1,
  startAt: 1,
});

spaceBookingSchema.index({
  status: 1,
  holdExpiresAt: 1,
});

spaceBookingSchema.index(
  {
    "payment.reference": 1,
  },
  {
    unique: true,
    sparse: true,
  }
);

// ============================================================
// VIRTUALS
// ============================================================

spaceBookingSchema.virtual("isHoldActive").get(function () {
  return this.status === "pending_payment" && this.holdExpiresAt && this.holdExpiresAt > new Date();
});

spaceBookingSchema.set("toJSON", {
  virtuals: true,
});

spaceBookingSchema.set("toObject", {
  virtuals: true,
});

module.exports = mongoose.model("SpaceBooking", spaceBookingSchema);
