const crypto = require("crypto");

const User = require("../models/User");
const SubscriptionPayment = require("../models/SubscriptionPayment");

const PaystackWebhookEvent = require("../models/PaystackWebhookEvent");

const {
  verifyPaystackSignature,
  processPaystackSubscriptionEvent,
  getReference,
  getSubscriptionCode,
  getCustomerCode,
} = require("../services/subscriptionWebhookService");

const {
  getOrCreateArtisanSubscription,
} = require("../services/subscriptionService");

const {
  initializeTransaction,
  verifyTransaction,
  disableSubscription,
  fetchPlan,
} = require("../services/paystackService");

const {
  isSubscriptionPaymentRequired,
  serializeSubscription,
} = require("../utils/subscriptionStatus");

const { SUBSCRIPTION_PLANS } = require("../constants/subscriptionPlans");

const ARTISAN_PLAN = SUBSCRIPTION_PLANS.ARTISAN_MONTHLY;

function createPaymentReference(userId) {
  const randomPart = crypto.randomBytes(6).toString("hex").toUpperCase();

  return `DP-SUB-${userId}-${Date.now()}-${randomPart}`;
}

function addOneCalendarMonth(date) {
  const result = new Date(date);

  const originalDay = result.getDate();

  // Move to the first day before changing month to prevent
  // JavaScript from skipping months for dates such as the 31st.
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

// GET /api/subscriptions/me
exports.getMySubscription = async (req, res) => {
  try {
    if (req.user.role !== "artisan") {
      return res.status(200).json({
        success: true,
        subscriptionApplies: false,
        subscriptionRequired: false,
        subscription: null,
        message: "Client accounts do not require a subscription.",
      });
    }

    const subscription = await getOrCreateArtisanSubscription(req.user._id);

    return res.status(200).json({
      success: true,
      subscriptionApplies: true,
      subscriptionRequired: isSubscriptionPaymentRequired(subscription),
      subscription: serializeSubscription(subscription),
    });
  } catch (error) {
    console.error("Get subscription error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve subscription details.",
    });
  }
};

