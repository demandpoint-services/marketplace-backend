const Subscription = require("../models/Subscription");

const { createNotificationSafely } = require("./notificationService");

const { NOTIFICATION_TYPES } = require("../constants/notificationTypes");

const {
  NOTIFICATION_CATEGORIES,
} = require("../constants/notificationCategories");

const {
  notifySubscriptionExpired,
} = require("./subscriptionCommunicationService");

const DAY_MS = 24 * 60 * 60 * 1000;

function calculateDaysRemaining(value, now = new Date()) {
  if (!value) {
    return 0;
  }

  const difference = new Date(value).getTime() - now.getTime();

  if (difference <= 0) {
    return 0;
  }

  return Math.ceil(difference / DAY_MS);
}

async function sendTrialReminder(subscription, daysRemaining) {
  const dayText = daysRemaining === 1 ? "day" : "days";

  return createNotificationSafely(
    {
      recipient: subscription.user,

      type: NOTIFICATION_TYPES.SUBSCRIPTION_TRIAL_ENDING,
      category: NOTIFICATION_CATEGORIES.PAYMENT,

      title: "Your free trial is ending soon",

      message: `Your DemandPoint Professional free trial ends in ${daysRemaining} ${dayText}. Subscribe now to remain visible to clients and continue receiving bookings.`,

      actionUrl: "/settings?section=subscription",

      resourceType: "subscription",
      resourceId: subscription._id,

      dedupeKey: `subscription-trial-reminder:${subscription._id}:${daysRemaining}`,

      metadata: {
        subscriptionId: subscription._id,
        daysRemaining,
        trialEndsAt: subscription.trialEndsAt,
      },
    },
    "Trial reminder notification",
  );
}

async function expireTrial(subscription, now) {
  subscription.status = "expired";
  subscription.providerStatus = "trial_expired";
  subscription.autoRenew = false;
  subscription.nextPaymentAt = null;
  subscription.webhookUpdatedAt = now;

  await subscription.save();

  await createNotificationSafely(
    {
      recipient: subscription.user,

      type: NOTIFICATION_TYPES.SUBSCRIPTION_TRIAL_EXPIRED,
      category: NOTIFICATION_CATEGORIES.PAYMENT,

      title: "Your free trial has ended",

      message:
        "Your DemandPoint Professional trial has ended. Subscribe to restore your marketplace visibility and continue receiving bookings.",

      actionUrl: "/settings?section=subscription",

      resourceType: "subscription",
      resourceId: subscription._id,

      dedupeKey: `subscription-trial-expired:${subscription._id}`,

      metadata: {
        subscriptionId: subscription._id,
        trialEndsAt: subscription.trialEndsAt,
      },
    },
    "Trial expiry notification",
  );

  return subscription;
}

async function processSubscriptionMaintenance() {
  const now = new Date();

  const trialSubscriptions = await Subscription.find({
    status: "trialing",
    trialEndsAt: {
      $ne: null,
    },
  });

  const result = {
    checked: trialSubscriptions.length,
    remindersSent: 0,
    trialsExpired: 0,
  };

  for (const subscription of trialSubscriptions) {
    try {
      const daysRemaining = calculateDaysRemaining(
        subscription.trialEndsAt,
        now,
      );

      if ([7, 3, 1].includes(daysRemaining)) {
        const notification = await sendTrialReminder(
          subscription,
          daysRemaining,
        );

        if (notification) {
          result.remindersSent += 1;
        }
      }

      if (new Date(subscription.trialEndsAt).getTime() <= now.getTime()) {
        await expireTrial(subscription, now);
        result.trialsExpired += 1;
      }
    } catch (error) {
      console.error(
        `Subscription maintenance error for ${subscription._id}:`,
        error,
      );
    }
  }

  return result;
}

module.exports = {
  calculateDaysRemaining,
  processSubscriptionMaintenance,
};
