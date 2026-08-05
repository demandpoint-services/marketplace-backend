const User = require("../models/User");
const SubscriptionEmailLog = require("../models/SubscriptionEmailLog");

const {
  createNotificationSafely,
  getOrCreatePreferences,
} = require("./notificationService");

const { NOTIFICATION_TYPES } = require("../constants/notificationTypes");
const {
  NOTIFICATION_CATEGORIES,
} = require("../constants/notificationCategories");

const {
  buildEmailHtml,
  sendSubscriptionEmail,
} = require("../utils/sendSubscriptionEmail");

const SUBSCRIPTION_URL =
  process.env.FRONTEND_URL
    ? `${process.env.FRONTEND_URL.replace(/\/$/, "")}/settings?section=subscription`
    : "https://demandpoint.app/settings?section=subscription";

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

async function shouldSendOptionalEmail(userId, preferenceField) {
  const preferences = await getOrCreatePreferences(userId);

  if (preferences.emailNotifications === false) {
    return false;
  }

  return preferenceField ? preferences[preferenceField] !== false : true;
}

async function sendEmailOnce({
  user,
  subscription,
  payment = null,
  type,
  dedupeKey,
  subject,
  html,
  optionalPreference = null,
  essential = false,
}) {
  if (!user?.email || !subscription?._id || !dedupeKey) {
    return null;
  }

  if (
    !essential &&
    !(await shouldSendOptionalEmail(user._id, optionalPreference))
  ) {
    return null;
  }

  let log;

  try {
    log = await SubscriptionEmailLog.create({
      recipient: user._id,
      subscription: subscription._id,
      payment: payment?._id || null,
      type,
      dedupeKey,
      email: user.email,
      subject,
      status: "sending",
    });
  } catch (error) {
    if (error?.code === 11000) {
      return SubscriptionEmailLog.findOne({ dedupeKey });
    }

    throw error;
  }

  try {
    const result = await sendSubscriptionEmail({
      to: user.email,
      subject,
      html,
    });

    log.status = "sent";
    log.resendEmailId = result?.id || null;
    log.sentAt = new Date();
    log.failureReason = null;

    await log.save();

    return log;
  } catch (error) {
    log.status = "failed";
    log.failureReason = error?.message || "Subscription email failed.";

    await log.save().catch((saveError) => {
      console.error("Save subscription email failure error:", saveError);
    });

    console.error(`${type} email error:`, error);
    return null;
  }
}

async function notifyTrialStarted({ subscription }) {
  const user = await getSubscriptionUser(subscription);

  if (!user) return null;

  const dedupeKey = `subscription-trial-started:${subscription._id}`;
  const message = `Your 30-day DemandPoint Professional free trial is active until ${formatDate(
    subscription.trialEndsAt,
  )}.`;

  const notification = await createNotificationSafely(
    {
      recipient: user._id,
      type: NOTIFICATION_TYPES.SUBSCRIPTION_TRIAL_STARTED,
      category: NOTIFICATION_CATEGORIES.PAYMENT,
      title: "Your free trial has started",
      message,
      actionUrl: "/settings?section=subscription",
      resourceType: "subscription",
      resourceId: subscription._id,
      dedupeKey,
      metadata: {
        subscriptionId: subscription._id,
        trialStartedAt: subscription.trialStartedAt,
        trialEndsAt: subscription.trialEndsAt,
      },
    },
    "Trial start notification",
  );

  await sendEmailOnce({
    user,
    subscription,
    type: "trial_started",
    dedupeKey,
    subject: "Your 30-day DemandPoint Professional trial has started",
    optionalPreference: "subscriptionUpdates",
    html: buildEmailHtml({
      title: "Your free trial is active",
      greeting: `Hi ${user.name || "there"},`,
      paragraphs: [
        "Your 30-day DemandPoint Professional free trial has started.",
        "During the trial, your artisan profile can appear in marketplace listings, receive booking requests, and use professional portfolio tools.",
      ],
      highlight: `Trial ends: ${formatDate(subscription.trialEndsAt)}`,
      buttonLabel: "View subscription",
      buttonUrl: SUBSCRIPTION_URL,
    }),
  });

  return notification;
}

