const mongoose = require("mongoose");

const subscriptionPaymentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    subscription: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subscription",
      required: true,
      index: true,
    },

    reference: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },

    amountKobo: {
      type: Number,
      required: true,
      min: 0,
    },

    requestedAmountKobo: {
      type: Number,
      default: null,
      min: 0,
    },

    customerChargedKobo: {
      type: Number,
      default: null,
      min: 0,
    },

    feesKobo: {
      type: Number,
      default: null,
      min: 0,
    },

    currency: {
      type: String,
      default: "NGN",
      uppercase: true,
    },

    status: {
      type: String,
      enum: ["initialized", "pending", "success", "failed", "abandoned"],
      default: "initialized",
      index: true,
    },

    provider: {
      type: String,
      enum: ["paystack"],
      default: "paystack",
    },

    paymentSource: {
      type: String,
      enum: ["checkout", "webhook", "manual"],
      default: "checkout",
      index: true,
    },

    paystackTransactionId: {
      type: Number,
      default: null,
      index: true,
    },

    paystackInvoiceCode: {
      type: String,
      default: null,
      index: true,
    },

    paystackSubscriptionCode: {
      type: String,
      default: null,
      index: true,
    },

    accessCode: {
      type: String,
      default: null,
    },

    authorizationUrl: {
      type: String,
      default: null,
    },

    channel: {
      type: String,
      default: null,
    },

    gatewayResponse: {
      type: String,
      default: null,
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
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model(
  "SubscriptionPayment",
  subscriptionPaymentSchema,
);
