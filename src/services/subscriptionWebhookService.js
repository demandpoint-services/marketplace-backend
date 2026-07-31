const crypto = require("crypto");

const User = require("../models/User");
const Subscription = require("../models/Subscription");
const SubscriptionPayment = require("../models/SubscriptionPayment");

const { SUBSCRIPTION_PLANS } = require("../constants/subscriptionPlans");

const ARTISAN_PLAN = SUBSCRIPTION_PLANS.ARTISAN_MONTHLY;

function getPaystackSecretKey() {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;

  if (!secretKey) {
    throw new Error("PAYSTACK_SECRET_KEY is not configured.");
  }

  return secretKey;
}

function verifyPaystackSignature(payload, signature) {
  if (!signature) {
    return false;
  }

  const hash = crypto
    .createHmac("sha512", getPaystackSecretKey())
    .update(JSON.stringify(payload))
    .digest("hex");

  const hashBuffer = Buffer.from(hash, "utf8");
  const signatureBuffer = Buffer.from(String(signature), "utf8");

  if (hashBuffer.length !== signatureBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(hashBuffer, signatureBuffer);
}

function normalizeMetadata(metadata) {
  if (!metadata) {
    return {};
  }

  if (typeof metadata === "object") {
    return metadata;
  }

  if (typeof metadata === "string") {
    try {
      return JSON.parse(metadata);
    } catch {
      return {};
    }
  }

  return {};
}

function parseDate(value, fallback = null) {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? fallback : date;
}

function addOneCalendarMonth(date) {
  const result = new Date(date);
  const originalDay = result.getDate();

  result.setDate(1);
  result.setMonth(result.getMonth() + 1);

  const lastDayOfTargetMonth = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0,
  ).getDate();

  result.setDate(Math.min(originalDay, lastDayOfTargetMonth));

  return result;
}

function getCustomerCode(data) {
  if (typeof data?.customer === "string") {
    return data.customer;
  }

  return (
    data?.customer?.customer_code ||
    data?.customer_code ||
    data?.subscription?.customer?.customer_code ||
    data?.subscription?.customer_code ||
    null
  );
}

function getSubscriptionCode(data) {
  if (typeof data?.subscription === "string") {
    return data.subscription;
  }

  return (
    data?.subscription_code || data?.subscription?.subscription_code || null
  );
}

function getPlanCode(data) {
  if (typeof data?.plan === "string") {
    return data.plan;
  }

  return (
    data?.plan?.plan_code ||
    data?.subscription?.plan?.plan_code ||
    data?.subscription?.plan_code ||
    null
  );
}

function getReference(data) {
  return (
    data?.reference ||
    data?.transaction?.reference ||
    data?.subscription?.reference ||
    null
  );
}

function getInvoiceCode(data) {
  return data?.invoice_code || data?.invoice?.invoice_code || null;
}

async function findSubscriptionFromWebhook(data) {
  const subscriptionCode = getSubscriptionCode(data);
  const customerCode = getCustomerCode(data);
  const metadata = normalizeMetadata(data?.metadata);

  const queries = [];

  if (subscriptionCode) {
    queries.push({ paystackSubscriptionCode: subscriptionCode });
  }

  if (customerCode) {
    queries.push({ paystackCustomerCode: customerCode });
  }

  if (metadata.subscriptionId) {
    queries.push({ _id: metadata.subscriptionId });
  }

  if (metadata.userId) {
    queries.push({ user: metadata.userId });
  }

  if (queries.length > 0) {
    const subscription = await Subscription.findOne({
      $or: queries,
    });

    if (subscription) {
      return subscription;
    }
  }

  const reference = getReference(data);

  if (reference) {
    const payment = await SubscriptionPayment.findOne({ reference });

    if (payment) {
      return Subscription.findById(payment.subscription);
    }
  }

  const email = data?.customer?.email || data?.email || null;

  if (email) {
    const user = await User.findOne({
      email: email.toLowerCase(),
      role: "artisan",
    }).select("_id");

    if (user) {
      return Subscription.findOne({ user: user._id });
    }
  }

  return null;
}