async function notifyTrialEnding({ subscription, daysRemaining }) {
  const user = await getSubscriptionUser(subscription);

  if (!user) return null;

  const dedupeKey = `subscription-trial-reminder:${subscription._id}:${daysRemaining}`;
  const dayText = daysRemaining === 1 ? "day" : "days";

  const notification = await createNotificationSafely(
    {
      recipient: user._id,
      type: NOTIFICATION_TYPES.SUBSCRIPTION_TRIAL_ENDING,
      category: NOTIFICATION_CATEGORIES.PAYMENT,
      title: "Your free trial is ending soon",
      message: `Your DemandPoint Professional free trial ends in ${daysRemaining} ${dayText}. Subscribe now to remain visible to clients and continue receiving bookings.`,
      actionUrl: "/settings?section=subscription",
      resourceType: "subscription",
      resourceId: subscription._id,
      dedupeKey,
      metadata: {
        subscriptionId: subscription._id,
        daysRemaining,
        trialEndsAt: subscription.trialEndsAt,
      },
    },
    "Trial reminder notification",
  );

  await sendEmailOnce({
    user,
    subscription,
    type: "trial_ending",
    dedupeKey,
    subject: `Your DemandPoint trial ends in ${daysRemaining} ${dayText}`,
    optionalPreference: "trialReminders",
    html: buildEmailHtml({
      title: "Your free trial is ending soon",
      greeting: `Hi ${user.name || "there"},`,
      paragraphs: [
        `Your DemandPoint Professional free trial ends in ${daysRemaining} ${dayText}.`,
        "Subscribe before it ends to keep your profile visible in marketplace listings and continue receiving bookings without interruption.",
      ],
      highlight: `Trial ends: ${formatDate(subscription.trialEndsAt)}`,
      buttonLabel: "Subscribe now",
      buttonUrl: SUBSCRIPTION_URL,
    }),
  });

  return notification;
}

async function notifyTrialExpired({ subscription }) {
  const user = await getSubscriptionUser(subscription);

  if (!user) return null;

  const dedupeKey = `subscription-trial-expired:${subscription._id}`;

  const notification = await createNotificationSafely(
    {
      recipient: user._id,
      type: NOTIFICATION_TYPES.SUBSCRIPTION_TRIAL_EXPIRED,
      category: NOTIFICATION_CATEGORIES.PAYMENT,
      title: "Your free trial has ended",
      message:
        "Your DemandPoint Professional trial has ended. Subscribe to restore your marketplace visibility and continue receiving bookings.",
      actionUrl: "/settings?section=subscription",
      resourceType: "subscription",
      resourceId: subscription._id,
      dedupeKey,
      metadata: {
        subscriptionId: subscription._id,
        trialEndsAt: subscription.trialEndsAt,
      },
    },
    "Trial expiry notification",
  );

  await sendEmailOnce({
    user,
    subscription,
    type: "trial_expired",
    dedupeKey,
    subject: "Your DemandPoint Professional free trial has ended",
    optionalPreference: "trialReminders",
    html: buildEmailHtml({
      title: "Your free trial has ended",
      greeting: `Hi ${user.name || "there"},`,
      paragraphs: [
        "Your 30-day DemandPoint Professional free trial has ended.",
        "Your artisan profile is now hidden from marketplace listings until you activate your professional subscription.",
      ],
      buttonLabel: "Activate subscription",
      buttonUrl: SUBSCRIPTION_URL,
    }),
  });

  return notification;
}