// POST /api/subscriptions/initialize
exports.initializeSubscriptionPayment = async (req, res) => {
  let payment = null;

  try {
    if (req.user.role !== "artisan") {
      return res.status(403).json({
        success: false,
        message: "Only artisan accounts can purchase this subscription.",
      });
    }

    const user = await User.findById(req.user._id).select(
      "name email role isSuspended",
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User account not found.",
      });
    }

    if (user.isSuspended) {
      return res.status(403).json({
        success: false,
        message: "Your account is suspended. Contact support for assistance.",
      });
    }

    const planCode = process.env.PAYSTACK_PLAN_CODE;

    const callbackUrl = process.env.PAYSTACK_CALLBACK_URL;

    if (!planCode || !callbackUrl) {
      return res.status(503).json({
        success: false,
        message: "Subscription payments are not fully configured.",
      });
    }

    const paystackPlanResponse = await fetchPlan(planCode);

    const paystackPlan = paystackPlanResponse.data;

    const paystackPlanAmount = Number(paystackPlan?.amount);
    const paystackPlanCurrency = String(
      paystackPlan?.currency || "",
    ).toUpperCase();

    if (!Number.isFinite(paystackPlanAmount)) {
      return res.status(503).json({
        success: false,
        message:
          "The configured Paystack subscription plan has an invalid amount.",
      });
    }

    if (paystackPlanAmount !== ARTISAN_PLAN.amountKobo) {
      console.error("Paystack plan amount mismatch:", {
        planCode,
        paystackPlanAmount,
        configuredAmount: ARTISAN_PLAN.amountKobo,
      });

      return res.status(503).json({
        success: false,
        code: "PAYSTACK_PLAN_AMOUNT_MISMATCH",
        message:
          "The Paystack plan amount does not match the DemandPoint subscription price.",
      });
    }

    if (paystackPlanCurrency !== ARTISAN_PLAN.currency) {
      return res.status(503).json({
        success: false,
        code: "PAYSTACK_PLAN_CURRENCY_MISMATCH",
        message:
          "The Paystack plan currency does not match the DemandPoint subscription currency.",
      });
    }

    const subscription = await getOrCreateArtisanSubscription(user._id);

    /*
     * Prevent an already-active artisan from accidentally
     * paying for another overlapping subscription.
     */
    const subscriptionData = serializeSubscription(subscription);

    if (subscriptionData.status === "active" && subscriptionData.hasAccess) {
      return res.status(409).json({
        success: false,
        code: "SUBSCRIPTION_ALREADY_ACTIVE",
        message:
          "Your DemandPoint Professional subscription is already active.",
        subscription: subscriptionData,
      });
    }

    const reference = createPaymentReference(user._id.toString());

    payment = await SubscriptionPayment.create({
      user: user._id,
      subscription: subscription._id,
      reference,
      amountKobo: ARTISAN_PLAN.amountKobo,
      currency: ARTISAN_PLAN.currency,
      status: "initialized",
    });

    const paystackResponse = await initializeTransaction({
      email: user.email,
      amountKobo: ARTISAN_PLAN.amountKobo,
      reference,
      planCode,
      callbackUrl,
      metadata: {
        userId: user._id.toString(),
        subscriptionId: subscription._id.toString(),
        paymentId: payment._id.toString(),
        planKey: ARTISAN_PLAN.key,
        source: "demandpoint_web",
      },
    });

    payment.accessCode = paystackResponse.data.access_code;

    payment.authorizationUrl = paystackResponse.data.authorization_url;

    payment.status = "pending";

    await payment.save();

    return res.status(200).json({
      success: true,
      message: "Subscription checkout initialized successfully.",
      checkout: {
        reference,
        authorizationUrl: paystackResponse.data.authorization_url,
        accessCode: paystackResponse.data.access_code,
      },
      subscription: subscriptionData,
    });
  } catch (error) {
    console.error("Initialize subscription payment error:", error);

    if (payment) {
      payment.status = "failed";
      payment.failureReason = error.message || "Unable to initialize payment";

      await payment.save().catch((saveError) => {
        console.error("Save failed payment error:", saveError);
      });
    }

    return res
      .status(error?.status >= 400 && error?.status < 500 ? error.status : 500)
      .json({
        success: false,
        message: error?.message || "Unable to initialize subscription payment.",
      });
  }
};

