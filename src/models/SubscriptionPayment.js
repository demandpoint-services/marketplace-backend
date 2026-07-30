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
    requestedAmountKobo: {
      type: Number,
      default: null,
    },

    customerChargedKobo: {
      type: Number,
      default: null,
    },

    feesKobo: {
      type: Number,
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
