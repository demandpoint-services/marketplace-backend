const mongoose = require("mongoose");

const paystackWebhookEventSchema = new mongoose.Schema(
  {
    eventKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },

    eventType: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },

    domain: {
      type: String,
      default: null,
      index: true,
    },

    reference: {
      type: String,
      default: null,
      index: true,
    },

    subscriptionCode: {
      type: String,
      default: null,
      index: true,
    },

    customerCode: {
      type: String,
      default: null,
      index: true,
    },

    status: {
      type: String,
      enum: ["received", "processing", "processed", "failed", "ignored"],
      default: "received",
      index: true,
    },

    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },

    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },

    processedAt: {
      type: Date,
      default: null,
    },

    lastAttemptAt: {
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
  "PaystackWebhookEvent",
  paystackWebhookEventSchema,
);
