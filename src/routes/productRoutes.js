const express = require("express");

const router = express.Router();

const {
  createProduct,
  getProducts,
  getProductById,
  getMyProducts,
  getMyProductById,
  updateProduct,
  deleteProduct,
} = require("../controllers/productController");

const { protect, artisanOnly } = require("../middleware/authMiddleware");

const requireVendorProfile = require("../middleware/requireVendorProfile");

const requireVendorSellingAccess = require("../middleware/requireVendorSellingAccess");

// ------------------------------------------------------------
// Vendor catalogue
// ------------------------------------------------------------

router.get(
  "/vendor/me",
  protect,
  artisanOnly,
  requireVendorProfile,
  getMyProducts,
);

router.get(
  "/vendor/me/:id",
  protect,
  artisanOnly,
  requireVendorProfile,
  getMyProductById,
);

router.post(
  "/",
  protect,
  artisanOnly,
  requireVendorSellingAccess,
  createProduct,
);

router.patch(
  "/:id",
  protect,
  artisanOnly,
  requireVendorSellingAccess,
  updateProduct,
);

router.delete(
  "/:id",
  protect,
  artisanOnly,
  requireVendorSellingAccess,
  deleteProduct,
);

// ------------------------------------------------------------
// Public marketplace
// ------------------------------------------------------------

router.get("/", getProducts);

router.get("/:id", getProductById);

module.exports = router;
