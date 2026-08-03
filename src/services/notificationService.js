const Notification = require("../models/Notification");
const NotificationPreference = require("../models/NotificationPreference");

const {
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_VALUES,
} = require("../constants/notificationTypes");

const {
  NOTIFICATION_CATEGORY_VALUES,
} = require("../constants/notificationCategories");

const preferenceMap = Object.freeze({
  [NOTIFICATION_TYPES.BOOKING_CREATED]: "bookingCreated",
  [NOTIFICATION_TYPES.BOOKING_ACCEPTED]: "bookingAccepted",
  [NOTIFICATION_TYPES.BOOKING_DECLINED]: "bookingDeclined",
  [NOTIFICATION_TYPES.BOOKING_CANCELLED]: "bookingCancelled",
  [NOTIFICATION_TYPES.BOOKING_COMPLETED]: "bookingCompleted",
  [NOTIFICATION_TYPES.BOOKING_REMINDER]: "bookingReminder",

  [NOTIFICATION_TYPES.MESSAGE_RECEIVED]: "messageReceived",

  [NOTIFICATION_TYPES.PAYMENT_SUCCESS]: "paymentSuccess",
  [NOTIFICATION_TYPES.PAYMENT_FAILED]: "paymentFailed",
  [NOTIFICATION_TYPES.REFUND_PROCESSED]: "refundProcessed",

  [NOTIFICATION_TYPES.SUBSCRIPTION_TRIAL_STARTED]: "subscriptionUpdates",
  [NOTIFICATION_TYPES.SUBSCRIPTION_TRIAL_ENDING]: "trialReminders",
  [NOTIFICATION_TYPES.SUBSCRIPTION_TRIAL_EXPIRED]: "trialReminders",
  [NOTIFICATION_TYPES.SUBSCRIPTION_ACTIVATED]: "subscriptionUpdates",
  [NOTIFICATION_TYPES.SUBSCRIPTION_RENEWED]: "subscriptionUpdates",
  [NOTIFICATION_TYPES.SUBSCRIPTION_RENEWAL_CANCELLED]: "subscriptionUpdates",
  [NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRED]: "subscriptionUpdates",

  [NOTIFICATION_TYPES.PASSWORD_CHANGED]: "passwordChanged",
  [NOTIFICATION_TYPES.EMAIL_CHANGED]: "emailChanged",
  [NOTIFICATION_TYPES.PROFILE_UPDATED]: "profileUpdated",
  [NOTIFICATION_TYPES.LOGIN_DETECTED]: "loginDetected",
  [NOTIFICATION_TYPES.EMAIL_VERIFIED]: "emailVerified",

  [NOTIFICATION_TYPES.NEW_REVIEW]: "newReview",
  [NOTIFICATION_TYPES.NEW_RATING]: "newRating",

  [NOTIFICATION_TYPES.SYSTEM]: "systemUpdates",
  [NOTIFICATION_TYPES.PROMOTION]: "promotions",
});

async function getOrCreatePreferences(userId) {
  return NotificationPreference.findOneAndUpdate(
    {
      user: userId,
    },
    {
      $setOnInsert: {
        user: userId,
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    },
  );
}

async function shouldCreateNotification(recipientId, type) {
  const preferenceField = preferenceMap[type];

  if (!preferenceField) {
    return true;
  }

  const preferences = await getOrCreatePreferences(recipientId);

  return preferences[preferenceField] !== false;
}

function validateNotificationInput({
  recipient,
  type,
  category,
  title,
  message,
}) {
  if (!recipient) {
    throw new Error("Notification recipient is required.");
  }

  if (!NOTIFICATION_TYPE_VALUES.includes(type)) {
    throw new Error(`Unsupported notification type: ${type}`);
  }

  if (!NOTIFICATION_CATEGORY_VALUES.includes(category)) {
    throw new Error(`Unsupported notification category: ${category}`);
  }

  if (!title?.trim()) {
    throw new Error("Notification title is required.");
  }

  if (!message?.trim()) {
    throw new Error("Notification message is required.");
  }
}

async function createNotification({
  recipient,
  actor = null,
  type,
  category,
  title,
  message,
  actionUrl = "",
  resourceType = null,
  resourceId = null,
  dedupeKey = null,
  metadata = {},
}) {
  validateNotificationInput({
    recipient,
    type,
    category,
    title,
    message,
  });

  const allowed = await shouldCreateNotification(recipient, type);

  if (!allowed) {
    return null;
  }

  const notificationData = {
    recipient,
    actor,
    type,
    category,
    title: title.trim(),
    message: message.trim(),
    actionUrl,
    resourceType,
    resourceId,
    dedupeKey: dedupeKey?.trim() || null,
    metadata,
  };

  /*
   * When no dedupe key is supplied, create the notification normally.
   */
  if (!notificationData.dedupeKey) {
    return Notification.create(notificationData);
  }

  /*
   * When a dedupe key is supplied, create only if an equivalent
   * notification has not already been stored for this recipient.
   */
  return Notification.findOneAndUpdate(
    {
      recipient,
      dedupeKey: notificationData.dedupeKey,
    },
    {
      $setOnInsert: notificationData,
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
      runValidators: true,
    },
  );
}

async function createNotificationSafely(payload, context = "Notification") {
  try {
    return await createNotification(payload);
  } catch (error) {
    /*
     * Duplicate-key races are harmless because another request already
     * created the notification successfully.
     */
    if (error?.code === 11000) {
      return Notification.findOne({
        recipient: payload.recipient,
        dedupeKey: payload.dedupeKey,
      });
    }

    console.error(`${context} creation error:`, error);

    return null;
  }
}

async function createManyNotifications(notifications = []) {
  if (!Array.isArray(notifications)) {
    throw new Error("Notifications must be supplied as an array.");
  }

  const results = await Promise.allSettled(
    notifications.map((notification) =>
      createNotificationSafely(notification, "Bulk notification"),
    ),
  );

  results.forEach((result) => {
    if (result.status === "rejected") {
      console.error("Bulk notification creation error:", result.reason);
    }
  });

  return results
    .filter((result) => result.status === "fulfilled" && result.value)
    .map((result) => result.value);
}

module.exports = {
  createNotification,
  createNotificationSafely,
  createManyNotifications,
  getOrCreatePreferences,
  shouldCreateNotification,
};
