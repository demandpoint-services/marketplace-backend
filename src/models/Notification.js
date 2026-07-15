const mongoose = require("mongoose");

const { NOTIFICATION_TYPE_VALUES } = require("../constants/notificationTypes");

const {
  NOTIFICATION_CATEGORY_VALUES,
} = require("../constants/notificationCategories");

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    type: {
      type: String,
      required: true,
      enum: NOTIFICATION_TYPE_VALUES,
      index: true,
    },

    category: {
      type: String,
      required: true,
      enum: NOTIFICATION_CATEGORY_VALUES,
      index: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },

    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },

    actionUrl: {
      type: String,
      default: "",
      trim: true,
    },

    resourceType: {
      type: String,
      enum: ["booking", "message", "payment", "review", "user", "system", null],
      default: null,
    },

    resourceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    read: {
      type: Boolean,
      default: false,
      index: true,
    },

    readAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

notificationSchema.index({
  recipient: 1,
  read: 1,
  createdAt: -1,
});

notificationSchema.index({
  recipient: 1,
  category: 1,
  createdAt: -1,
});

module.exports = mongoose.model("Notification", notificationSchema);
