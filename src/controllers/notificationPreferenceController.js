const NotificationPreference = require("../models/NotificationPreference");
const { getOrCreatePreferences } = require("../services/notificationService");

const editableFields = [
  "bookingCreated",
  "bookingAccepted",
  "bookingDeclined",
  "bookingCancelled",
  "bookingCompleted",
  "bookingReminder",

  "messageReceived",

  "paymentSuccess",
  "paymentFailed",
  "refundProcessed",
  "subscriptionUpdates",
  "trialReminders",
  "renewalReminders",

  "passwordChanged",
  "emailChanged",
  "profileUpdated",
  "loginDetected",
  "emailVerified",

  "newReview",
  "newRating",

  "systemUpdates",
  "promotions",

  "emailNotifications",
  "smsNotifications",
  "pushNotifications",
];

exports.getMyNotificationPreferences = async (req, res) => {
  try {
    const preferences = await getOrCreatePreferences(req.user._id);

    return res.status(200).json(preferences);
  } catch (error) {
    console.error("Get notification preferences error:", error);

    return res.status(500).json({
      message: "Unable to retrieve notification preferences.",
    });
  }
};

exports.updateMyNotificationPreferences = async (req, res) => {
  try {
    const updates = {};

    editableFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = Boolean(req.body[field]);
      }
    });

    const preferences = await NotificationPreference.findOneAndUpdate(
      {
        user: req.user._id,
      },
      {
        $set: updates,
        $setOnInsert: {
          user: req.user._id,
        },
      },
      {
        returnDocument: "after",
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );

    return res.status(200).json(preferences);
  } catch (error) {
    console.error("Update notification preferences error:", error);

    return res.status(500).json({
      message: "Unable to update notification preferences.",
    });
  }
};
