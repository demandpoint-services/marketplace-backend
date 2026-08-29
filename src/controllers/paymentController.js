const mongoose = require("mongoose");

const Order = require("../models/Order");
const Cart = require("../models/Cart");
const Product = require("../models/Product");

const {
  initializeTransaction,
  verifyTransaction,
} = require("../services/paystackService");

function createHttpError(message, status = 400, code = null) {
  const error = new Error(message);

  error.status = status;

  if (code) {
    error.code = code;
  }

  return error;
}

function generatePaymentReference(order) {
  const cleanOrderNumber = String(order.orderNumber || order._id).replace(
    /[^a-zA-Z0-9]/g,
    "",
  );

  return `DP-${cleanOrderNumber}-${Date.now()}`;
}

function getFrontendUrl() {
  return String(
    process.env.FRONTEND_URL ||
      (process.env.NODE_ENV === "production"
        ? "https://demandpoint.app"
        : "http://localhost:3000"),
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
      throw createHttpError(
        "A valid order ID is required.",
        400,
        "INVALID_ORDER_ID",
      );
    }

    const order = await Order.findOne({
      _id: orderId,
      user: req.user._id,
    });

    if (!order) {
      throw createHttpError("Order not found.", 404, "ORDER_NOT_FOUND");
    }

    /*
     * Never initialize another payment for an already-paid order.
     */
    if (
      order.paymentStatus === "paid" ||
      order.status === "paid" ||
      order.paidAt
    ) {
      return res.status(200).json({
        success: true,
        alreadyPaid: true,
        message: "This order has already been paid.",
        order,
      });
    }

    if (order.status === "cancelled") {
      throw createHttpError(
        "This order has been cancelled.",
        409,
        "ORDER_CANCELLED",
      );
    }

    if (order.expiresAt && new Date(order.expiresAt).getTime() < Date.now()) {
      throw createHttpError(
        "This checkout has expired. Please create a new order.",
        409,
        "ORDER_EXPIRED",
      );
    }

    const amountKobo = Number(order.totalKobo);

    if (!Number.isInteger(amountKobo) || amountKobo <= 0) {
      throw createHttpError(
        "The order total is invalid.",
        409,
        "INVALID_ORDER_TOTAL",
      );
    }

    const email = getUserEmail(req);

    if (!email) {
      throw createHttpError(
        "Your account does not have a valid email address.",
        409,
        "CUSTOMER_EMAIL_MISSING",
      );
    }

    /*
     * If Paystack has already returned a checkout URL for this
     * pending order, reuse it instead of creating unnecessary
     * duplicate transactions.
     */
    if (
      order.paymentReference &&
      order.authorizationUrl &&
      order.paymentStatus === "pending"
    ) {
      return res.status(200).json({
        success: true,

        payment: {
          reference: order.paymentReference,
          authorizationUrl: order.authorizationUrl,
          accessCode: order.accessCode || "",
          amountKobo,
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
        "PAYSTACK_CHECKOUT_URL_MISSING",
      );
    }

    order.paymentProvider = "paystack";
    order.paymentStatus = "pending";
    order.paymentReference = returnedReference;
    order.authorizationUrl = authorizationUrl;
    order.accessCode = accessCode || "";

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
      Number.isInteger(error?.status) &&
      error.status >= 400 &&
      error.status < 600
        ? error.status
        : 500;

    return res.status(status).json({
      success: false,

      code:
        error?.code ||
        (status === 500
          ? "PAYMENT_INITIALIZATION_FAILED"
          : "PAYMENT_INITIALIZATION_ERROR"),

      message:
        status === 500
          ? "Unable to initialize payment at the moment."
          : error.message,
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
      throw createHttpError(
        "Payment reference is required.",
        400,
        "PAYMENT_REFERENCE_REQUIRED",
      );
    }

    const order = await Order.findOne({
      paymentReference: reference,
      user: req.user._id,
    });

    if (!order) {
      throw createHttpError(
        "Order for this payment was not found.",
        404,
        "PAYMENT_ORDER_NOT_FOUND",
      );
    }

    /*
     * Idempotency:
     * refreshing the verification page must not decrement stock
     * or clear the cart twice.
     */
    if (order.paymentStatus === "paid" && order.paidAt) {
      return res.status(200).json({
        success: true,
        alreadyVerified: true,
        message: "Payment has already been verified.",
        order,
      });
    }

    const paystackResponse = await verifyTransaction(reference);

    const transaction = paystackResponse?.data;

    if (!transaction) {
      throw createHttpError(
        "Paystack did not return transaction details.",
        502,
        "PAYSTACK_TRANSACTION_MISSING",
      );
    }

    if (transaction.reference !== reference) {
      throw createHttpError(
        "Payment reference verification failed.",
        409,
        "PAYMENT_REFERENCE_MISMATCH",
      );
    }

    if (transaction.status !== "success") {
      order.paymentStatus =
        transaction.status === "abandoned" ? "abandoned" : "failed";

      order.paymentFailureReason =
        transaction.gateway_response ||
        transaction.message ||
        `Payment status: ${transaction.status}`;

      order.paymentVerifiedAt = new Date();

      await order.save();

      throw createHttpError(
        "Payment was not successful.",
        409,
        "PAYMENT_NOT_SUCCESSFUL",
      );
    }

    const expectedAmountKobo = Number(order.totalKobo);

    const paidAmountKobo = Number(transaction.amount);

    /*
     * Never fulfil an order if the customer paid a different
     * amount from the server-calculated order total.
     */
    if (
      !Number.isInteger(paidAmountKobo) ||
      paidAmountKobo !== expectedAmountKobo
    ) {
      order.paymentStatus = "failed";

      order.paymentFailureReason =
        "The amount paid does not match the order total.";

      order.paymentVerifiedAt = new Date();

      await order.save();

      throw createHttpError(
        "The amount paid does not match the order total.",
        409,
        "PAYMENT_AMOUNT_MISMATCH",
      );
    }

    if (
      String(transaction.currency || "").toUpperCase() !==
      String(order.currency || "NGN").toUpperCase()
    ) {
      throw createHttpError(
        "Payment currency does not match the order currency.",
        409,
        "PAYMENT_CURRENCY_MISMATCH",
      );
    }

    /*
     * Check stock one final time before fulfilment.
     *
     * Phase 5 can improve this further using MongoDB transactions
     * and inventory reservations.
     */
    for (const item of order.items) {
      const product = await Product.findById(item.product);

      if (!product) {
        throw createHttpError(
          `${item.title} is no longer available.`,
          409,
          "PRODUCT_NOT_FOUND_AFTER_PAYMENT",
        );
      }

      if (Number(product.stock) < Number(item.quantity)) {
        throw createHttpError(
          `There is no longer enough stock for ${item.title}.`,
          409,
          "INSUFFICIENT_STOCK_AFTER_PAYMENT",
        );
      }
    }

    /*
     * Reduce stock only after Paystack verification succeeds.
     */
    for (const item of order.items) {
      const result = await Product.updateOne(
        {
          _id: item.product,
          stock: {
            $gte: Number(item.quantity),
          },
        },
        {
          $inc: {
            stock: -Number(item.quantity),
            totalSold: Number(item.quantity),
          },
        },
      );

      if (result.modifiedCount !== 1) {
        throw createHttpError(
          `Unable to reserve stock for ${item.title}.`,
          409,
          "STOCK_UPDATE_FAILED",
        );
      }
    }

    const paidAt = transaction.paid_at
      ? new Date(transaction.paid_at)
      : new Date();

    order.paymentStatus = "paid";
    order.status = "paid";

    order.transactionId = transaction.id != null ? String(transaction.id) : "";

    order.paymentChannel = transaction.channel || "";

    order.paymentAmountKobo = paidAmountKobo;

    order.paidAt = paidAt;

    order.paymentVerifiedAt = new Date();

    order.paymentFailureReason = "";

    /*
     * Order is now financially successful.
     * Settlement still happens later.
     */
    order.settlementStatus = "not_ready";

    await order.save();

    /*
     * Remove ONLY products purchased in this order.
     *
     * If the customer added something else to the cart while
     * completing Paystack checkout, that newer item remains.
     */
    const purchasedProductIds = order.items.map((item) =>
      item.product.toString(),
    );

    await Cart.updateOne(
      {
        user: req.user._id,
      },
      {
        $pull: {
          items: {
            product: {
              $in: purchasedProductIds,
            },
          },
        },
      },
    );

    return res.status(200).json({
      success: true,

      message: "Payment verified successfully.",

      order,
    });
  } catch (error) {
    console.error("Verify marketplace payment error:", error);

    const status =
      Number.isInteger(error?.status) &&
      error.status >= 400 &&
      error.status < 600
        ? error.status
        : 500;

    return res.status(status).json({
      success: false,

      code:
        error?.code ||
        (status === 500
          ? "PAYMENT_VERIFICATION_FAILED"
          : "PAYMENT_VERIFICATION_ERROR"),

      message:
        status === 500
          ? "Unable to verify payment at the moment."
          : error.message,
    });
  }
};
