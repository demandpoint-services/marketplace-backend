const mongoose = require("mongoose");

const Order = require("../models/Order");
const Product = require("../models/Product");
const Cart = require("../models/Cart");

function createFulfillmentError(message, status = 409, code = "ORDER_FULFILLMENT_FAILED") {
  const error = new Error(message);

  error.status = status;
  error.code = code;

  return error;
}

/**
 * Fulfil a successfully paid marketplace order.
 *
 * IMPORTANT:
 *
 * This service does NOT decide whether a Paystack payment
 * is valid. Payment verification belongs in paymentController.
 *
 * This service is only responsible for the transactional
 * post-payment fulfilment work:
 *
 * - deduct inventory
 * - increment totalSold
 * - clean purchased items from cart
 * - mark fulfilment complete
 *
 * All of those operations happen in ONE MongoDB transaction.
 */
async function fulfillPaidOrder({ orderId, userId = null }) {
  if (!orderId) {
    throw createFulfillmentError("Order ID is required for fulfilment.", 400, "ORDER_ID_REQUIRED");
  }

  const session = await mongoose.startSession();

  let fulfilledOrder = null;
  let alreadyFulfilled = false;

  try {
    await session.withTransaction(async () => {
      const query = {
        _id: orderId,
      };

      /*
       * Browser-based fulfilment can additionally enforce
       * ownership.
       *
       * Later, Paystack webhooks can call this same service
       * without userId because the webhook is server-to-server.
       */
      if (userId) {
        query.user = userId;
      }

      const order = await Order.findOne(query).session(session);

      if (!order) {
        throw createFulfillmentError("Order not found.", 404, "ORDER_NOT_FOUND");
      }

      /*
       * Financial truth must already be established before
       * fulfilment begins.
       */
      if (order.paymentStatus !== "paid" || !order.paidAt) {
        throw createFulfillmentError(
          "This order has not been confirmed as paid.",
          409,
          "ORDER_NOT_PAID"
        );
      }

      /*
       * Idempotency.
       *
       * Refreshing the callback page, receiving the same
       * webhook twice, or retrying a request must not reduce
       * stock twice.
       */
      if (order.fulfillmentStatus === "fulfilled" && order.fulfilledAt) {
        alreadyFulfilled = true;
        fulfilledOrder = order;

        return;
      }

      order.fulfillmentStatus = "processing";
      order.fulfillmentStartedAt = order.fulfillmentStartedAt || new Date();

      order.fulfillmentFailedAt = null;
      order.fulfillmentError = "";

      await order.save({
        session,
      });

      if (!Array.isArray(order.items) || order.items.length === 0) {
        throw createFulfillmentError(
          "The order does not contain any products.",
          409,
          "ORDER_ITEMS_EMPTY"
        );
      }

      /*
       * Inventory updates are conditional:
       *
       * stock >= quantity
       *
       * This prevents stock from becoming negative even if
       * inventory changed between checkout and payment.
       */
      for (const item of order.items) {
        const quantity = Number(item.quantity);

        if (!Number.isInteger(quantity) || quantity < 1) {
          throw createFulfillmentError(
            `Invalid quantity for ${item.title}.`,
            409,
            "INVALID_ORDER_ITEM_QUANTITY"
          );
        }

        const product = await Product.findById(item.product)
          .select("_id title stock totalSold")
          .session(session);

        if (!product) {
          throw createFulfillmentError(
            `${item.title} is no longer available.`,
            409,
            "PRODUCT_NOT_FOUND_AFTER_PAYMENT"
          );
        }

        if (Number(product.stock) < quantity) {
          throw createFulfillmentError(
            `There is no longer enough stock for ${item.title}.`,
            409,
            "INSUFFICIENT_STOCK_AFTER_PAYMENT"
          );
        }

        const stockResult = await Product.updateOne(
          {
            _id: item.product,

            stock: {
              $gte: quantity,
            },
          },
          {
            $inc: {
              stock: -quantity,
              totalSold: quantity,
            },
          },
          {
            session,
          }
        );

        if (stockResult.modifiedCount !== 1) {
          throw createFulfillmentError(
            `Unable to allocate stock for ${item.title}.`,
            409,
            "STOCK_UPDATE_FAILED"
          );
        }
      }

      /*
       * Remove ONLY products purchased by this order.
       *
       * Products added to the customer's cart after checkout
       * remain untouched.
       */
      const purchasedProductIds = order.items.map((item) => item.product);

      await Cart.updateOne(
        {
          user: order.user,
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
        {
          session,
        }
      );

      /*
       * Fulfilment successfully completed.
       */
      order.fulfillmentStatus = "fulfilled";
      order.fulfilledAt = new Date();
      order.fulfillmentFailedAt = null;
      order.fulfillmentError = "";

      await order.save({
        session,
      });

      fulfilledOrder = order;
    });

    return {
      success: true,
      alreadyFulfilled,
      order: fulfilledOrder,
    };
  } catch (error) {
    /*
     * The transaction has already rolled back at this point.
     *
     * Therefore:
     *
     * - no partial stock deductions survive
     * - no partial cart cleanup survives
     *
     * We record the fulfilment failure separately OUTSIDE the
     * transaction so support/admin systems can see that payment
     * succeeded but fulfilment needs attention.
     */
    try {
      await Order.updateOne(
        {
          _id: orderId,

          fulfillmentStatus: {
            $ne: "fulfilled",
          },
        },
        {
          $set: {
            fulfillmentStatus: "failed",
            fulfillmentFailedAt: new Date(),

            fulfillmentError: String(error?.message || "Order fulfilment failed.").slice(0, 1000),
          },
        }
      );
    } catch (recordError) {
      console.error("Unable to record fulfilment failure:", recordError);
    }

    throw error;
  } finally {
    await session.endSession();
  }
}

module.exports = {
  fulfillPaidOrder,
};
