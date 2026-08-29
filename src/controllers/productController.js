const mongoose = require("mongoose");

const Product = require("../models/Product");
const VendorProfile = require("../models/VendorProfile");
const Subscription = require("../models/Subscription");

const { getSubscriptionAccess } = require("../utils/subscriptionStatus");

const ALLOWED_CATEGORIES = new Set([
  "fashion",
  "furniture",
  "electronics",
  "handmade",
  "art",
  "beauty",
  "home",
  "other",
]);

function normalizeImages(images = []) {
  if (!Array.isArray(images)) {
    return [];
  }

  return images
    .map((image) => {
      if (typeof image === "string") {
        return {
          url: image.trim(),
          publicId: "",
          alt: "",
        };
      }

      if (!image || typeof image !== "object") {
        return null;
      }

      const url = String(image.url || "").trim();

      if (!url) {
        return null;
      }

      return {
        url,
        publicId: String(image.publicId || "").trim(),
        alt: String(image.alt || "").trim(),
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeShipping(shipping = {}) {
  const requiresShipping =
    shipping.requiresShipping === undefined
      ? true
      : Boolean(shipping.requiresShipping);

  const weightKg = Number(shipping.weightKg || 0);

  const dimensions = shipping.dimensions || {};

  const lengthCm = Number(dimensions.lengthCm || 0);
  const widthCm = Number(dimensions.widthCm || 0);
  const heightCm = Number(dimensions.heightCm || 0);

  const values = {
    weightKg,
    lengthCm,
    widthCm,
    heightCm,
  };

  for (const [field, value] of Object.entries(values)) {
    if (!Number.isFinite(value) || value < 0) {
      const error = new Error(
        `${field} must be a valid number of zero or more.`,
      );

      error.status = 400;
      throw error;
    }
  }

  return {
    requiresShipping,

    weightKg,

    dimensions: {
      lengthCm,
      widthCm,
      heightCm,
    },
  };
}

function serializeProduct(product) {
  if (!product) return null;

  const plain =
    typeof product.toObject === "function"
      ? product.toObject({ virtuals: true })
      : product;

  return {
    ...plain,

    price: typeof plain.priceKobo === "number" ? plain.priceKobo / 100 : 0,

    isAvailable: plain.status === "active" && Number(plain.stock || 0) > 0,
  };
}

async function getPublicProductsQuery() {
  const activeVendors = await VendorProfile.find({
    status: "active",
    onboardingCompleted: true,
  }).select("_id user");

  if (!activeVendors.length) {
    return {
      vendor: {
        $in: [],
      },
    };
  }

  const userIds = activeVendors.map((vendor) => vendor.user);

  const subscriptions = await Subscription.find({
    user: {
      $in: userIds,
    },
  });

  const allowedUserIds = new Set(
    subscriptions
      .filter((subscription) => {
        const access = getSubscriptionAccess(subscription);

        return access.canSellProducts;
      })
      .map((subscription) => String(subscription.user)),
  );

  const allowedVendorIds = activeVendors
    .filter((vendor) => allowedUserIds.has(String(vendor.user)))
    .map((vendor) => vendor._id);

  return {
    vendor: {
      $in: allowedVendorIds,
    },
  };
}

// POST /api/products
exports.createProduct = async (req, res) => {
  try {
    const {
      title,
      description = "",
      category = "other",
      priceKobo,
      price,
      images = [],
      shipping = {},
      stock = 0,
      lowStockThreshold = 3,
      status = "active",
    } = req.body;

    const normalizedTitle = String(title || "").trim();

    if (!normalizedTitle) {
      return res.status(400).json({
        success: false,
        message: "Product title is required.",
      });
    }

    const normalizedCategory = String(category || "other")
      .trim()
      .toLowerCase();

    if (!ALLOWED_CATEGORIES.has(normalizedCategory)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product category.",
      });
    }

    let normalizedPriceKobo;

    if (priceKobo !== undefined) {
      normalizedPriceKobo = Number(priceKobo);
    } else if (price !== undefined) {
      normalizedPriceKobo = Math.round(Number(price) * 100);
    }

    if (!Number.isFinite(normalizedPriceKobo) || normalizedPriceKobo < 100) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid product price.",
      });
    }

    const normalizedStock = Number(stock);

    if (!Number.isInteger(normalizedStock) || normalizedStock < 0) {
      return res.status(400).json({
        success: false,
        message: "Product stock must be a whole number of zero or more.",
      });
    }

    const normalizedThreshold = Number(lowStockThreshold);

    if (!Number.isInteger(normalizedThreshold) || normalizedThreshold < 0) {
      return res.status(400).json({
        success: false,
        message: "Low-stock threshold must be zero or more.",
      });
    }

    const allowedStatuses = new Set(["draft", "active"]);

    const normalizedStatus = allowedStatuses.has(status) ? status : "draft";

    const product = await Product.create({
      vendor: req.vendor._id,

      title: normalizedTitle,

      description: String(description || "").trim(),

      category: normalizedCategory,

      priceKobo: normalizedPriceKobo,

      images: normalizeImages(images),

      shipping: normalizeShipping(shipping),

      stock: normalizedStock,

      lowStockThreshold: normalizedThreshold,

      status: normalizedStatus,
    });

    await VendorProfile.updateOne(
      {
        _id: req.vendor._id,
      },
      {
        $inc: {
          totalProducts: 1,
        },
      },
    );

    const populated = await Product.findById(product._id).populate({
      path: "vendor",
      select: "storeName storeLogo storeDescription city state status",
    });

    return res.status(201).json({
      success: true,
      message: "Product created successfully.",
      product: serializeProduct(populated),
    });
  } catch (error) {
    console.error("Create product error:", error);

    return res.status(500).json({
      success: false,
      message: error?.message || "Unable to create product.",
    });
  }
};

