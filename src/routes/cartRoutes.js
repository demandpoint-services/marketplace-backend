const express = require("express");

const router = express.Router();

const {
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart,
} = require("../controllers/cartController");

const { protect } = require("../middleware/authMiddleware");

router.get("/", protect, getCart);

router.post("/add", protect, addToCart);

router.patch("/items/:productId", protect, updateCartItem);

router.delete("/items/:productId", protect, removeFromCart);

router.delete("/clear", protect, clearCart);

/*
 * Temporary compatibility with the
 * previous frontend.
 */
router.post("/remove", protect, removeFromCart);

module.exports = router;
