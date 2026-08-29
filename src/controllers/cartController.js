const Cart = require("../models/Cart");
const Product = require("../models/Product");
const VendorProfile = require("../models/VendorProfile");

const {
  getOrCreateArtisanSubscription,
} = require("../services/subscriptionService");

const { getSubscriptionAccess } = require("../utils/subscriptionStatus");

function normalizeQuantity(value, fallback = 1) {
  const quantity = Number(value ?? fallback);

  if (!Number.isInteger(quantity) || quantity < 1) {
    return null;
  }

  return quantity;
}

function getProductPriceKobo(product) {
  if (Number.isInteger(product?.priceKobo) && product.priceKobo >= 0) {
    return product.priceKobo;
  }

  const price = Number(product?.price || 0);

  if (!Number.isFinite(price) || price < 0) {
    return 0;
  }

  return Math.round(price * 100);
}

function getProductPriceNaira(product) {
  return getProductPriceKobo(product) / 100;
}

async function validateProductForCart(productId) {
  const product = await Product.findById(productId);

  if (!product) {
    const error = new Error("Product not found.");
    error.status = 404;
    error.code = "PRODUCT_NOT_FOUND";
    throw error;
  }

  if (product.status !== "active") {
    const error = new Error(
      "This product is not currently available for purchase.",
    );
    error.status = 409;
    error.code = "PRODUCT_NOT_ACTIVE";
    throw error;
  }

  if (Number(product.stock || 0) <= 0) {
    const error = new Error("This product is currently out of stock.");
    error.status = 409;
    error.code = "PRODUCT_OUT_OF_STOCK";
    throw error;
  }

  const vendor = await VendorProfile.findById(product.vendor);

  if (!vendor) {
    const error = new Error("This seller is no longer available.");
    error.status = 409;
    error.code = "VENDOR_UNAVAILABLE";
    throw error;
  }

  if (!vendor.onboardingCompleted || vendor.status !== "active") {
    const error = new Error(
      "This seller is not currently accepting marketplace orders.",
    );
    error.status = 409;
    error.code = "VENDOR_NOT_ACTIVE";
    throw error;
  }

  const subscription = await getOrCreateArtisanSubscription(vendor.user);

  const access = getSubscriptionAccess(subscription);

  if (!access.canSellProducts) {
    const error = new Error("This seller is temporarily unavailable.");
    error.status = 409;
    error.code = "SELLER_ACCESS_INACTIVE";
    throw error;
  }

  return product;
}

async function getPopulatedCart(cartId) {
  return Cart.findById(cartId).populate({
    path: "items.product",
    populate: {
      path: "vendor",
      select: "storeName status city state businessAddress",
    },
  });
}

async function normalizeLegacyCartItems(cart) {
  if (!cart?.items?.length) {
    return;
  }

  for (const item of cart.items) {
    const missingPrice = item.price === undefined || item.price === null;

    const missingPriceKobo =
      item.priceKobo === undefined || item.priceKobo === null;

    if (!missingPrice && !missingPriceKobo) {
      continue;
    }

    const product = await Product.findById(item.product).select(
      "price priceKobo",
    );

    if (!product) {
      continue;
    }

    const priceKobo = getProductPriceKobo(product);

    item.priceKobo = priceKobo;
    item.price = priceKobo / 100;
  }
}

function sendControllerError(res, error) {
  console.error("Cart error:", error);

  return res.status(error.status || 500).json({
    success: false,
    code: error.code || "CART_ERROR",
    message: error.message || "Unable to process your cart.",
  });
}

// ------------------------------------------------------------
// GET CART
// ------------------------------------------------------------

exports.getCart = async (req, res) => {
  try {
    const cart = await Cart.findOne({
      user: req.user._id,
    }).populate({
      path: "items.product",
      populate: {
        path: "vendor",
        select: "storeName status city state businessAddress",
      },
    });

    if (!cart) {
      return res.json({
        user: req.user._id,
        items: [],
      });
    }

    return res.json(cart);
  } catch (error) {
    return sendControllerError(res, error);
  }
};

// ------------------------------------------------------------
// ADD TO CART
// ------------------------------------------------------------