async function notifyPaymentSuccess({
  subscription,
  payment,
  isRenewal = false,
}) {
  const user = await getSubscriptionUser(subscription);

  if (!user) return null;

  const amount = formatMoney(
    payment?.amountKobo || subscription.amountKobo,
    payment?.currency || subscription.currency,
  );

  const type = isRenewal
    ? NOTIFICATION_TYPES.SUBSCRIPTION_RENEWED
    : NOTIFICATION_TYPES.SUBSCRIPTION_ACTIVATED;

  const title = isRenewal ? "Subscription renewed" : "Subscription activated";
  const dedupeKey = `subscription-payment-success:${
    payment?.reference || payment?._id
  }`;

  const message = isRenewal
    ? `Your ${amount} DemandPoint Professional renewal payment was successful.`
    : `Your ${amount} payment was successful and DemandPoint Professional is now active.`;

  const notification = await createNotificationSafely(
    {
      recipient: user._id,
      type,
      category: NOTIFICATION_CATEGORIES.PAYMENT,
      title,
      message,
      actionUrl: "/settings?section=subscription",
      resourceType: "payment",
      resourceId: payment?._id || null,
      dedupeKey,
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

  await sendEmailOnce({
    user,
    subscription,
    payment,
    type: isRenewal ? "subscription_renewed" : "subscription_activated",
    dedupeKey,
    subject: isRenewal
      ? "Your DemandPoint Professional subscription has renewed"
      : "Your DemandPoint Professional subscription is active",
    essential: true,
    html: buildEmailHtml({
      title: isRenewal ? "Subscription renewed" : "Subscription activated",
      greeting: `Hi ${user.name || "there"},`,
      paragraphs: [
        isRenewal
          ? "Your monthly DemandPoint Professional renewal payment was successful."
          : "Your payment was successful and DemandPoint Professional is now active.",
        "Your artisan profile remains visible to clients and your professional tools are available.",
      ],
      highlight: `${amount} paid • Access until ${formatDate(
        subscription.currentPeriodEnd,
      )}`,
      buttonLabel: "Manage subscription",
      buttonUrl: SUBSCRIPTION_URL,
      footerNote: payment?.reference
        ? `Payment reference: ${payment.reference}`
        : "Keep this email for your records.",
    }),
  });

  return notification;
}

async function notifyPaymentFailed({
  subscription,
  payment = null,
  reference = null,
  reason = null,
}) {
  const user = await getSubscriptionUser(subscription);

  if (!user) return null;

  const dedupeSource =
    reference ||
    payment?.reference ||
    payment?._id ||
    subscription.lastPaymentFailureAt?.getTime() ||
    subscription._id;

  const dedupeKey = `subscription-payment-failed:${dedupeSource}`;

  const notification = await createNotificationSafely(
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
      dedupeKey,
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

  await sendEmailOnce({
    user,
    subscription,
    payment,
    type: "payment_failed",
    dedupeKey,
    subject: "Action required: your subscription payment failed",
    essential: true,
    html: buildEmailHtml({
      title: "Subscription payment failed",
      greeting: `Hi ${user.name || "there"},`,
      paragraphs: [
        "We could not process your DemandPoint Professional renewal payment.",
        "Please return to your subscription settings and complete payment to restore or maintain your marketplace access.",
      ],
      highlight:
        reason ||
        payment?.failureReason ||
        subscription.paymentFailureReason ||
        "The payment could not be completed.",
      buttonLabel: "Resolve payment",
      buttonUrl: SUBSCRIPTION_URL,
    }),
  });

  return notification;
}


async function notifyRenewalReminder({ subscription, daysRemaining }) {
  const user = await getSubscriptionUser(subscription);

  if (!user) return null;

  const dayText = daysRemaining === 1 ? "day" : "days";
  const dedupeKey = `subscription-renewal-reminder:${subscription._id}:${
    subscription.nextPaymentAt
      ? new Date(subscription.nextPaymentAt).toISOString()
      : daysRemaining
  }:${daysRemaining}`;

  const notification = await createNotificationSafely(
    {
      recipient: user._id,
      type: NOTIFICATION_TYPES.SUBSCRIPTION_RENEWAL_REMINDER,
      category: NOTIFICATION_CATEGORIES.PAYMENT,
      title: "Subscription renewal approaching",
      message: `Your DemandPoint Professional subscription is scheduled to renew in ${daysRemaining} ${dayText}.`,
      actionUrl: "/settings?section=subscription",
      resourceType: "subscription",
      resourceId: subscription._id,
      dedupeKey,
      metadata: {
        subscriptionId: subscription._id,
        daysRemaining,
        nextPaymentAt: subscription.nextPaymentAt,
        amountKobo: subscription.amountKobo,
        currency: subscription.currency,
      },
    },
    "Subscription renewal reminder notification",
  );

  await sendEmailOnce({
    user,
    subscription,
    type: "renewal_reminder",
    dedupeKey,
    subject: `Your DemandPoint subscription renews in ${daysRemaining} ${dayText}`,
    optionalPreference: "renewalReminders",
    html: buildEmailHtml({
      title: "Subscription renewal approaching",
      greeting: `Hi ${user.name || "there"},`,
      paragraphs: [
        `Your DemandPoint Professional subscription is scheduled to renew in ${daysRemaining} ${dayText}.`,
        "No action is required while automatic renewal remains enabled.",
      ],
      highlight: `${formatMoney(
        subscription.amountKobo,
        subscription.currency,
      )} scheduled for ${formatDate(subscription.nextPaymentAt)}`,
      buttonLabel: "Manage subscription",
      buttonUrl: SUBSCRIPTION_URL,
    }),
  });

  return notification;
}

async function notifyRenewalCancelled({ subscription }) {
  const user = await getSubscriptionUser(subscription);

  if (!user) return null;

  const dedupeKey = `subscription-renewal-cancelled:${subscription._id}:${
    subscription.currentPeriodEnd
      ? new Date(subscription.currentPeriodEnd).toISOString()
      : "unknown"
  }`;

  const notification = await createNotificationSafely(
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
      dedupeKey,
      metadata: {
        subscriptionId: subscription._id,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelledAt: subscription.cancelledAt,
      },
    },
    "Subscription cancellation notification",
  );

  await sendEmailOnce({
    user,
    subscription,
    type: "renewal_cancelled",
    dedupeKey,
    subject: "Automatic renewal has been cancelled",
    essential: true,
    html: buildEmailHtml({
      title: "Automatic renewal cancelled",
      greeting: `Hi ${user.name || "there"},`,
      paragraphs: [
        "Automatic renewal for your DemandPoint Professional subscription has been cancelled.",
        "You will keep access through the end of your current paid period, and no further automatic charge will be attempted.",
      ],
      highlight: `Access remains available until ${formatDate(
        subscription.currentPeriodEnd,
      )}`,
      buttonLabel: "View subscription",
      buttonUrl: SUBSCRIPTION_URL,
    }),
  });

  return notification;
}

async function notifySubscriptionExpired({ subscription }) {
  const user = await getSubscriptionUser(subscription);

  if (!user) return null;

  const dedupeKey = `subscription-expired:${subscription._id}:${
    subscription.currentPeriodEnd
      ? new Date(subscription.currentPeriodEnd).toISOString()
      : "unknown"
  }`;

  const notification = await createNotificationSafely(
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
      dedupeKey,
      metadata: {
        subscriptionId: subscription._id,
        currentPeriodEnd: subscription.currentPeriodEnd,
        status: subscription.status,
      },
    },
    "Subscription expiry notification",
  );

  await sendEmailOnce({
    user,
    subscription,
    type: "subscription_expired",
    dedupeKey,
    subject: "Your DemandPoint Professional access has ended",
    essential: true,
    html: buildEmailHtml({
      title: "Professional access ended",
      greeting: `Hi ${user.name || "there"},`,
      paragraphs: [
        "Your DemandPoint Professional access has ended.",
        "Your artisan profile is hidden from marketplace listings until you renew your subscription.",
      ],
      buttonLabel: "Renew subscription",
      buttonUrl: SUBSCRIPTION_URL,
    }),
  });

  return notification;
}

module.exports = {
  formatMoney,
  formatDate,
  notifyTrialStarted,
  notifyTrialEnding,
  notifyTrialExpired,
  notifyPaymentSuccess,
  notifyPaymentFailed,
  notifyRenewalReminder,
  notifyRenewalCancelled,
  notifySubscriptionExpired,
};
