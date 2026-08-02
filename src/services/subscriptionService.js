const Subscription = require("../models/Subscription");

const { SUBSCRIPTION_PLANS } = require("../constants/subscriptionPlans");

const {
  getEffectiveSubscriptionStatus,
  serializeSubscription,
} = require("../utils/subscriptionStatus");

const ARTISAN_PLAN = SUBSCRIPTION_PLANS.ARTISAN_MONTHLY;

function getTrialEndDate(startDate = new Date()) {
  return new Date(
    startDate.getTime() + ARTISAN_PLAN.trialDays * 24 * 60 * 60 * 1000,
  );
}

function isSubscriptionPaymentRequired(subscription) {
  const status = getEffectiveSubscriptionStatus(subscription);

  return ["expired", "past_due", "cancelled", "none"].includes(status);
}

async function getOrCreateArtisanSubscription(userId) {
  let subscription = await Subscription.findOne({
    user: userId,
  });

  if (subscription) {
    return subscription;
  }

  const now = new Date();

  try {
    subscription = await Subscription.create({
      user: userId,
      planKey: ARTISAN_PLAN.key,
      status: "trialing",
      trialStartedAt: now,
      trialEndsAt: getTrialEndDate(now),
      amountKobo: ARTISAN_PLAN.amountKobo,
      currency: ARTISAN_PLAN.currency,
      provider: "paystack",

      /*
       * A free trial does not yet have an authorised
       * recurring Paystack subscription.
       */
      autoRenew: false,
    });

    return subscription;
  } catch (error) {
    if (error?.code === 11000) {
      return Subscription.findOne({
        user: userId,
      });
    }

    throw error;
  }
}

async function getSubscriptionForUser(userId) {
  return Subscription.findOne({
    user: userId,
  });
}

async function getSubscriptionSummary(userId) {
  const subscription = await getSubscriptionForUser(userId);

  return serializeSubscription(subscription);
}

module.exports = {
  getTrialEndDate,
  isSubscriptionPaymentRequired,
  getOrCreateArtisanSubscription,
  getSubscriptionForUser,
  getSubscriptionSummary,
};
