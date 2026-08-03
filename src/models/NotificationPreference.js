const mongoose = require("mongoose");

const notificationPreferenceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    bookingCreated: {
      type: Boolean,
      default: true,
    },

    bookingAccepted: {
      type: Boolean,
      default: true,
    },

    bookingDeclined: {
      type: Boolean,
      default: true,
    },

    bookingCancelled: {
      type: Boolean,
      default: true,
    },

    bookingCompleted: {
      type: Boolean,
      default: true,
    },

    bookingReminder: {
      type: Boolean,
      default: true,
    },

    messageReceived: {
      type: Boolean,
      default: true,
    },

    paymentSuccess: {
      type: Boolean,
      default: true,
    },

    paymentFailed: {
      type: Boolean,
      default: true,
    },

    refundProcessed: {
      type: Boolean,
      default: true,
    },

    subscriptionUpdates: {
      type: Boolean,
      default: true,
    },

    trialReminders: {
      type: Boolean,
      default: true,
    },

    renewalReminders: {
      type: Boolean,
      default: true,
    },

    passwordChanged: {
      type: Boolean,
      default: true,
    },

    emailChanged: {
      type: Boolean,
      default: true,
    },

    profileUpdated: {
      type: Boolean,
      default: true,
    },

    loginDetected: {
      type: Boolean,
      default: true,
    },

    emailVerified: {
      type: Boolean,
      default: true,
    },

    newReview: {
      type: Boolean,
      default: true,
    },

    newRating: {
      type: Boolean,
      default: true,
    },

    systemUpdates: {
      type: Boolean,
      default: true,
    },

    promotions: {
      type: Boolean,
      default: false,
    },

    emailNotifications: {
      type: Boolean,
      default: true,
    },

    smsNotifications: {
      type: Boolean,
      default: false,
    },

    pushNotifications: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model(
  "NotificationPreference",
  notificationPreferenceSchema,
);
