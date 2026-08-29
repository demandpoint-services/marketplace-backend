const mongoose = require("mongoose");

const vendorProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    artisanProfile: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ArtisanProfile",
      required: true,
      unique: true,
      index: true,
    },

    storeName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    storeDescription: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },

    storeLogo: {
      type: String,
      trim: true,
      default: "",
    },

    storeBanner: {
      type: String,
      trim: true,
      default: "",
    },

    phone: {
      type: String,
      trim: true,
      default: "",
    },

    businessAddress: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },

    state: {
      type: String,
      trim: true,
      default: "",
    },

    city: {
      type: String,
      trim: true,
      default: "",
    },

    pickupLocation: {
      contactName: {
        type: String,
        trim: true,
        default: "",
      },

      phone: {
        type: String,
        trim: true,
        default: "",
      },

      address: {
        type: String,
        trim: true,
        maxlength: 500,
        default: "",
      },

      city: {
        type: String,
        trim: true,
        default: "",
      },

      state: {
        type: String,
        trim: true,
        default: "",
      },

      country: {
        type: String,
        trim: true,
        default: "Nigeria",
      },
    },

    bankAccount: {
      bankName: {
        type: String,
        trim: true,
        default: "",
      },

      accountNumber: {
        type: String,
        trim: true,
        default: "",
      },

      accountName: {
        type: String,
        trim: true,
        default: "",
      },

      verified: {
        type: Boolean,
        default: false,
      },

      verifiedAt: {
        type: Date,
        default: null,
      },
    },

    status: {
      type: String,
      enum: ["active", "suspended", "inactive"],
      default: "active",
      index: true,
    },

    onboardingCompleted: {
      type: Boolean,
      default: false,
    },

    totalProducts: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalOrders: {
      type: Number,
      default: 0,
      min: 0,
    },

    grossSalesKobo: {
      type: Number,
      default: 0,
      min: 0,
    },

    pendingBalanceKobo: {
      type: Number,
      default: 0,
      min: 0,
    },

    availableBalanceKobo: {
      type: Number,
      default: 0,
      min: 0,
    },

    lockedBalanceKobo: {
      type: Number,
      default: 0,
      min: 0,
    },

    withdrawnKobo: {
      type: Number,
      default: 0,
      min: 0,
    },

    activatedAt: {
      type: Date,
      default: Date.now,
    },

    suspendedAt: {
      type: Date,
      default: null,
    },

    suspensionReason: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
  },
  {
    timestamps: true,
  },
);

vendorProfileSchema.index({
  status: 1,
  createdAt: -1,
});

module.exports = mongoose.model("VendorProfile", vendorProfileSchema);
