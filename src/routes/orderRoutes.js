const express = require("express");

const router = express.Router();

const {
  createOrder,
  getMyOrders,
  getOrderById,
  initializePayment,
} = require("../controllers/orderController");

const { protect } = require("../middleware/authMiddleware");

// Create a pending checkout order
router.post("/checkout", protect, createOrder);

// Initialize Paystack payment
router.post("/:id/pay", protect, initializePayment);

// Customer orders
router.get("/my", protect, getMyOrders);

// Single customer order
router.get("/:id", protect, getOrderById);

module.exports = router;