async function upsertSuccessfulPayment({
  subscription,
  data,
  paymentSource = "webhook",
}) {
  const reference = getReference(data);

  if (!reference) {
    return null;
  }

  const paidAt =
    parseDate(data?.paid_at) ||
    parseDate(data?.paidAt) ||
    parseDate(data?.transaction?.paid_at) ||
    new Date();

  const amountKobo = Number(
    data?.requested_amount ??
      data?.transaction?.requested_amount ??
      data?.amount ??
      data?.transaction?.amount ??
      ARTISAN_PLAN.amountKobo,
  );

  const customerChargedKobo = Number(
    data?.amount ?? data?.transaction?.amount ?? amountKobo,
  );

  const feesKobo = Number(
    data?.fees ??
      data?.transaction?.fees ??
      Math.max(customerChargedKobo - amountKobo, 0),
  );

  return SubscriptionPayment.findOneAndUpdate(
    { reference },
    {
      $set: {
        user: subscription.user,
        subscription: subscription._id,
        amountKobo: ARTISAN_PLAN.amountKobo,
        requestedAmountKobo: amountKobo,
        customerChargedKobo,
        feesKobo,
        currency: String(
          data?.currency ||
            data?.transaction?.currency ||
            ARTISAN_PLAN.currency,
        ).toUpperCase(),
        status: "success",
        provider: "paystack",
        paymentSource,
        paystackTransactionId: data?.id || data?.transaction?.id || null,
        paystackInvoiceCode: getInvoiceCode(data),
        paystackSubscriptionCode: getSubscriptionCode(data),
        channel: data?.channel || data?.transaction?.channel || null,
        gatewayResponse:
          data?.gateway_response || data?.transaction?.gateway_response || null,
        paidAt,
        verifiedAt: new Date(),
        failureReason: null,
      },
      $setOnInsert: {
        reference,
      },
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
    },
  );
}

async function handleChargeSuccess(data) {
  const subscription = await findSubscriptionFromWebhook(data);

  if (!subscription) {
    return {
      handled: false,
      reason: "No matching DemandPoint subscription was found.",
    };
  }

  const amount = Number(
    data?.requested_amount ?? data?.amount ?? ARTISAN_PLAN.amountKobo,
  );

  const currency = String(
    data?.currency || ARTISAN_PLAN.currency,
  ).toUpperCase();

  if (
    amount !== ARTISAN_PLAN.amountKobo &&
    Number(data?.amount) !== ARTISAN_PLAN.amountKobo
  ) {
    throw new Error(
      `Webhook payment amount mismatch. Received ${amount} kobo.`,
    );
  }

  if (currency !== ARTISAN_PLAN.currency) {
    throw new Error(`Webhook payment currency mismatch. Received ${currency}.`);
  }

  const paidAt = parseDate(data?.paid_at, new Date());

  const nextPaymentAt =
    parseDate(data?.subscription?.next_payment_date) ||
    parseDate(data?.next_payment_date) ||
    addOneCalendarMonth(paidAt);

  subscription.status = "active";
  subscription.providerStatus = "active";
  subscription.currentPeriodStart = paidAt;
  subscription.currentPeriodEnd = nextPaymentAt;
  subscription.amountKobo = ARTISAN_PLAN.amountKobo;
  subscription.currency = ARTISAN_PLAN.currency;
  subscription.paystackPlanCode =
    getPlanCode(data) ||
    subscription.paystackPlanCode ||
    process.env.PAYSTACK_PLAN_CODE;
  subscription.lastPaymentAt = paidAt;
  subscription.nextPaymentAt = nextPaymentAt;
  subscription.lastPaymentFailureAt = null;
  subscription.paymentFailureReason = null;
  subscription.autoRenew = true;
  subscription.cancelledAt = null;
  subscription.webhookUpdatedAt = new Date();

  const customerCode = getCustomerCode(data);
  const subscriptionCode = getSubscriptionCode(data);

  if (customerCode) {
    subscription.paystackCustomerCode = customerCode;
  }

  if (subscriptionCode) {
    subscription.paystackSubscriptionCode = subscriptionCode;
  }

  if (data?.authorization?.authorization_code) {
    subscription.paystackAuthorizationCode =
      data.authorization.authorization_code;
  }

  await subscription.save();

  await upsertSuccessfulPayment({
    subscription,
    data,
    paymentSource: "webhook",
  });

  return {
    handled: true,
    subscriptionId: subscription._id,
  };
}

