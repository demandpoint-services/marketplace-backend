const Cart = require("../models/Cart");
const VendorProfile = require("../models/VendorProfile");

const { calculateShipping } = require("../services/logistics/logisticsService");

function createHttpError(message, status = 400, code = null) {
  const error = new Error(message);

  error.status = status;

  if (code) {
    error.code = code;
  }

  return error;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeDestination(destination = {}) {
  return {
    recipientName: normalizeText(destination.recipientName),
    phone: normalizeText(destination.phone),
    address: normalizeText(destination.address),
    city: normalizeText(destination.city),
    state: normalizeText(destination.state),
    postalCode: normalizeText(destination.postalCode),
    country: normalizeText(destination.country || "Nigeria"),
    deliveryNotes: normalizeText(destination.deliveryNotes),
  };
}

function validateDestination(destination) {
  if (!destination.recipientName) {
    throw createHttpError(
      "Recipient name is required.",
      400,
      "RECIPIENT_NAME_REQUIRED",
    );
  }

  if (!destination.phone) {
    throw createHttpError(
      "Recipient phone number is required.",
      400,
      "RECIPIENT_PHONE_REQUIRED",
    );
  }

  if (!destination.address) {
    throw createHttpError(
      "Delivery address is required.",
      400,
      "DELIVERY_ADDRESS_REQUIRED",
    );
  }

  if (!destination.city) {
    throw createHttpError(
      "Delivery city is required.",
      400,
      "DELIVERY_CITY_REQUIRED",
    );
  }

  if (!destination.state) {
    throw createHttpError(
      "Delivery state is required.",
      400,
      "DELIVERY_STATE_REQUIRED",
    );
  }
}

function getVendorPickupLocation(vendor) {
  const pickup = vendor.pickupLocation || {};

  /*
   * Phase 1 introduced pickupLocation, but older vendors may not
   * have it yet. Fall back to the existing business address fields
   * so existing DemandPoint vendors continue to work.
   */
  return {
    contactName:
      normalizeText(pickup.contactName) || normalizeText(vendor.storeName),

    phone: normalizeText(pickup.phone) || normalizeText(vendor.phone),

    address:
      normalizeText(pickup.address) || normalizeText(vendor.businessAddress),

    city: normalizeText(pickup.city) || normalizeText(vendor.city),

    state: normalizeText(pickup.state) || normalizeText(vendor.state),

    country: normalizeText(pickup.country) || "Nigeria",
  };
}

function validatePickupLocation(origin, storeName) {
  if (!origin.address) {
    throw createHttpError(
      `${storeName} does not have a pickup address configured.`,
      409,
      "VENDOR_PICKUP_ADDRESS_MISSING",
    );
  }

  if (!origin.city) {
    throw createHttpError(
      `${storeName} does not have a pickup city configured.`,
      409,
      "VENDOR_PICKUP_CITY_MISSING",
    );
  }

  if (!origin.state) {
    throw createHttpError(
      `${storeName} does not have a pickup state configured.`,
      409,
      "VENDOR_PICKUP_STATE_MISSING",
    );
  }
}

function getProductShippingData(product) {
  const shipping = product.shipping || {};
  const dimensions = shipping.dimensions || {};

  return {
    requiresShipping: shipping.requiresShipping !== false,

    weightKg: Number(shipping.weightKg || 0),

    dimensions: {
      lengthCm: Number(dimensions.lengthCm || 0),
      widthCm: Number(dimensions.widthCm || 0),
      heightCm: Number(dimensions.heightCm || 0),
    },
  };
}

function validateProductShipping(product, shipping) {
  if (!shipping.requiresShipping) {
    return;
  }

  if (!Number.isFinite(shipping.weightKg) || shipping.weightKg <= 0) {
    throw createHttpError(
      `${product.title} does not have a valid shipping weight.`,
      409,
      "PRODUCT_SHIPPING_WEIGHT_MISSING",
    );
  }

  const { lengthCm, widthCm, heightCm } = shipping.dimensions;

  if (
    !Number.isFinite(lengthCm) ||
    !Number.isFinite(widthCm) ||
    !Number.isFinite(heightCm) ||
    lengthCm <= 0 ||
    widthCm <= 0 ||
    heightCm <= 0
  ) {
    throw createHttpError(
      `${product.title} does not have complete package dimensions.`,
      409,
      "PRODUCT_SHIPPING_DIMENSIONS_MISSING",
    );
  }
}

function buildDestinationForProvider(destination) {
  return {
    address: destination.address,
    city: destination.city,
    state: destination.state,
    country: destination.country,
  };
}

/**
 * POST /api/shipping/quote
 *
 * Body:
 * {
 *   "destination": {
 *     "recipientName": "...",
 *     "phone": "...",
 *     "address": "...",
 *     "city": "...",
 *     "state": "...",
 *     "postalCode": "",
 *     "country": "Nigeria",
 *     "deliveryNotes": ""
 *   }
 * }
 *
 * The frontend does NOT submit product prices, weights,
 * vendor origins or shipping fees.
 *
 * All of those values are obtained from the database.
 */
exports.getShippingQuote = async (req, res) => {
  try {
    const destination = normalizeDestination(req.body?.destination || {});

    validateDestination(destination);

    /*
     * Populate the product because the database product is the
     * source of truth for shipping dimensions and weight.
     */
    const cart = await Cart.findOne({
      user: req.user._id,
    }).populate({
      path: "items.product",
      select: "title vendor status stock priceKobo shipping images",
    });

    if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) {
      throw createHttpError("Your cart is empty.", 400, "CART_EMPTY");
    }

    /*
     * Build vendor groups.
     *
     * One vendor = one origin shipment.
     *
     * Example:
     *
     * Vendor A → Customer
     *   Chair
     *   Table
     *
     * Vendor B → Customer
     *   Wig
     *
     * This results in TWO logistics quotes, not three.
     */
    const vendorGroups = new Map();

    for (const cartItem of cart.items) {
      const product = cartItem.product;

      if (!product) {
        throw createHttpError(
          "A product in your cart is no longer available.",
          409,
          "CART_PRODUCT_NOT_FOUND",
        );
      }

      if (product.status !== "active") {
        throw createHttpError(
          `${product.title} is no longer available for purchase.`,
          409,
          "PRODUCT_NOT_ACTIVE",
        );
      }

      const quantity = Number(cartItem.quantity);

      if (!Number.isInteger(quantity) || quantity < 1) {
        throw createHttpError(
          `Invalid quantity for ${product.title}.`,
          400,
          "INVALID_CART_QUANTITY",
        );
      }

      if (Number(product.stock) < quantity) {
        throw createHttpError(
          `Only ${product.stock} unit${
            Number(product.stock) === 1 ? "" : "s"
          } of ${product.title} ${
            Number(product.stock) === 1 ? "is" : "are"
          } currently available.`,
          409,
          "INSUFFICIENT_STOCK",
        );
      }

      if (!product.vendor) {
        throw createHttpError(
          `${product.title} does not have a valid vendor.`,
          409,
          "PRODUCT_VENDOR_MISSING",
        );
      }

      const shipping = getProductShippingData(product);

      /*
       * Digital/non-shippable products can eventually use:
       *
       * requiresShipping: false
       *
       * They are excluded from logistics calculations.
       */
      if (!shipping.requiresShipping) {
        continue;
      }

      validateProductShipping(product, shipping);

      const vendorId = product.vendor.toString();

      if (!vendorGroups.has(vendorId)) {
        vendorGroups.set(vendorId, {
          vendorId,
          items: [],
        });
      }

      vendorGroups.get(vendorId).items.push({
        productId: product._id.toString(),

        title: product.title,

        quantity,

        weightKg: shipping.weightKg,

        dimensions: shipping.dimensions,
      });
    }

    /*
     * If every cart item is non-shippable, shipping is free.
     */
    if (vendorGroups.size === 0) {
      return res.status(200).json({
        success: true,

        quote: {
          currency: "NGN",

          destination,

          shipments: [],

          deliveryFeeKobo: 0,

          requiresShipping: false,
        },
      });
    }

    const vendorIds = Array.from(vendorGroups.keys());

    /*
     * Fetch all vendor profiles in ONE query rather than making
     * one database query for every vendor in the cart.
     */
    const vendors = await VendorProfile.find({
      _id: {
        $in: vendorIds,
      },
    });

    const vendorMap = new Map(
      vendors.map((vendor) => [vendor._id.toString(), vendor]),
    );

    const shipments = [];

    let deliveryFeeKobo = 0;

    /*
     * We process each vendor shipment independently.
     *
     * Promise.all is intentionally avoided for the first version
     * so debugging provider failures is straightforward.
     *
     * We can parallelize provider requests later if ABC's API
     * supports that safely.
     */
    for (const [vendorId, group] of vendorGroups.entries()) {
      const vendor = vendorMap.get(vendorId);

      if (!vendor) {
        throw createHttpError(
          "A vendor in your cart is no longer available.",
          409,
          "VENDOR_NOT_FOUND",
        );
      }

      const storeName = normalizeText(vendor.storeName) || "Vendor";

      /*
       * If your VendorProfile uses a status/onboarding field,
       * your existing cart/order controllers remain responsible
       * for enforcing vendor eligibility.
       *
       * Here we focus specifically on logistics validity.
       */

      const origin = getVendorPickupLocation(vendor);

      validatePickupLocation(origin, storeName);

      const providerQuote = await calculateShipping({
        origin,

        destination: buildDestinationForProvider(destination),

        items: group.items,
      });

      const shippingFeeKobo = Number(providerQuote.shippingFeeKobo);

      deliveryFeeKobo += shippingFeeKobo;

      shipments.push({
        vendor: vendor._id,

        storeName,

        origin,

        destination: buildDestinationForProvider(destination),

        items: group.items,

        provider: providerQuote.provider,

        serviceType: providerQuote.serviceType,

        quoteReference: providerQuote.quoteReference,

        shippingFeeKobo,

        actualWeightKg: providerQuote.actualWeightKg,

        volumetricWeightKg: providerQuote.volumetricWeightKg,

        chargeableWeightKg: providerQuote.chargeableWeightKg,

        estimatedDeliveryDays: providerQuote.estimatedDeliveryDays,

        isMock: Boolean(providerQuote.isMock),
      });
    }

    return res.status(200).json({
      success: true,

      quote: {
        currency: "NGN",

        destination,

        shipments,

        deliveryFeeKobo,

        requiresShipping: true,

        provider: shipments.length === 1 ? shipments[0].provider : "multiple",
      },
    });
  } catch (error) {
    console.error("Shipping quote error:", error);

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
        (status === 500 ? "SHIPPING_QUOTE_FAILED" : "SHIPPING_QUOTE_ERROR"),

      message:
        status === 500
          ? "Unable to calculate delivery at the moment."
          : error.message,
    });
  }
};
