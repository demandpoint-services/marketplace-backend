const { SUBSCRIPTION_PLANS } = require("../constants/subscriptionPlans");

const ARTISAN_PLAN = SUBSCRIPTION_PLANS.ARTISAN_MONTHLY;

function calculateDaysRemaining(date) {
  if (!date) {
    return 0;
  }

  const difference = new Date(date).getTime() - Date.now();

  if (difference <= 0) {
    return 0;
  }

  return Math.ceil(difference / (1000 * 60 * 60 * 24));
}

function getEffectiveSubscriptionStatus(subscription) {
  if (!subscription) {
    return "none";
  }

  const now = Date.now();

  if (subscription.status === "trialing") {
    const trialEndsAt = subscription.trialEndsAt
      ? new Date(subscription.trialEndsAt).getTime()
      : null;

    if (!trialEndsAt || trialEndsAt <= now) {
      return "expired";
    }

    return "trialing";
  }

  if (subscription.status === "active") {
    const currentPeriodEnd = subscription.currentPeriodEnd
      ? new Date(subscription.currentPeriodEnd).getTime()
      : null;

    if (currentPeriodEnd && currentPeriodEnd <= now) {
      return "expired";
    }

    return "active";
  }

  /*
   * A cancelled subscription remains usable until the end
   * of a period that has already been paid for.
   */
  if (subscription.status === "cancelled") {
    const currentPeriodEnd = subscription.currentPeriodEnd
      ? new Date(subscription.currentPeriodEnd).getTime()
      : null;

    if (currentPeriodEnd && currentPeriodEnd > now) {
      return "active";
    }

    return "cancelled";
  }

  return subscription.status;
}

function hasActiveArtisanAccess(subscription) {
  const status = getEffectiveSubscriptionStatus(subscription);

  return status === "trialing" || status === "active";
}

function isSubscriptionPaymentRequired(subscription) {
  const status = getEffectiveSubscriptionStatus(subscription);

  return ["none", "expired", "past_due", "cancelled"].includes(status);
}

function getSubscriptionAccess(subscription) {
  const status = getEffectiveSubscriptionStatus(subscription);
  const hasAccess = hasActiveArtisanAccess(subscription);
  const paymentRequired = isSubscriptionPaymentRequired(subscription);

  return {
    status,
    hasAccess,
    paymentRequired,

    isVisibleInMarketplace: hasAccess,
    canReceiveBookings: hasAccess,
    canManageBookings: hasAccess,
    canCreatePortfolio: hasAccess,
    canUpdatePortfolio: hasAccess,
    canDeletePortfolio: hasAccess,
    canBecomeVendor: hasAccess,
    canSellProducts: hasAccess,
    canCreateProducts: hasAccess,
    canUpdateProducts: hasAccess,
    canReceiveNewOrders: hasAccess,

    profileVisibility: hasAccess ? "visible" : "hidden",

    restrictionCode: hasAccess ? null : "SUBSCRIPTION_REQUIRED",

    restrictionMessage: hasAccess
      ? null
      : "Your DemandPoint Professional subscription is inactive. Renew your subscription to continue.",
  };
}

function serializeSubscription(subscription) {
  if (!subscription) {
    return null;
  }

  const access = getSubscriptionAccess(subscription);
  const isTrialing = access.status === "trialing";

  const relevantEndDate = isTrialing
    ? subscription.trialEndsAt
    : subscription.currentPeriodEnd;

  return {
    _id: subscription._id,
    planKey: subscription.planKey,
    planName: ARTISAN_PLAN.name,

    status: access.status,
    hasAccess: access.hasAccess,
    paymentRequired: access.paymentRequired,

    trialStartedAt: subscription.trialStartedAt,
    trialEndsAt: subscription.trialEndsAt,

    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,

    daysRemaining: calculateDaysRemaining(relevantEndDate),

    price: ARTISAN_PLAN.priceNaira,
    amountKobo: subscription.amountKobo,
    currency: subscription.currency,

    billingInterval: "monthly",
    autoRenew: subscription.autoRenew,

    lastPaymentAt: subscription.lastPaymentAt,
    nextPaymentAt: subscription.nextPaymentAt,

    cancelledAt: subscription.cancelledAt,

    access,

    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
  };
}

module.exports = {
  calculateDaysRemaining,
  getEffectiveSubscriptionStatus,
  hasActiveArtisanAccess,
  isSubscriptionPaymentRequired,
  getSubscriptionAccess,
  serializeSubscription,
};
