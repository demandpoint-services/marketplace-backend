const crypto = require("crypto");

const Order = require("../models/Order");

const { fulfillPaidOrder } = require("../services/orderFulfillmentService");

function getPaystackSecretKey() {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;

  if (!secretKey) {
    throw new Error("PAYSTACK_SECRET_KEY is not configured.");
  }

  return secretKey;
}

function isValidPaystackSignature(req) {
  const signature = req.headers["x-paystack-signature"];

  if (!signature) {
    return false;
  }

  const hash = crypto
    .createHmac("sha512", getPaystackSecretKey())
    .update(JSON.stringify(req.body))
    .digest("hex");

  const expectedBuffer = Buffer.from(hash);

  const signatureBuffer = Buffer.from(String(signature));

  if (expectedBuffer.length !== signatureBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}

function normalizeMetadata(metadata) {
  if (!metadata) {
    return {};
  }

  if (typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata;
  }

  if (typeof metadata === "string") {
    try {
      const parsed = JSON.parse(metadata);

      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      return {};
    }
  }

  return {};
}

/**
 * POST /api/payments/webhook/paystack
 *
 * Public endpoint.
 *
 * DO NOT protect this route with JWT middleware.
 * Paystack calls it directly from their servers.
 */
exports.handlePaystackWebhook = async (req, res) => {
  try {
    /*
     * Verify that the request genuinely came from Paystack.
     */
    if (!isValidPaystackSignature(req)) {
      console.warn("Rejected invalid Paystack webhook signature.");

      return res.status(401).json({
        success: false,
        message: "Invalid webhook signature.",
      });
    }

    const event = req.body;

    /*
     * Acknowledge events we don't currently care about.
     *
     * Paystack may send subscription, transfer and other
     * event types to the same webhook URL.
     */
    if (!event || event.event !== "charge.success") {
      return res.status(200).json({
        success: true,
        ignored: true,
      });
    }

    const transaction = event.data || {};

    const reference = String(transaction.reference || "").trim();

    if (!reference) {
      console.warn("Paystack charge.success webhook missing reference.");

      return res.status(200).json({
        success: true,
        ignored: true,
      });
    }

    const metadata = normalizeMetadata(transaction.metadata);

    /*
     * DemandPoint also uses Paystack for subscriptions.
     *
     * We must not let marketplace fulfilment process a
     * subscription charge.success event.
     */
    if (metadata.type !== "marketplace_order") {
      return res.status(200).json({
        success: true,
        ignored: true,
      });
    }

    /*
     * Locate using paymentReference first.
     *
     * orderId from metadata is an additional consistency check,
     * not the sole source of truth.
     */
    const order = await Order.findOne({
      paymentReference: reference,
    });

    if (!order) {
      console.warn("Marketplace order not found for Paystack webhook:", {
        reference,
        metadataOrderId: metadata.orderId || null,
      });

      /*
       * Return 200 so Paystack doesn't continuously retry
       * an event that DemandPoint cannot associate.
       *
       * We log it for investigation.
       */
      return res.status(200).json({
        success: true,
        ignored: true,
      });
    }

    /*
     * Additional metadata integrity check.
     */
    if (metadata.orderId && String(metadata.orderId) !== order._id.toString()) {
      console.error("Paystack webhook order metadata mismatch:", {
        reference,

        expectedOrderId: order._id.toString(),

        receivedOrderId: metadata.orderId,
      });

      return res.status(200).json({
        success: true,
        ignored: true,
      });
    }

    /*
     * Paystack says this is charge.success, but still verify
     * important transaction fields before fulfilling.
     */
    if (transaction.status !== "success") {
      return res.status(200).json({
        success: true,
        ignored: true,
      });
    }

    const expectedAmountKobo = Number(order.paymentAmountKobo || order.totalKobo);

    const paidAmountKobo = Number(transaction.amount);

    if (!Number.isInteger(paidAmountKobo) || paidAmountKobo < expectedAmountKobo) {
      console.error("Paystack webhook amount mismatch:", {
        reference,
        orderId: order._id.toString(),
        expectedAmountKobo,
        paidAmountKobo,
      });

      /*
       * Do not mark the order paid.
       *
       * The event is acknowledged but logged for investigation.
       */
      return res.status(200).json({
        success: true,
        ignored: true,
      });
    }

    const expectedCurrency = String(order.currency || "NGN").toUpperCase();

    const receivedCurrency = String(transaction.currency || "").toUpperCase();

    if (receivedCurrency !== expectedCurrency) {
      console.error("Paystack webhook currency mismatch:", {
        reference,
        expectedCurrency,
        receivedCurrency,
      });

      return res.status(200).json({
        success: true,
        ignored: true,
      });
    }

    /*
     * If the browser callback already marked payment as paid,
     * don't rewrite the financial timestamps unnecessarily.
     *
     * We still call fulfilment below because fulfilment may not
     * have completed.
     */
    if (order.paymentStatus !== "paid" || !order.paidAt) {
      order.paymentStatus = "paid";

      order.status = "paid";

      order.transactionId = transaction.id != null ? String(transaction.id) : "";

      order.paymentChannel = transaction.channel || "";

      order.paymentAmountKobo = paidAmountKobo;

      order.paidAt = transaction.paid_at ? new Date(transaction.paid_at) : new Date();

      order.paymentVerifiedAt = new Date();

      order.paymentFailureReason = "";

      order.settlementStatus = "not_ready";

      await order.save();
    }

    /*
     * Safe to call whether:
     *
     * - webhook arrives first
     * - browser callback arrives first
     * - Paystack retries the webhook
     *
     * fulfilPaidOrder() is idempotent.
     */
    const fulfillment = await fulfillPaidOrder({
      orderId: order._id,
    });

    console.log("Paystack marketplace webhook processed:", {
      reference,

      orderId: order._id.toString(),

      alreadyFulfilled: Boolean(fulfillment.alreadyFulfilled),
    });

    return res.status(200).json({
      success: true,
    });
  } catch (error) {
    console.error("Paystack marketplace webhook error:", error);

    /*
     * Returning 500 is intentional here.
     *
     * For a genuine transient backend/database failure we WANT
     * Paystack to retry the event.
     */
    return res.status(500).json({
      success: false,
      message: "Webhook processing failed.",
    });
  }
};
