const User = require("../models/User");

const { createNotificationSafely } = require("./notificationService");

const { NOTIFICATION_TYPES } = require("../constants/notificationTypes");

const {
  NOTIFICATION_CATEGORIES,
} = require("../constants/notificationCategories");

function formatMoney(amountKobo, currency = "NGN") {
  const amount = Number(amountKobo || 0) / 100;

  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `₦${amount.toLocaleString("en-NG")}`;
  }
}

function formatDate(value) {
  if (!value) {
    return "the end of your current billing period";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "the end of your current billing period";
  }

  return new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

async function getSubscriptionUser(subscription) {
  if (!subscription?.user) {
    return null;
  }

  return User.findById(subscription.user).select("name email role isSuspended");
}

async function notifyPaymentSuccess({
  subscription,
  payment,
  isRenewal = false,
}) {
  const user = await getSubscriptionUser(subscription);

  if (!user) {
    return null;
  }

  const amount = formatMoney(
    payment?.amountKobo || subscription.amountKobo,
    payment?.currency || subscription.currency,
  );

  const type = isRenewal
    ? NOTIFICATION_TYPES.SUBSCRIPTION_RENEWED
    : NOTIFICATION_TYPES.SUBSCRIPTION_ACTIVATED;

  const title = isRenewal ? "Subscription renewed" : "Subscription activated";

  const message = isRenewal
    ? `Your ${amount} DemandPoint Professional renewal payment was successful.`
    : `Your ${amount} payment was successful and DemandPoint Professional is now active.`;

  return createNotificationSafely(
    {
      recipient: user._id,
      type,
      category: NOTIFICATION_CATEGORIES.PAYMENT,
      title,
      message,
      actionUrl: "/settings?section=subscription",
      resourceType: "payment",
      resourceId: payment?._id || null,
      dedupeKey: `subscription-payment-success:${
        payment?.reference || payment?._id
      }`,
      metadata: {
        reference: payment?.reference || null,
        subscriptionId: subscription._id,
        paymentId: payment?._id || null,
        amountKobo: payment?.amountKobo || subscription.amountKobo,
        currency: payment?.currency || subscription.currency,
        paidAt: payment?.paidAt || subscription.lastPaymentAt,
        isRenewal,
      },
    },
    "Subscription payment notification",
  );
}

async function notifyPaymentFailed({
  subscription,
  payment = null,
  reference = null,
  reason = null,
}) {
  const user = await getSubscriptionUser(subscription);

  if (!user) {
    return null;
  }

  const dedupeSource =
    reference ||
    payment?.reference ||
    payment?._id ||
    subscription.lastPaymentFailureAt?.getTime() ||
    subscription._id;

  return createNotificationSafely(
    {
      recipient: user._id,
      type: NOTIFICATION_TYPES.PAYMENT_FAILED,
      category: NOTIFICATION_CATEGORIES.PAYMENT,
      title: "Subscription payment failed",
      message:
        "We could not process your DemandPoint Professional renewal. Update your payment details to restore or maintain access.",
      actionUrl: "/settings?section=subscription",
      resourceType: payment ? "payment" : "subscription",
      resourceId: payment?._id || subscription._id,
      dedupeKey: `subscription-payment-failed:${dedupeSource}`,
      metadata: {
        reference: reference || payment?.reference || null,
        subscriptionId: subscription._id,
        paymentId: payment?._id || null,
        reason:
          reason ||
          payment?.failureReason ||
          subscription.paymentFailureReason ||
          null,
      },
    },
    "Failed subscription payment notification",
  );
}

async function notifyRenewalCancelled({ subscription }) {
  const user = await getSubscriptionUser(subscription);

  if (!user) {
    return null;
  }

  return createNotificationSafely(
    {
      recipient: user._id,
      type: NOTIFICATION_TYPES.SUBSCRIPTION_RENEWAL_CANCELLED,
      category: NOTIFICATION_CATEGORIES.PAYMENT,
      title: "Automatic renewal cancelled",
      message: `Your DemandPoint Professional subscription will remain active until ${formatDate(
        subscription.currentPeriodEnd,
      )}, but it will not renew automatically.`,
      actionUrl: "/settings?section=subscription",
      resourceType: "subscription",
      resourceId: subscription._id,
      dedupeKey: `subscription-renewal-cancelled:${subscription._id}:${
        subscription.currentPeriodEnd
          ? new Date(subscription.currentPeriodEnd).toISOString()
          : "unknown"
      }`,
      metadata: {
        subscriptionId: subscription._id,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelledAt: subscription.cancelledAt,
      },
    },
    "Subscription cancellation notification",
  );
}

async function notifySubscriptionExpired({ subscription }) {
  const user = await getSubscriptionUser(subscription);

  if (!user) {
    return null;
  }

  return createNotificationSafely(
    {
      recipient: user._id,
      type: NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRED,
      category: NOTIFICATION_CATEGORIES.PAYMENT,
      title: "Professional subscription ended",
      message:
        "Your DemandPoint Professional access has ended. Renew your subscription to restore your marketplace visibility and professional tools.",
      actionUrl: "/settings?section=subscription",
      resourceType: "subscription",
      resourceId: subscription._id,
      dedupeKey: `subscription-expired:${subscription._id}:${
        subscription.currentPeriodEnd
          ? new Date(subscription.currentPeriodEnd).toISOString()
          : "unknown"
      }`,
      metadata: {
        subscriptionId: subscription._id,
        currentPeriodEnd: subscription.currentPeriodEnd,
        status: subscription.status,
      },
    },
    "Subscription expiry notification",
  );
}

module.exports = {
  formatMoney,
  formatDate,
  notifyPaymentSuccess,
  notifyPaymentFailed,
  notifyRenewalCancelled,
  notifySubscriptionExpired,
};
