const express = require("express");
const router = express.Router();

const {
  createProduct,
  getProducts,
  getProductById,
  updateProduct,
  deleteProduct,
} = require("../controllers/productController");

const { protect, vendorOnly } = require("../middleware/authMiddleware");

// PUBLIC
router.get("/", getProducts);
router.get("/:id", getProductById);

// PRIVATE (vendor)
router.post("/", protect, vendorOnly, createProduct);
router.put("/:id", protect, vendorOnly, updateProduct);
router.delete("/:id", protect, vendorOnly, deleteProduct);

module.exports = router;