// GET /api/products/vendor/me
exports.getMyProducts = async (req, res) => {
  try {
    const products = await Product.find({
      vendor: req.vendor._id,
    }).sort({
      createdAt: -1,
    });

    return res.status(200).json({
      success: true,

      products: products.map(serializeProduct),
    });
  } catch (error) {
    console.error("Get vendor products error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve your products.",
    });
  }
};

// GET /api/products/vendor/me/:id
exports.getMyProductById = async (req, res) => {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      vendor: req.vendor._id,
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }

    return res.status(200).json({
      success: true,
      product: serializeProduct(product),
    });
  } catch (error) {
    console.error("Get vendor product error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve this product.",
    });
  }
};

// GET /api/products
exports.getProducts = async (req, res) => {
  try {
    const { category, search, vendor, sort = "newest" } = req.query;

    const publicVendorQuery = await getPublicProductsQuery();

    const query = {
      ...publicVendorQuery,

      status: "active",

      stock: {
        $gt: 0,
      },
    };

    if (category && category !== "all") {
      query.category = String(category).trim().toLowerCase();
    }

    if (vendor) {
      query.vendor = vendor;
    }

    if (search) {
      const escaped = String(search)
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      query.$or = [
        {
          title: {
            $regex: escaped,
            $options: "i",
          },
        },
        {
          description: {
            $regex: escaped,
            $options: "i",
          },
        },
      ];
    }

    let sortQuery = {
      createdAt: -1,
    };

    if (sort === "price_asc") {
      sortQuery = {
        priceKobo: 1,
      };
    }

    if (sort === "price_desc") {
      sortQuery = {
        priceKobo: -1,
      };
    }

    const products = await Product.find(query)
      .populate({
        path: "vendor",
        select: "storeName storeLogo city state status",
      })
      .sort(sortQuery);

    return res.status(200).json(products.map(serializeProduct));
  } catch (error) {
    console.error("Get products error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve products.",
    });
  }
};

// GET /api/products/:id
exports.getProductById = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }

    const publicVendorQuery = await getPublicProductsQuery();

    const product = await Product.findOne({
      _id: req.params.id,

      ...publicVendorQuery,

      status: "active",
    }).populate({
      path: "vendor",
      select: "storeName storeLogo storeDescription city state status",
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }

    return res.status(200).json(serializeProduct(product));
  } catch (error) {
    console.error("Get product error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve product.",
    });
  }
};

