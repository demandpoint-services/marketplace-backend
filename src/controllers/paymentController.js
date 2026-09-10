const mongoose = require("mongoose");

const Order = require("../models/Order");

const { initializeTransaction, verifyTransaction } = require("../services/paystackService");

const { fulfillPaidOrder } = require("../services/orderFulfillmentService");

function createHttpError(message, status = 400, code = null) {
  const error = new Error(message);

  error.status = status;

  if (code) {
    error.code = code;
  }

  return error;
}

function generatePaymentReference(order) {
  const cleanOrderNumber = String(order.orderNumber || order._id).replace(/[^a-zA-Z0-9]/g, "");

  return `DP-${cleanOrderNumber}-${Date.now()}`;
}

function getFrontendUrl() {
  return String(
    process.env.FRONTEND_URL ||
      (process.env.NODE_ENV === "production"
        ? "https://www.demandpoint.app"
        : "http://localhost:3000")
  ).replace(/\/$/, "");
}

function getUserEmail(req) {
  return String(req.user?.email || "").trim();
}

/**
 * POST /api/payments/initialize
 *
 * Body:
 * {
 *   orderId: "..."
 * }
 */
exports.initializeOrderPayment = async (req, res) => {
  try {
    const { orderId } = req.body || {};

    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      throw createHttpError("A valid order ID is required.", 400, "INVALID_ORDER_ID");
    }

    const order = await Order.findOne({
      _id: orderId,
      user: req.user._id,
    });

    if (!order) {
      throw createHttpError("Order not found.", 404, "ORDER_NOT_FOUND");
    }

    /*
     * If payment was already verified, do not initialize
     * another Paystack transaction.
     */
    if (order.paymentStatus === "paid" || order.status === "paid" || order.paidAt) {
      return res.status(200).json({
        success: true,

        alreadyPaid: true,

        message: "This order has already been paid.",

        order,
      });
    }

    if (order.status === "cancelled") {
      throw createHttpError("This order has been cancelled.", 409, "ORDER_CANCELLED");
    }

    if (order.expiresAt && new Date(order.expiresAt).getTime() < Date.now()) {
      throw createHttpError(
        "This checkout has expired. Please create a new order.",
        409,
        "ORDER_EXPIRED"
      );
    }

    const amountKobo = Number(order.totalKobo);

    if (!Number.isInteger(amountKobo) || amountKobo <= 0) {
      throw createHttpError("The order total is invalid.", 409, "INVALID_ORDER_TOTAL");
    }

    const email = getUserEmail(req);

    if (!email) {
      throw createHttpError(
        "Your account does not have a valid email address.",
        409,
        "CUSTOMER_EMAIL_MISSING"
      );
    }

    /*
     * Reuse an existing Paystack checkout session where possible.
     *
     * This prevents customers repeatedly clicking the payment
     * button from creating unnecessary Paystack transactions.
     */
    if (order.paymentReference && order.authorizationUrl && order.paymentStatus === "pending") {
      return res.status(200).json({
        success: true,

        payment: {
          reference: order.paymentReference,

          authorizationUrl: order.authorizationUrl,

          accessCode: order.accessCode || "",

          amountKobo: Number(order.paymentAmountKobo || amountKobo),

          currency: order.currency || "NGN",
        },

        order,
      });
    }

    const reference = generatePaymentReference(order);

    const callbackUrl = `${getFrontendUrl()}/checkout/payment/verify`;

    const paystackResponse = await initializeTransaction({
      email,

      amountKobo,

      reference,

      callbackUrl,

      metadata: {
        type: "marketplace_order",

        orderId: order._id.toString(),

        orderNumber: order.orderNumber || order._id.toString(),

        customerId: req.user._id.toString(),
      },
    });

    const authorizationUrl = paystackResponse?.data?.authorization_url;

    const accessCode = paystackResponse?.data?.access_code;

    const returnedReference = paystackResponse?.data?.reference || reference;

    if (!authorizationUrl) {
      throw createHttpError(
        "Paystack did not return a checkout URL.",
        502,
        "PAYSTACK_CHECKOUT_URL_MISSING"
      );
    }

    order.paymentProvider = "paystack";
    order.paymentStatus = "pending";

    order.paymentReference = returnedReference;

    order.authorizationUrl = authorizationUrl;

    order.accessCode = accessCode || "";

    /*
     * Snapshot the amount DemandPoint asked Paystack to charge.
     *
     * Paystack can later charge slightly more if customer-paid
     * transaction fees are enabled, so verification checks that
     * the amount paid is AT LEAST this amount.
     */
    order.paymentAmountKobo = amountKobo;

    await order.save();

    return res.status(200).json({
      success: true,

      payment: {
        reference: returnedReference,

        authorizationUrl,

        accessCode: accessCode || "",

        amountKobo,

        currency: order.currency || "NGN",
      },

      order,
    });
  } catch (error) {
    console.error("Initialize marketplace payment error:", error);

    const status =
      Number.isInteger(error?.status) && error.status >= 400 && error.status < 600
        ? error.status
        : 500;

    return res.status(status).json({
      success: false,

      code:
        error?.code ||
        (status === 500 ? "PAYMENT_INITIALIZATION_FAILED" : "PAYMENT_INITIALIZATION_ERROR"),

      message: status === 500 ? "Unable to initialize payment at the moment." : error.message,
    });
  }
};

