const mongoose = require("mongoose");

const subscriptionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    planKey: {
      type: String,
      default: "artisan_monthly",
      required: true,
    },

    status: {
      type: String,
      enum: ["trialing", "active", "past_due", "expired", "cancelled"],
      default: "trialing",
      index: true,
    },

    providerStatus: {
      type: String,
      default: null,
      index: true,
    },

    trialStartedAt: {
      type: Date,
      default: null,
    },

    trialEndsAt: {
      type: Date,
      default: null,
    },

    currentPeriodStart: {
      type: Date,
      default: null,
    },

    currentPeriodEnd: {
      type: Date,
      default: null,
    },

    amountKobo: {
      type: Number,
      default: 50000,
      min: 0,
    },

    currency: {
      type: String,
      default: "NGN",
      uppercase: true,
    },

    provider: {
      type: String,
      enum: ["paystack"],
      default: "paystack",
    },

    paystackCustomerCode: {
      type: String,
      default: null,
      index: true,
    },

    paystackSubscriptionCode: {
      type: String,
      default: null,
      index: true,
    },

    paystackEmailToken: {
      type: String,
      default: null,
    },

    paystackPlanCode: {
      type: String,
      default: null,
      index: true,
    },

    paystackAuthorizationCode: {
      type: String,
      default: null,
    },

    autoRenew: {
      type: Boolean,
      default: true,
    },

    lastPaymentAt: {
      type: Date,
      default: null,
    },

    nextPaymentAt: {
      type: Date,
      default: null,
    },

    lastPaymentFailureAt: {
      type: Date,
      default: null,
    },

    paymentFailureReason: {
      type: String,
      default: null,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },

    webhookUpdatedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("Subscription", subscriptionSchema);