async function handleSubscriptionCreate(data) {
  const subscription = await findSubscriptionFromWebhook(data);

  if (!subscription) {
    return {
      handled: false,
      reason: "No matching DemandPoint subscription was found.",
    };
  }

  const subscriptionCode = getSubscriptionCode(data);
  const customerCode = getCustomerCode(data);
  const planCode = getPlanCode(data);

  if (subscriptionCode) {
    subscription.paystackSubscriptionCode = subscriptionCode;
  }

  if (customerCode) {
    subscription.paystackCustomerCode = customerCode;
  }

  if (planCode) {
    subscription.paystackPlanCode = planCode;
  }

  if (data?.email_token) {
    subscription.paystackEmailToken = data.email_token;
  }

  if (data?.authorization?.authorization_code) {
    subscription.paystackAuthorizationCode =
      data.authorization.authorization_code;
  }

  subscription.providerStatus = data?.status || "active";
  subscription.autoRenew = data?.status !== "non-renewing";
  subscription.cancelledAt = null;
  subscription.webhookUpdatedAt = new Date();

  const nextPaymentAt = parseDate(data?.next_payment_date);

  if (nextPaymentAt) {
    subscription.nextPaymentAt = nextPaymentAt;
    subscription.currentPeriodEnd = nextPaymentAt;
  }

  if (
    data?.status === "active" &&
    subscription.status !== "active" &&
    subscription.lastPaymentAt
  ) {
    subscription.status = "active";
  }

  await subscription.save();

  return {
    handled: true,
    subscriptionId: subscription._id,
  };
}

async function handleInvoiceCreate(data) {
  const subscription = await findSubscriptionFromWebhook(data);

  if (!subscription) {
    return {
      handled: false,
      reason: "No matching DemandPoint subscription was found.",
    };
  }

  subscription.providerStatus = data?.status || "invoice_pending";
  subscription.webhookUpdatedAt = new Date();

  const periodEnd = parseDate(data?.period_end);

  if (periodEnd) {
    subscription.nextPaymentAt = periodEnd;
  }

  await subscription.save();

  return {
    handled: true,
    subscriptionId: subscription._id,
  };
}

async function handleInvoiceUpdate(data) {
  const transaction = data?.transaction || {};

  if (
    data?.paid === true ||
    data?.status === "success" ||
    transaction?.status === "success"
  ) {
    return handleChargeSuccess({
      ...transaction,
      customer: data?.customer || transaction?.customer,
      subscription: data?.subscription,
      subscription_code: getSubscriptionCode(data),
      invoice_code: getInvoiceCode(data),
      metadata: data?.metadata || transaction?.metadata,
      paid_at:
        transaction?.paid_at || data?.paid_at || data?.period_end || new Date(),
    });
  }

  const subscription = await findSubscriptionFromWebhook(data);

  if (!subscription) {
    return {
      handled: false,
      reason: "No matching DemandPoint subscription was found.",
    };
  }

  subscription.providerStatus = data?.status || "invoice_updated";
  subscription.webhookUpdatedAt = new Date();

  await subscription.save();

  return {
    handled: true,
    subscriptionId: subscription._id,
  };
}