/**
 * GET /api/payments/verify/:reference
 */
exports.verifyOrderPayment = async (req, res) => {
  try {
    const reference = String(req.params.reference || "").trim();

    if (!reference) {
      throw createHttpError("Payment reference is required.", 400, "PAYMENT_REFERENCE_REQUIRED");
    }

    const order = await Order.findOne({
      paymentReference: reference,

      user: req.user._id,
    });

    if (!order) {
      throw createHttpError(
        "Order for this payment was not found.",
        404,
        "PAYMENT_ORDER_NOT_FOUND"
      );
    }

    /*
     * Payment may already have been verified while fulfilment
     * did not finish, for example:
     *
     * - server crash
     * - temporary database problem
     * - previous fulfilment failure
     *
     * Do not simply return here.
     *
     * Run fulfilment again. The fulfilment service is idempotent
     * and will not deduct stock twice.
     */
    if (order.paymentStatus === "paid" && order.paidAt) {
      const fulfillment = await fulfillPaidOrder({
        orderId: order._id,

        userId: req.user._id,
      });

      const fulfilledOrder = fulfillment.order || (await Order.findById(order._id));

      return res.status(200).json({
        success: true,

        alreadyVerified: true,

        alreadyFulfilled: Boolean(fulfillment.alreadyFulfilled),

        message: fulfillment.alreadyFulfilled
          ? "Payment and order fulfilment were already completed."
          : "Payment was already verified and order fulfilment has now completed.",

        order: fulfilledOrder,
      });
    }

    /*
     * Ask Paystack for the authoritative transaction result.
     */
    const paystackResponse = await verifyTransaction(reference);

    const transaction = paystackResponse?.data;

    if (!transaction) {
      throw createHttpError(
        "Paystack did not return transaction details.",
        502,
        "PAYSTACK_TRANSACTION_MISSING"
      );
    }

    /*
     * Make sure Paystack verified the exact transaction
     * associated with this order.
     */
    if (String(transaction.reference || "") !== reference) {
      throw createHttpError(
        "Payment reference verification failed.",
        409,
        "PAYMENT_REFERENCE_MISMATCH"
      );
    }

    /*
     * Payment must actually be successful.
     */
    if (transaction.status !== "success") {
      order.paymentStatus = transaction.status === "abandoned" ? "abandoned" : "failed";

      order.paymentFailureReason =
        transaction.gateway_response ||
        transaction.message ||
        `Payment status: ${transaction.status}`;

      order.paymentVerifiedAt = new Date();

      await order.save();

      throw createHttpError("Payment was not successful.", 409, "PAYMENT_NOT_SUCCESSFUL");
    }

    /*
     * Compare Paystack's amount against the amount DemandPoint
     * sent during transaction initialization.
     */
    const expectedAmountKobo = Number(order.paymentAmountKobo || order.totalKobo);

    const paidAmountKobo = Number(transaction.amount);

    console.log("PAYMENT AMOUNT VERIFICATION", {
      reference,

      orderId: order._id.toString(),

      subtotalKobo: order.subtotalKobo,

      deliveryFeeKobo: order.deliveryFeeKobo,

      totalKobo: order.totalKobo,

      paymentAmountKobo: order.paymentAmountKobo,

      expectedAmountKobo,

      paidAmountKobo,

      paystackAmount: transaction.amount,

      paystackFees: transaction.fees,

      currency: transaction.currency,
    });

    /*
     * Paystack may charge MORE than DemandPoint's amount when
     * "pass transaction fees to customer" is enabled.
     *
     * Therefore:
     *
     * paid >= expected  → acceptable
     * paid < expected   → reject
     */
    if (!Number.isInteger(paidAmountKobo) || paidAmountKobo < expectedAmountKobo) {
      order.paymentStatus = "failed";

      order.paymentFailureReason = `Payment amount is insufficient. Expected at least ${expectedAmountKobo} kobo, received ${paidAmountKobo} kobo.`;

      order.paymentVerifiedAt = new Date();

      await order.save();

      throw createHttpError(
        "The amount paid is less than the order total.",
        409,
        "PAYMENT_AMOUNT_MISMATCH"
      );
    }

    /*
     * Currency must also match.
     */
    if (
      String(transaction.currency || "").toUpperCase() !==
      String(order.currency || "NGN").toUpperCase()
    ) {
      /*
       * Do not change the payment status to "failed" here.
       *
       * Paystack has reported a successful transaction, but
       * there is a financial integrity problem that requires
       * investigation.
       */
      order.paymentFailureReason = `Payment currency mismatch. Expected ${
        order.currency || "NGN"
      }, received ${transaction.currency || "unknown"}.`;

      order.paymentVerifiedAt = new Date();

      await order.save();

      throw createHttpError(
        "Payment currency does not match the order currency.",
        409,
        "PAYMENT_CURRENCY_MISMATCH"
      );
    }

    /*
     * --------------------------------------------------------
     * PAYMENT CONFIRMED
     * --------------------------------------------------------
     *
     * From this point onward Paystack has established that
     * actual money was received successfully.
     *
     * Payment truth is persisted BEFORE fulfilment.
     *
     * If fulfilment later fails:
     *
     * paymentStatus = paid
     * fulfillmentStatus = failed
     *
     * That is financially correct.
     */

    const paidAt = transaction.paid_at ? new Date(transaction.paid_at) : new Date();

    order.paymentStatus = "paid";

    order.status = "paid";

    order.transactionId = transaction.id != null ? String(transaction.id) : "";

    order.paymentChannel = transaction.channel || "";

    /*
     * Keep paymentAmountKobo as the exact amount DemandPoint sent to
     * Paystack during initialization. Store the actual amount reported
     * by Paystack separately because customer-paid transaction fees can
     * make it greater than the order total.
     */
    order.amountPaidKobo = paidAmountKobo;

    order.paidAt = paidAt;

    order.paymentVerifiedAt = new Date();

    order.paymentFailureReason = "";

    /*
     * Vendor settlement is a later process.
     */
    order.settlementStatus = "not_ready";

    await order.save();

    /*
     * --------------------------------------------------------
     * ORDER FULFILMENT
     * --------------------------------------------------------
     *
     * This transactional service performs:
     *
     * - inventory deduction
     * - totalSold increment
     * - cart cleanup
     * - fulfilment completion
     *
     * It is safe to call repeatedly.
     */
    const fulfillment = await fulfillPaidOrder({
      orderId: order._id,

      userId: req.user._id,
    });

    const fulfilledOrder = fulfillment.order || (await Order.findById(order._id));

    return res.status(200).json({
      success: true,

      alreadyVerified: false,

      alreadyFulfilled: Boolean(fulfillment.alreadyFulfilled),

      message: fulfillment.alreadyFulfilled
        ? "Payment verified successfully. Order fulfilment had already been completed."
        : "Payment verified and order fulfilled successfully.",

      order: fulfilledOrder,
    });
  } catch (error) {
    console.error("Verify marketplace payment error:", error);

    const status =
      Number.isInteger(error?.status) && error.status >= 400 && error.status < 600
        ? error.status
        : 500;

    return res.status(status).json({
      success: false,

      code:
        error?.code ||
        (status === 500 ? "PAYMENT_VERIFICATION_FAILED" : "PAYMENT_VERIFICATION_ERROR"),

      message: status === 500 ? "Unable to verify payment at the moment." : error.message,
    });
  }
};
