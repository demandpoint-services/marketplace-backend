const Order = require("../models/Order");

const { fulfillPaidOrder } = require("./orderFulfillmentService");

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

      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return {};
    }
  }

  return {};
}

function isMarketplaceOrderEvent(event) {
  if (!event?.data) {
    return false;
  }

  const metadata = normalizeMetadata(event.data.metadata);

  return metadata.type === "marketplace_order";
}

async function processMarketplaceOrderEvent(event) {
  if (!event?.event || !event?.data) {
    return {
      handled: false,
      reason: "Invalid marketplace webhook event.",
    };
  }

  /*
   * Marketplace fulfilment currently only needs successful
   * Paystack charges.
   */
  if (event.event !== "charge.success") {
    return {
      handled: false,
      reason: `Unsupported marketplace event type: ${event.event}`,
    };
  }

  const transaction = event.data;

  const reference = String(transaction.reference || "").trim();

  if (!reference) {
    return {
      handled: false,
      reason: "Marketplace payment webhook has no transaction reference.",
    };
  }

  const metadata = normalizeMetadata(transaction.metadata);

  if (metadata.type !== "marketplace_order") {
    return {
      handled: false,
      reason: "The payment is not a marketplace order.",
    };
  }

  const order = await Order.findOne({
    paymentReference: reference,
  });

  if (!order) {
    throw Object.assign(
      new Error(`Marketplace order not found for payment reference ${reference}.`),
      {
        code: "MARKETPLACE_ORDER_NOT_FOUND",
      }
    );
  }

  /*
   * Metadata is an additional integrity check.
   */
  if (metadata.orderId && String(metadata.orderId) !== order._id.toString()) {
    throw Object.assign(new Error("Marketplace payment metadata does not match the order."), {
      code: "MARKETPLACE_ORDER_METADATA_MISMATCH",
    });
  }

  if (String(transaction.status || "") !== "success") {
    return {
      handled: false,
      reason: "Marketplace payment was not successful.",
    };
  }

  const expectedAmountKobo = Number(order.paymentAmountKobo || order.totalKobo);

  const paidAmountKobo = Number(transaction.amount);

  if (!Number.isInteger(expectedAmountKobo) || expectedAmountKobo <= 0) {
    throw Object.assign(
      new Error("The marketplace order has an invalid expected payment amount."),
      {
        code: "INVALID_EXPECTED_PAYMENT_AMOUNT",
      }
    );
  }

  /*
   * DemandPoint currently passes Paystack processing fees
   * to customers.
   *
   * Therefore Paystack may report an amount greater than the
   * original order amount.
   *
   * Reject only when the amount actually paid is insufficient.
   */
  if (!Number.isInteger(paidAmountKobo) || paidAmountKobo < expectedAmountKobo) {
    throw Object.assign(
      new Error(
        `Marketplace payment amount mismatch. Expected at least ${expectedAmountKobo} kobo, received ${paidAmountKobo} kobo.`
      ),
      {
        code: "MARKETPLACE_PAYMENT_AMOUNT_MISMATCH",
      }
    );
  }

  const expectedCurrency = String(order.currency || "NGN").toUpperCase();

  const receivedCurrency = String(transaction.currency || "").toUpperCase();

  if (receivedCurrency !== expectedCurrency) {
    throw Object.assign(
      new Error(
        `Marketplace payment currency mismatch. Expected ${expectedCurrency}, received ${
          receivedCurrency || "unknown"
        }.`
      ),
      {
        code: "MARKETPLACE_PAYMENT_CURRENCY_MISMATCH",
      }
    );
  }

  /*
   * Financial truth.
   *
   * Only write these values if another callback/webhook has
   * not already established that this order was paid.
   */
  if (order.paymentStatus !== "paid" || !order.paidAt) {
    order.paymentStatus = "paid";
    order.status = "paid";

    order.transactionId = transaction.id != null ? String(transaction.id) : "";

    order.paymentChannel = transaction.channel || "";

    /*
     * Preserve paymentAmountKobo as the amount DemandPoint requested
     * during initialization. Store Paystack's actual charged amount
     * separately because it can include customer-paid processing fees.
     */
    order.amountPaidKobo = paidAmountKobo;

    order.paidAt = transaction.paid_at ? new Date(transaction.paid_at) : new Date();

    order.paymentVerifiedAt = new Date();

    order.paymentFailureReason = "";

    order.settlementStatus = "not_ready";

    await order.save();
  }

  /*
   * Shared idempotent fulfilment service.
   *
   * It is safe if:
   * - browser callback already fulfilled
   * - webhook arrives first
   * - Paystack sends webhook again
   */
  const fulfillment = await fulfillPaidOrder({
    orderId: order._id,
  });

  return {
    handled: true,

    orderId: order._id,

    reference,

    alreadyFulfilled: Boolean(fulfillment.alreadyFulfilled),
  };
}

module.exports = {
  normalizeMetadata,
  isMarketplaceOrderEvent,
  processMarketplaceOrderEvent,
};
