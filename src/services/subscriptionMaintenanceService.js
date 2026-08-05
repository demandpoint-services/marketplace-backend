const Subscription = require("../models/Subscription");

const {
  notifyTrialEnding,
  notifyTrialExpired,
  notifyRenewalReminder,
  notifySubscriptionExpired,
} = require("./subscriptionCommunicationService");

const DAY_MS = 24 * 60 * 60 * 1000;

function calculateDaysRemaining(value, now = new Date()) {
  if (!value) return 0;

  const difference = new Date(value).getTime() - now.getTime();

  if (difference <= 0) return 0;

  return Math.ceil(difference / DAY_MS);
}

async function expireTrial(subscription, now) {
  subscription.status = "expired";
  subscription.providerStatus = "trial_expired";
  subscription.autoRenew = false;
  subscription.nextPaymentAt = null;
  subscription.webhookUpdatedAt = now;

  await subscription.save();
  await notifyTrialExpired({ subscription });

  return subscription;
}

async function expirePaidSubscription(subscription, now) {
  subscription.status = "expired";
  subscription.providerStatus =
    subscription.providerStatus === "payment_failed"
      ? "payment_period_expired"
      : "period_expired";
  subscription.autoRenew = false;
  subscription.nextPaymentAt = null;
  subscription.webhookUpdatedAt = now;

  await subscription.save();
  await notifySubscriptionExpired({ subscription });

  return subscription;
}

async function processSubscriptionMaintenance() {
  const now = new Date();

  const [
    trialSubscriptions,
    renewalSubscriptions,
    endedPaidSubscriptions,
  ] = await Promise.all([
    Subscription.find({
      status: "trialing",
      trialEndsAt: { $ne: null },
    }),

    Subscription.find({
      status: "active",
      autoRenew: true,
      nextPaymentAt: { $ne: null, $gt: now },
    }),

    Subscription.find({
      status: { $in: ["active", "cancelled", "past_due"] },
      currentPeriodEnd: { $ne: null, $lte: now },
    }),
  ]);

  const result = {
    checked:
      trialSubscriptions.length +
      renewalSubscriptions.length +
      endedPaidSubscriptions.length,
    trialSubscriptionsChecked: trialSubscriptions.length,
    renewalSubscriptionsChecked: renewalSubscriptions.length,
    paidSubscriptionsChecked: endedPaidSubscriptions.length,
    remindersSent: 0,
    renewalRemindersSent: 0,
    trialsExpired: 0,
    paidSubscriptionsExpired: 0,
    errors: 0,
  };

  for (const subscription of trialSubscriptions) {
    try {
      const trialEndTime = new Date(subscription.trialEndsAt).getTime();

      if (trialEndTime <= now.getTime()) {
        await expireTrial(subscription, now);
        result.trialsExpired += 1;
        continue;
      }

      const daysRemaining = calculateDaysRemaining(subscription.trialEndsAt, now);

      if ([7, 3, 1].includes(daysRemaining)) {
        const notification = await notifyTrialEnding({
          subscription,
          daysRemaining,
        });

        if (notification) result.remindersSent += 1;
      }
    } catch (error) {
      result.errors += 1;
      console.error(
        `Trial maintenance error for ${subscription._id}:`,
        error,
      );
    }
  }

  for (const subscription of renewalSubscriptions) {
    try {
      const daysRemaining = calculateDaysRemaining(
        subscription.nextPaymentAt,
        now,
      );

      if ([3, 1].includes(daysRemaining)) {
        const notification = await notifyRenewalReminder({
          subscription,
          daysRemaining,
        });

        if (notification) result.renewalRemindersSent += 1;
      }
    } catch (error) {
      result.errors += 1;
      console.error(
        `Renewal reminder error for ${subscription._id}:`,
        error,
      );
    }
  }

  for (const subscription of endedPaidSubscriptions) {
    try {
      await expirePaidSubscription(subscription, now);
      result.paidSubscriptionsExpired += 1;
    } catch (error) {
      result.errors += 1;
      console.error(
        `Paid subscription maintenance error for ${subscription._id}:`,
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