// GET /api/subscriptions/verify/:reference
exports.verifySubscriptionPayment = async (req, res) => {
  try {
    const reference = req.params.reference?.trim();

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: "Payment reference is required.",
      });
    }

    if (req.user.role !== "artisan") {
      return res.status(403).json({
        success: false,
        message: "Only artisan accounts can verify this subscription payment.",
      });
    }

    const payment = await SubscriptionPayment.findOne({
      reference,
      user: req.user._id,
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Subscription payment record not found.",
      });
    }

    const subscription = await getOrCreateArtisanSubscription(req.user._id);

    /*
     * Verification must be idempotent. Repeated calls should
     * return the existing successful state without extending
     * the billing period repeatedly.
     */
    if (payment.status === "success") {
      return res.status(200).json({
        success: true,
        alreadyVerified: true,
        message: "Subscription payment was already verified.",
        subscription: serializeSubscription(subscription),
      });
    }

    const paystackResponse = await verifyTransaction(reference);

    const transaction = paystackResponse.data;

    if (transaction.reference !== reference) {
      return res.status(400).json({
        success: false,
        message: "Payment reference verification failed.",
      });
    }

    if (transaction.status !== "success") {
      payment.status =
        transaction.status === "abandoned" ? "abandoned" : "failed";

      payment.gatewayResponse = transaction.gateway_response || null;

      payment.failureReason = `Paystack transaction status: ${transaction.status}`;

      payment.verifiedAt = new Date();

      await payment.save();

      return res.status(400).json({
        success: false,
        code: "PAYMENT_NOT_SUCCESSFUL",
        message: "The subscription payment was not successful.",
        paymentStatus: transaction.status,
      });
    }

    const transactionAmount = Number(transaction.amount);

    const requestedAmount = Number(
      transaction.requested_amount ?? payment.amountKobo,
    );

    const expectedSubscriptionAmount = Number(payment.amountKobo);

    const amountMatches =
      requestedAmount === expectedSubscriptionAmount ||
      transactionAmount === expectedSubscriptionAmount;

    if (!amountMatches) {
      console.error("Subscription payment amount mismatch:", {
        reference,
        transactionAmount,
        requestedAmount,
        expectedSubscriptionAmount,
        transactionFees: transaction.fees,
      });

      return res.status(400).json({
        success: false,
        code: "PAYMENT_AMOUNT_MISMATCH",
        message:
          "The payment amount does not match the initialized subscription payment.",
      });
    }

    if (
      String(transaction.currency || "").toUpperCase() !==
      String(payment.currency || "").toUpperCase()
    ) {
      return res.status(400).json({
        success: false,
        code: "PAYMENT_CURRENCY_MISMATCH",
        message: "The payment currency could not be verified.",
      });
    }

    const metadata = normalizeMetadata(transaction.metadata);

    if (metadata.userId && metadata.userId !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        code: "PAYMENT_OWNER_MISMATCH",
        message: "This payment does not belong to the authenticated user.",
      });
    }

    const paidAt = transaction.paid_at
      ? new Date(transaction.paid_at)
      : new Date();

    const currentPeriodEnd = addOneCalendarMonth(paidAt);

    subscription.status = "active";
    subscription.currentPeriodStart = paidAt;
    subscription.currentPeriodEnd = currentPeriodEnd;

    subscription.amountKobo = ARTISAN_PLAN.amountKobo;

    subscription.currency = ARTISAN_PLAN.currency;

    subscription.paystackPlanCode = process.env.PAYSTACK_PLAN_CODE;

    subscription.lastPaymentAt = paidAt;
    subscription.nextPaymentAt = currentPeriodEnd;

    subscription.autoRenew = true;
    subscription.cancelledAt = null;

    if (transaction.customer?.customer_code) {
      subscription.paystackCustomerCode = transaction.customer.customer_code;
    }

    await subscription.save();

    payment.status = "success";
    payment.channel = transaction.channel || null;

    payment.gatewayResponse = transaction.gateway_response || null;

    payment.paidAt = paidAt;
    payment.verifiedAt = new Date();
    payment.failureReason = null;

    await payment.save();

    return res.status(200).json({
      success: true,
      message: "Your DemandPoint Professional subscription is now active.",
      subscription: serializeSubscription(subscription),
      payment: {
        reference: payment.reference,
        amountKobo: payment.amountKobo,
        currency: payment.currency,
        paidAt: payment.paidAt,
      },
    });
  } catch (error) {
    console.error("Verify subscription payment error:", error);

    return res
      .status(error?.status >= 400 && error?.status < 500 ? error.status : 500)
      .json({
        success: false,
        message: error?.message || "Unable to verify subscription payment.",
      });
  }
};