exports.addToCart = async (req, res) => {
  try {
    const { productId } = req.body;

    const quantity = normalizeQuantity(req.body.quantity, 1);

    if (!productId) {
      return res.status(400).json({
        success: false,
        code: "PRODUCT_REQUIRED",
        message: "Product is required.",
      });
    }

    if (!quantity) {
      return res.status(400).json({
        success: false,
        code: "INVALID_QUANTITY",
        message: "Quantity must be a positive whole number.",
      });
    }

    // Validate product, stock, vendor and subscription access.
    const product = await validateProductForCart(productId);

    // Get existing cart or create a new one.
    let cart = await Cart.findOne({
      user: req.user._id,
    });

    if (!cart) {
      cart = new Cart({
        user: req.user._id,
        items: [],
      });
    } else {
      // Repair old cart items created before price snapshots
      // were introduced.
      await normalizeLegacyCartItems(cart);
    }

    const existingItem = cart.items.find(
      (item) => item.product.toString() === productId.toString(),
    );

    const requestedQuantity = existingItem
      ? existingItem.quantity + quantity
      : quantity;

    if (requestedQuantity > product.stock) {
      return res.status(409).json({
        success: false,
        code: "INSUFFICIENT_STOCK",
        message:
          product.stock === 1
            ? "Only 1 unit is currently available."
            : `Only ${product.stock} units are currently available.`,
        availableStock: product.stock,
      });
    }

    const priceKobo = getProductPriceKobo(product);
    const price = getProductPriceNaira(product);

    if (existingItem) {
      existingItem.quantity = requestedQuantity;
      existingItem.price = price;
      existingItem.priceKobo = priceKobo;
    } else {
      cart.items.push({
        product: product._id,
        quantity,
        price,
        priceKobo,
      });
    }

    await cart.save();

    const updatedCart = await getPopulatedCart(cart._id);

    return res.json(updatedCart);
  } catch (error) {
    return sendControllerError(res, error);
  }
};

// ------------------------------------------------------------
// UPDATE QUANTITY
// ------------------------------------------------------------

exports.updateCartItem = async (req, res) => {
  try {
    const { productId } = req.params;

    const quantity = normalizeQuantity(req.body.quantity);

    if (!quantity) {
      return res.status(400).json({
        success: false,
        code: "INVALID_QUANTITY",
        message: "Quantity must be a positive whole number.",
      });
    }

    const product = await validateProductForCart(productId);

    if (quantity > product.stock) {
      return res.status(409).json({
        success: false,
        code: "INSUFFICIENT_STOCK",
        message:
          product.stock === 1
            ? "Only 1 unit is currently available."
            : `Only ${product.stock} units are currently available.`,
        availableStock: product.stock,
      });
    }

    const cart = await Cart.findOne({
      user: req.user._id,
    });

    if (!cart) {
      return res.status(404).json({
        success: false,
        code: "CART_NOT_FOUND",
        message: "Cart not found.",
      });
    }

    // Repair any legacy items before saving the cart.
    await normalizeLegacyCartItems(cart);

    const item = cart.items.find(
      (entry) => entry.product.toString() === productId.toString(),
    );

    if (!item) {
      return res.status(404).json({
        success: false,
        code: "CART_ITEM_NOT_FOUND",
        message: "This product is not in your cart.",
      });
    }

    item.quantity = quantity;
    item.price = getProductPriceNaira(product);
    item.priceKobo = getProductPriceKobo(product);

    await cart.save();

    const updatedCart = await getPopulatedCart(cart._id);

    return res.json(updatedCart);
  } catch (error) {
    return sendControllerError(res, error);
  }
};

// ------------------------------------------------------------
// REMOVE ITEM
// ------------------------------------------------------------

exports.removeFromCart = async (req, res) => {
  try {
    const productId = req.params.productId || req.body.productId;

    const cart = await Cart.findOne({
      user: req.user._id,
    });

    if (!cart) {
      return res.json({
        user: req.user._id,
        items: [],
      });
    }

    await normalizeLegacyCartItems(cart);

    cart.items = cart.items.filter(
      (item) => item.product.toString() !== productId.toString(),
    );

    await cart.save();

    const updatedCart = await getPopulatedCart(cart._id);

    return res.json(updatedCart);
  } catch (error) {
    return sendControllerError(res, error);
  }
};

// ------------------------------------------------------------
// CLEAR CART
// ------------------------------------------------------------

exports.clearCart = async (req, res) => {
  try {
    let cart = await Cart.findOne({
      user: req.user._id,
    });

    if (!cart) {
      return res.json({
        user: req.user._id,
        items: [],
      });
    }

    cart.items = [];

    await cart.save();

    cart = await getPopulatedCart(cart._id);

    return res.json(cart);
  } catch (error) {
    return sendControllerError(res, error);
  }
};