async function handleInvoicePaymentFailed(data) {
  const subscription = await findSubscriptionFromWebhook(data);

  if (!subscription) {
    return {
      handled: false,
      reason: "No matching DemandPoint subscription was found.",
    };
  }

  const failureDate = new Date();

  subscription.status = "past_due";
  subscription.providerStatus = "payment_failed";
  subscription.lastPaymentFailureAt = failureDate;
  subscription.paymentFailureReason =
    data?.message ||
    data?.gateway_response ||
    data?.transaction?.gateway_response ||
    "Paystack subscription renewal payment failed.";
  subscription.webhookUpdatedAt = failureDate;

  await subscription.save();

  const reference = getReference(data);

  if (reference) {
    await SubscriptionPayment.findOneAndUpdate(
      { reference },
      {
        $set: {
          user: subscription.user,
          subscription: subscription._id,
          amountKobo: Number(data?.amount || ARTISAN_PLAN.amountKobo),
          requestedAmountKobo: Number(data?.amount || ARTISAN_PLAN.amountKobo),
          customerChargedKobo: Number(data?.amount || 0),
          currency: String(
            data?.currency || ARTISAN_PLAN.currency,
          ).toUpperCase(),
          status: "failed",
          provider: "paystack",
          paymentSource: "webhook",
          paystackInvoiceCode: getInvoiceCode(data),
          paystackSubscriptionCode: getSubscriptionCode(data),
          verifiedAt: failureDate,
          failureReason: subscription.paymentFailureReason,
        },
        $setOnInsert: {
          reference,
        },
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
      },
    );
  }

  return {
    handled: true,
    subscriptionId: subscription._id,
  };
}

async function handleSubscriptionNotRenew(data) {
  const subscription = await findSubscriptionFromWebhook(data);

  if (!subscription) {
    return {
      handled: false,
      reason: "No matching DemandPoint subscription was found.",
    };
  }

  subscription.autoRenew = false;
  subscription.providerStatus = "non-renewing";
  subscription.webhookUpdatedAt = new Date();

  const nextPaymentAt = parseDate(data?.next_payment_date);

  if (nextPaymentAt) {
    subscription.nextPaymentAt = nextPaymentAt;
    subscription.currentPeriodEnd = nextPaymentAt;
  }

  await subscription.save();

  return {
    handled: true,
    subscriptionId: subscription._id,
  };
}

async function handleSubscriptionDisable(data) {
  const subscription = await findSubscriptionFromWebhook(data);

  if (!subscription) {
    return {
      handled: false,
      reason: "No matching DemandPoint subscription was found.",
    };
  }

  const disabledAt = new Date();

  subscription.status = "cancelled";
  subscription.providerStatus = data?.status || "cancelled";
  subscription.autoRenew = false;
  subscription.cancelledAt = disabledAt;
  subscription.nextPaymentAt = null;
  subscription.webhookUpdatedAt = disabledAt;

  const periodEnd =
    parseDate(data?.next_payment_date) || parseDate(data?.period_end);

  if (periodEnd && periodEnd > disabledAt) {
    subscription.currentPeriodEnd = periodEnd;
  } else if (
    !subscription.currentPeriodEnd ||
    subscription.currentPeriodEnd < disabledAt
  ) {
    subscription.currentPeriodEnd = disabledAt;
  }

  await subscription.save();

  return {
    handled: true,
    subscriptionId: subscription._id,
  };
}

async function processPaystackSubscriptionEvent(event) {
  switch (event.event) {
    case "charge.success":
      return handleChargeSuccess(event.data);

    case "subscription.create":
      return handleSubscriptionCreate(event.data);

    case "invoice.create":
      return handleInvoiceCreate(event.data);

    case "invoice.update":
      return handleInvoiceUpdate(event.data);

    case "invoice.payment_failed":
      return handleInvoicePaymentFailed(event.data);

    case "subscription.not_renew":
      return handleSubscriptionNotRenew(event.data);

    case "subscription.disable":
      return handleSubscriptionDisable(event.data);

    default:
      return {
        handled: false,
        reason: `Unsupported event type: ${event.event}`,
      };
  }
}

module.exports = {
  verifyPaystackSignature,
  processPaystackSubscriptionEvent,
  getReference,
  getSubscriptionCode,
  getCustomerCode,
};