// POST /api/subscriptions/webhook/paystack
exports.handlePaystackWebhook = async (req, res) => {
  const signature = req.headers["x-paystack-signature"];

  try {
    const isValidSignature = verifyPaystackSignature(req.body, signature);

    if (!isValidSignature) {
      console.warn("Rejected Paystack webhook with invalid signature.");

      return res.status(401).json({
        success: false,
        message: "Invalid webhook signature.",
      });
    }

    const event = req.body;

    if (!event?.event || !event?.data) {
      return res.status(400).json({
        success: false,
        message: "Invalid Paystack webhook payload.",
      });
    }

    const reference = getReference(event.data);
    const subscriptionCode = getSubscriptionCode(event.data);
    const customerCode = getCustomerCode(event.data);

    const uniqueSource =
      reference ||
      subscriptionCode ||
      event.data?.invoice_code ||
      event.data?.id ||
      customerCode ||
      crypto
        .createHash("sha256")
        .update(JSON.stringify(event.data))
        .digest("hex");

    const eventKey = `${event.event}:${uniqueSource}`;

    let webhookEvent;

    try {
      webhookEvent = await PaystackWebhookEvent.create({
        eventKey,
        eventType: event.event,
        domain: event.data?.domain || null,
        reference,
        subscriptionCode,
        customerCode,
        status: "received",
        payload: event,
      });
    } catch (error) {
      if (error?.code === 11000) {
        return res.status(200).json({
          success: true,
          duplicate: true,
          message: "Webhook event was already received.",
        });
      }

      throw error;
    }

    webhookEvent.status = "processing";
    webhookEvent.attempts += 1;
    webhookEvent.lastAttemptAt = new Date();

    await webhookEvent.save();

    try {
      const result = await processPaystackSubscriptionEvent(event);

      webhookEvent.status = result.handled ? "processed" : "ignored";
      webhookEvent.processedAt = new Date();
      webhookEvent.failureReason = result.handled
        ? null
        : result.reason || "Event was not handled.";

      await webhookEvent.save();

      return res.status(200).json({
        success: true,
        processed: result.handled,
      });
    } catch (processingError) {
      webhookEvent.status = "failed";
      webhookEvent.failureReason =
        processingError?.message || "Webhook processing failed.";

      await webhookEvent.save().catch((saveError) => {
        console.error("Save failed webhook event error:", saveError);
      });

      console.error("Paystack webhook processing error:", processingError);

      /*
       * Return a non-200 response so Paystack retries events that failed
       * because of temporary database or application errors.
       */
      return res.status(500).json({
        success: false,
        message: "Webhook processing failed.",
      });
    }
  } catch (error) {
    console.error("Paystack webhook error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to process Paystack webhook.",
    });
  }
};

// PATCH /api/subscriptions/cancel-renewal
exports.cancelAutomaticRenewal = async (req, res) => {
  try {
    if (req.user.role !== "artisan") {
      return res.status(403).json({
        success: false,
        message: "Only artisan accounts have subscriptions.",
      });
    }

    const subscription = await getOrCreateArtisanSubscription(req.user._id);

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: "Subscription not found.",
      });
    }

    /*
     * Trial users have not yet created a paid recurring subscription
     * with Paystack, so there is nothing to cancel.
     */
    if (
      subscription.status === "trialing" &&
      !subscription.paystackSubscriptionCode
    ) {
      subscription.autoRenew = false;

      await subscription.save();

      return res.status(200).json({
        success: true,
        message: "Automatic renewal is not enabled during your free trial.",
        subscription: serializeSubscription(subscription),
      });
    }

    if (!subscription.autoRenew) {
      return res.status(200).json({
        success: true,
        alreadyCancelled: true,
        message: "Automatic renewal is already disabled.",
        subscription: serializeSubscription(subscription),
      });
    }

    if (
      !subscription.paystackSubscriptionCode ||
      !subscription.paystackEmailToken
    ) {
      return res.status(409).json({
        success: false,
        code: "PAYSTACK_SUBSCRIPTION_DETAILS_MISSING",
        message:
          "We could not find the Paystack subscription information required to cancel renewal. Please contact support.",
      });
    }

    await disableSubscription({
      code: subscription.paystackSubscriptionCode,
      token: subscription.paystackEmailToken,
    });

    /*
     * Do not immediately expire or cancel access.
     * The artisan remains active through the paid period.
     */
    subscription.autoRenew = false;
    subscription.providerStatus = "non-renewing";
    subscription.cancelledAt = new Date();
    subscription.webhookUpdatedAt = new Date();

    await subscription.save();

    return res.status(200).json({
      success: true,
      message:
        "Automatic renewal has been cancelled. Your subscription will remain active until the end of the current billing period.",
      subscription: serializeSubscription(subscription),
    });
  } catch (error) {
    console.error("Cancel subscription renewal error:", error);

    const status =
      Number.isInteger(error?.status) && error.status >= 400
        ? error.status
        : 500;

    return res.status(status).json({
      success: false,
      message:
        status === 500
          ? "Unable to cancel automatic renewal. Please try again."
          : error.message,
    });
  }
};
