const mongoose = require("mongoose");

const subscriptionEmailLogSchema = new mongoose.Schema(
  {
    recipient: {
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

    payment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubscriptionPayment",
      default: null,
    },

    type: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    dedupeKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },

    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },

    subject: {
      type: String,
      required: true,
      trim: true,
    },

    status: {
      type: String,
      enum: ["sending", "sent", "failed"],
      default: "sending",
      index: true,
    },

    resendEmailId: {
      type: String,
      default: null,
    },

    failureReason: {
      type: String,
      default: null,
    },

    sentAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model(
  "SubscriptionEmailLog",
  subscriptionEmailLogSchema,
);