// PATCH /api/products/:id
exports.updateProduct = async (req, res) => {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      vendor: req.vendor._id,
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }

    if (req.body.title !== undefined) {
      const title = String(req.body.title || "").trim();

      if (!title) {
        return res.status(400).json({
          success: false,
          message: "Product title is required.",
        });
      }

      product.title = title;
    }

    if (req.body.description !== undefined) {
      product.description = String(req.body.description || "").trim();
    }

    if (req.body.category !== undefined) {
      const category = String(req.body.category).trim().toLowerCase();

      if (!ALLOWED_CATEGORIES.has(category)) {
        return res.status(400).json({
          success: false,
          message: "Invalid product category.",
        });
      }

      product.category = category;
    }

    if (req.body.priceKobo !== undefined || req.body.price !== undefined) {
      const nextPriceKobo =
        req.body.priceKobo !== undefined
          ? Number(req.body.priceKobo)
          : Math.round(Number(req.body.price) * 100);

      if (!Number.isFinite(nextPriceKobo) || nextPriceKobo < 100) {
        return res.status(400).json({
          success: false,
          message: "Enter a valid product price.",
        });
      }

      product.priceKobo = nextPriceKobo;
    }

    if (req.body.images !== undefined) {
      product.images = normalizeImages(req.body.images);
    }

    if (req.body.stock !== undefined) {
      const stock = Number(req.body.stock);

      if (!Number.isInteger(stock) || stock < 0) {
        return res.status(400).json({
          success: false,
          message: "Product stock must be a whole number of zero or more.",
        });
      }

      product.stock = stock;
    }

    if (req.body.lowStockThreshold !== undefined) {
      const threshold = Number(req.body.lowStockThreshold);

      if (!Number.isInteger(threshold) || threshold < 0) {
        return res.status(400).json({
          success: false,
          message: "Low-stock threshold must be zero or more.",
        });
      }

      product.lowStockThreshold = threshold;
    }

    if (req.body.status !== undefined) {
      const allowedStatuses = new Set(["draft", "active", "archived"]);

      if (!allowedStatuses.has(req.body.status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid product status.",
        });
      }

      product.status = req.body.status;

      product.archivedAt = req.body.status === "archived" ? new Date() : null;
    }

    if (req.body.shipping !== undefined) {
      product.shipping = normalizeShipping({
        requiresShipping:
          req.body.shipping.requiresShipping ??
          product.shipping?.requiresShipping ??
          true,

        weightKg: req.body.shipping.weightKg ?? product.shipping?.weightKg ?? 0,

        dimensions: {
          lengthCm:
            req.body.shipping.dimensions?.lengthCm ??
            product.shipping?.dimensions?.lengthCm ??
            0,

          widthCm:
            req.body.shipping.dimensions?.widthCm ??
            product.shipping?.dimensions?.widthCm ??
            0,

          heightCm:
            req.body.shipping.dimensions?.heightCm ??
            product.shipping?.dimensions?.heightCm ??
            0,
        },
      });
    }

    await product.save();

    const populated = await Product.findById(product._id).populate({
      path: "vendor",
      select: "storeName storeLogo city state status",
    });

    return res.status(200).json({
      success: true,

      message: "Product updated successfully.",

      product: serializeProduct(populated),
    });
  } catch (error) {
    console.error("Update product error:", error);

    return res.status(500).json({
      success: false,
      message: error?.message || "Unable to update product.",
    });
  }
};

// DELETE /api/products/:id
// Archive instead of physical deletion.
exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      vendor: req.vendor._id,
    });

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }

    if (product.status !== "archived") {
      product.status = "archived";
      product.archivedAt = new Date();

      await product.save();

      await VendorProfile.updateOne(
        {
          _id: req.vendor._id,
          totalProducts: {
            $gt: 0,
          },
        },
        {
          $inc: {
            totalProducts: -1,
          },
        },
      );
    }

    return res.status(200).json({
      success: true,
      message: "Product archived successfully.",
    });
  } catch (error) {
    console.error("Archive product error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to archive product.",
    });
  }
};
