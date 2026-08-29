const crypto = require("crypto");

const Order = require("../models/Order");
const Cart = require("../models/Cart");
const Product = require("../models/Product");
const VendorProfile = require("../models/VendorProfile");

const {
  getOrCreateArtisanSubscription,
} = require("../services/subscriptionService");

const { getSubscriptionAccess } = require("../utils/subscriptionStatus");

// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function getProductPriceKobo(product) {
  const priceKobo = Number(product?.priceKobo);

  if (!Number.isInteger(priceKobo) || priceKobo < 0) {
    const error = new Error(
      `Product "${product?.title || "Unknown"}" has an invalid price.`,
    );

    error.status = 409;
    error.code = "INVALID_PRODUCT_PRICE";

    throw error;
  }

  return priceKobo;
}

function generateOrderNumber() {
  const timestamp = Date.now().toString(36).toUpperCase();

  const random = crypto.randomBytes(4).toString("hex").toUpperCase();

  return `DP-${timestamp}-${random}`;
}

function normalizeShippingAddress(input = {}) {
  return {
    recipientName: String(input.recipientName || "").trim(),
    phone: String(input.phone || "").trim(),
    address: String(input.address || "").trim(),
    city: String(input.city || "").trim(),
    state: String(input.state || "").trim(),
    postalCode: String(input.postalCode || "").trim(),
    country: String(input.country || "Nigeria").trim(),
    deliveryNotes: String(input.deliveryNotes || "").trim(),
  };
}

function validateShippingAddress(shippingAddress) {
  const requiredFields = [
    ["recipientName", "Recipient name"],
    ["phone", "Phone number"],
    ["address", "Delivery address"],
    ["city", "City"],
    ["state", "State"],
  ];

  for (const [field, label] of requiredFields) {
    if (!shippingAddress[field]) {
      const error = new Error(`${label} is required.`);
      error.status = 400;
      error.code = "SHIPPING_ADDRESS_REQUIRED";
      throw error;
    }
  }
}

async function validateVendorForCheckout(vendorId) {
  const vendor = await VendorProfile.findById(vendorId);

  if (!vendor) {
    const error = new Error(
      "One of the sellers in your cart is no longer available.",
    );

    error.status = 409;
    error.code = "VENDOR_UNAVAILABLE";

    throw error;
  }

  if (!vendor.onboardingCompleted || vendor.status !== "active") {
    const error = new Error(
      `${vendor.storeName} is not currently accepting marketplace orders.`,
    );

    error.status = 409;
    error.code = "VENDOR_NOT_ACTIVE";

    throw error;
  }

  const subscription = await getOrCreateArtisanSubscription(vendor.user);

  const access = getSubscriptionAccess(subscription);

  if (!access.canSellProducts) {
    const error = new Error(
      `${vendor.storeName} is temporarily unavailable for marketplace sales.`,
    );

    error.status = 409;
    error.code = "SELLER_ACCESS_INACTIVE";

    throw error;
  }

  return vendor;
}

async function getFreshProduct(productId) {
  const product = await Product.findById(productId);

  if (!product) {
    const error = new Error(
      "One of the products in your cart no longer exists.",
    );

    error.status = 409;
    error.code = "PRODUCT_NOT_FOUND";

    throw error;
  }

  if (product.status !== "active") {
    const error = new Error(
      `"${product.title}" is no longer available for purchase.`,
    );

    error.status = 409;
    error.code = "PRODUCT_NOT_ACTIVE";

    throw error;
  }

  if (Number(product.stock || 0) <= 0) {
    const error = new Error(`"${product.title}" is currently out of stock.`);

    error.status = 409;
    error.code = "PRODUCT_OUT_OF_STOCK";

    throw error;
  }

  return product;
}

function sendControllerError(res, error) {
  console.error("Order error:", error);

  return res.status(error.status || 500).json({
    success: false,
    code: error.code || "ORDER_ERROR",
    message: error.message || "Unable to process your order.",
  });
}

// ------------------------------------------------------------
// CREATE CHECKOUT ORDER
// ------------------------------------------------------------

