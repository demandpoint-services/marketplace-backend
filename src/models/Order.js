const mongoose = require("mongoose");

const orderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VendorProfile",
      required: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
    },

    image: {
      type: String,
      default: "",
      trim: true,
    },

    quantity: {
      type: Number,
      required: true,
      min: 1,
    },

    // Canonical monetary value.
    unitPriceKobo: {
      type: Number,
      required: true,
      min: 0,
    },

    lineTotalKobo: {
      type: Number,
      required: true,
      min: 0,
    },

    // Temporary compatibility with the old order structure.
    price: {
      type: Number,
      default: null,
      min: 0,
    },
  },
  {
    _id: true,
  }
);

const vendorOrderSchema = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VendorProfile",
      required: true,
    },

    // Snapshot of the store name at checkout.
    storeName: {
      type: String,
      required: true,
      trim: true,
    },

    items: {
      type: [orderItemSchema],
      default: [],
    },

    subtotalKobo: {
      type: Number,
      required: true,
      min: 0,
    },

    status: {
      type: String,
      enum: ["pending", "processing", "shipped", "delivered", "cancelled"],
      default: "pending",
    },

    shippedAt: {
      type: Date,
      default: null,
    },

    deliveredAt: {
      type: Date,
      default: null,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },

    cancellationReason: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
  },
  {
    _id: true,
  }
);

const orderSchema = new mongoose.Schema(
  {
    // ----------------------------------------------------------
    // CUSTOMER
    // ----------------------------------------------------------

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    orderNumber: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      trim: true,
    },

    // ----------------------------------------------------------
    // ORDER ITEMS
    // ----------------------------------------------------------

    items: {
      type: [orderItemSchema],
      default: [],
    },

    // One checkout can contain products from multiple vendors.
    vendorOrders: {
      type: [vendorOrderSchema],
      default: [],
    },

    // ----------------------------------------------------------
    // MONEY
    // ----------------------------------------------------------

    subtotalKobo: {
      type: Number,
      default: 0,
      min: 0,
    },

    deliveryFeeKobo: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalKobo: {
      type: Number,
      default: 0,
      min: 0,
    },

    currency: {
      type: String,
      default: "NGN",
      uppercase: true,
      trim: true,
    },

    // Old field kept temporarily for compatibility.
    totalAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ----------------------------------------------------------
    // PAYMENT
    // ----------------------------------------------------------

    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "abandoned", "refunded", "partially_refunded"],
      default: "pending",
      index: true,
    },

    paymentProvider: {
      type: String,
      enum: ["paystack"],
      default: "paystack",
    },

    paymentReference: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      trim: true,
    },

    transactionId: {
      type: String,
      default: null,
      index: true,
    },

    authorizationUrl: {
      type: String,
      default: null,
    },

    accessCode: {
      type: String,
      default: null,
    },

    paymentChannel: {
      type: String,
      default: null,
    },

    // Exact amount DemandPoint asked Paystack to charge.
    // Keep this immutable after initialization so verification always
    // has the original server-calculated payment snapshot.
    paymentAmountKobo: {
      type: Number,
      default: null,
      min: 0,
    },

    // Actual amount Paystack reports as paid. This can be greater than
    // paymentAmountKobo when transaction fees are passed to the customer.
    amountPaidKobo: {
      type: Number,
      default: null,
      min: 0,
    },

    paidAt: {
      type: Date,
      default: null,
    },

    paymentVerifiedAt: {
      type: Date,
      default: null,
    },

    paymentFailureReason: {
      type: String,
      default: null,
      trim: true,
    },

    // ----------------------------------------------------------
    // FULFILMENT
    // ----------------------------------------------------------

    fulfillmentStatus: {
      type: String,
      enum: ["pending", "processing", "fulfilled", "failed"],
      default: "pending",
      index: true,
    },

    fulfilledAt: {
      type: Date,
      default: null,
    },

    fulfillmentStartedAt: {
      type: Date,
      default: null,
    },

    fulfillmentFailedAt: {
      type: Date,
      default: null,
    },

    fulfillmentError: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000,
    },

    // ----------------------------------------------------------
    // ORDER STATUS
    // ----------------------------------------------------------

    status: {
      type: String,
      enum: [
        "pending_payment",
        "paid",
        "processing",
        "partially_shipped",
        "shipped",
        "delivered",
        "cancelled",
      ],
      default: "pending_payment",
      index: true,
    },

    // ----------------------------------------------------------
    // DELIVERY / SHIPPING
    // ----------------------------------------------------------

    shippingAddress: {
      recipientName: {
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

      postalCode: {
        type: String,
        trim: true,
        default: "",
      },

      country: {
        type: String,
        trim: true,
        default: "Nigeria",
      },

      deliveryNotes: {
        type: String,
        trim: true,
        maxlength: 1000,
        default: "",
      },
    },

    // ----------------------------------------------------------
    // SETTLEMENT
    // ----------------------------------------------------------

    settlementStatus: {
      type: String,
      enum: ["not_ready", "pending", "partially_settled", "settled", "reversed"],
      default: "not_ready",
      index: true,
    },

    settledAt: {
      type: Date,
      default: null,
    },

    // ----------------------------------------------------------
    // LEGACY / COMPATIBILITY
    // ----------------------------------------------------------

    // Keep old status/payment fields usable while we migrate
    // the controller and frontend.
    legacyStatus: {
      type: String,
      default: null,
    },

    // ----------------------------------------------------------
    // CANCELLATION
    // ----------------------------------------------------------

    cancelledAt: {
      type: Date,
      default: null,
    },

    cancellationReason: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },

    // Useful for abandoned Paystack sessions.
    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// ------------------------------------------------------------
// INDEXES
// ------------------------------------------------------------

orderSchema.index({
  user: 1,
  createdAt: -1,
});

orderSchema.index({
  "vendorOrders.vendor": 1,
  createdAt: -1,
});

orderSchema.index({
  paymentStatus: 1,
  createdAt: -1,
});

orderSchema.index({
  status: 1,
  createdAt: -1,
});

orderSchema.index({
  fulfillmentStatus: 1,
  createdAt: -1,
});

module.exports = mongoose.model("Order", orderSchema);