exports.createOrder = async (req, res) => {
  try {
    const cart = await Cart.findOne({
      user: req.user._id,
    });

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({
        success: false,
        code: "CART_EMPTY",
        message: "Your cart is empty.",
      });
    }

    // --------------------------------------------------------
    // SHIPPING
    // --------------------------------------------------------

    const shippingAddress = normalizeShippingAddress(req.body?.shippingAddress);

    validateShippingAddress(shippingAddress);

    // --------------------------------------------------------
    // FRESH PRODUCT VALIDATION
    // --------------------------------------------------------

    const orderItems = [];
    const vendorMap = new Map();

    for (const cartItem of cart.items) {
      const product = await getFreshProduct(cartItem.product);

      const quantity = Number(cartItem.quantity);

      if (!Number.isInteger(quantity) || quantity < 1) {
        const error = new Error(`Invalid quantity for "${product.title}".`);

        error.status = 400;
        error.code = "INVALID_QUANTITY";

        throw error;
      }

      if (quantity > product.stock) {
        const error = new Error(
          product.stock === 1
            ? `"${product.title}" only has 1 unit available.`
            : `"${product.title}" only has ${product.stock} units available.`,
        );

        error.status = 409;
        error.code = "INSUFFICIENT_STOCK";
        error.availableStock = product.stock;

        throw error;
      }

      // IMPORTANT:
      // We intentionally do NOT trust cartItem.price or
      // cartItem.priceKobo here.
      //
      // Product.priceKobo is the source of truth.

      const unitPriceKobo = getProductPriceKobo(product);

      const lineTotalKobo = unitPriceKobo * quantity;

      const vendor = await validateVendorForCheckout(product.vendor);

      const image =
        product.images?.[0]?.url ||
        (typeof product.images?.[0] === "string" ? product.images[0] : "");

      const item = {
        product: product._id,
        vendor: vendor._id,
        title: product.title,
        image,
        quantity,
        unitPriceKobo,
        lineTotalKobo,

        // Compatibility
        price: unitPriceKobo / 100,
      };

      orderItems.push(item);

      // ------------------------------------------------------
      // GROUP ITEMS BY VENDOR
      // ------------------------------------------------------

      const vendorKey = vendor._id.toString();

      if (!vendorMap.has(vendorKey)) {
        vendorMap.set(vendorKey, {
          vendor: vendor._id,
          storeName: vendor.storeName,
          items: [],
          subtotalKobo: 0,
        });
      }

      const vendorOrder = vendorMap.get(vendorKey);

      vendorOrder.items.push(item);
      vendorOrder.subtotalKobo += lineTotalKobo;
    }

    // --------------------------------------------------------
    // TOTALS
    // --------------------------------------------------------

    const subtotalKobo = orderItems.reduce(
      (sum, item) => sum + item.lineTotalKobo,
      0,
    );

    /*
     * Delivery pricing is intentionally not invented yet.
     *
     * Later this will come from our delivery/logistics layer.
     */
    const deliveryFeeKobo = 0;

    const totalKobo = subtotalKobo + deliveryFeeKobo;

    if (totalKobo <= 0) {
      return res.status(400).json({
        success: false,
        code: "INVALID_ORDER_TOTAL",
        message: "Your order total must be greater than zero.",
      });
    }

    const vendorOrders = Array.from(vendorMap.values()).map((vendorOrder) => ({
      vendor: vendorOrder.vendor,
      storeName: vendorOrder.storeName,
      items: vendorOrder.items,
      subtotalKobo: vendorOrder.subtotalKobo,
      status: "pending",
    }));

    // --------------------------------------------------------
    // CREATE PENDING ORDER
    // --------------------------------------------------------

    const order = await Order.create({
      user: req.user._id,

      orderNumber: generateOrderNumber(),

      items: orderItems,

      vendorOrders,

      subtotalKobo,
      deliveryFeeKobo,
      totalKobo,

      // Compatibility with old code.
      totalAmount: totalKobo / 100,

      currency: "NGN",

      status: "pending_payment",

      paymentStatus: "pending",

      paymentProvider: "paystack",

      settlementStatus: "not_ready",

      shippingAddress,

      /*
       * Give the pending checkout a limited lifetime.
       * We'll use this later to handle abandoned checkouts.
       */
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    // --------------------------------------------------------
    // IMPORTANT
    // --------------------------------------------------------
    //
    // DO NOT CLEAR THE CART HERE.
    //
    // The customer has only created a pending order.
    // We clear purchased items only after Paystack confirms
    // successful payment.
    //
    // --------------------------------------------------------

    const populatedOrder = await Order.findById(order._id)
      .populate("items.product")
      .populate("items.vendor")
      .populate("vendorOrders.vendor");

    return res.status(201).json({
      success: true,
      message: "Checkout created successfully.",
      order: populatedOrder,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

// ------------------------------------------------------------
// GET USER ORDERS
// ------------------------------------------------------------

exports.getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({
      user: req.user._id,
    })
      .populate("items.product")
      .populate("vendorOrders.vendor")
      .sort({ createdAt: -1 });

    return res.json({
      success: true,
      orders,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

// ------------------------------------------------------------
// GET SINGLE ORDER
// ------------------------------------------------------------

exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("items.product")
      .populate("items.vendor")
      .populate("vendorOrders.vendor");

    if (!order) {
      return res.status(404).json({
        success: false,
        code: "ORDER_NOT_FOUND",
        message: "Order not found.",
      });
    }

    if (order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        code: "UNAUTHORIZED",
        message: "You are not authorized to view this order.",
      });
    }

    return res.json({
      success: true,
      order,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};

// ------------------------------------------------------------
// INITIALIZE PAYMENT
// ------------------------------------------------------------

exports.initializePayment = async (req, res) => {
  try {
    const { id } = req.params;

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        code: "ORDER_NOT_FOUND",
        message: "Order not found.",
      });
    }

    if (order.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        code: "UNAUTHORIZED",
        message: "You are not authorized to pay for this order.",
      });
    }

    if (order.paymentStatus === "paid") {
      return res.status(400).json({
        success: false,
        code: "ORDER_ALREADY_PAID",
        message: "This order has already been paid for.",
      });
    }

    if (order.status !== "pending_payment") {
      return res.status(400).json({
        success: false,
        code: "ORDER_NOT_PAYABLE",
        message: "This order is no longer available for payment.",
      });
    }

    if (order.expiresAt && order.expiresAt < new Date()) {
      order.status = "cancelled";
      order.paymentStatus = "abandoned";

      await order.save();

      return res.status(410).json({
        success: false,
        code: "ORDER_EXPIRED",
        message: "This checkout session has expired.",
      });
    }

    if (!order.totalKobo || order.totalKobo <= 0) {
      return res.status(400).json({
        success: false,
        code: "INVALID_ORDER_TOTAL",
        message: "Invalid order amount.",
      });
    }

    if (!req.user.email) {
      return res.status(400).json({
        success: false,
        code: "EMAIL_REQUIRED",
        message: "Your account must have an email address to make payment.",
      });
    }

    const reference = `${order.orderNumber}-${Date.now()}`;

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

    const callbackUrl = `${frontendUrl}/checkout/payment?order=${order._id}`;

    const response = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: req.user.email,
          amount: String(order.totalKobo),
          currency: "NGN",
          reference,
          callback_url: callbackUrl,
          metadata: {
            orderId: order._id.toString(),
            orderNumber: order.orderNumber,
          },
        }),
      },
    );

    const data = await response.json();

    if (!response.ok || !data?.status) {
      console.error("Paystack initialization failed:", data);

      return res.status(502).json({
        success: false,
        code: "PAYMENT_INITIALIZATION_FAILED",
        message: data?.message || "Unable to initialize payment with Paystack.",
      });
    }

    order.paymentReference = data.data.reference;
    order.authorizationUrl = data.data.authorization_url;
    order.accessCode = data.data.access_code;
    order.paymentStatus = "pending";
    order.paymentProvider = "paystack";

    await order.save();

    return res.json({
      success: true,
      message: "Payment initialized successfully.",
      payment: {
        authorizationUrl: data.data.authorization_url,
        accessCode: data.data.access_code,
        reference: data.data.reference,
      },
      order,
    });
  } catch (error) {
    return sendControllerError(res, error);
  }
};
