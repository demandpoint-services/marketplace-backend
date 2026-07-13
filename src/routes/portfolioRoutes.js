const express = require("express");

const {
  getMyPortfolio,
  getArtisanPortfolio,
  createPortfolioItem,
  updatePortfolioItem,
  deletePortfolioItem,
} = require("../controllers/portfolioController");

const { protect, artisanOnly } = require("../middleware/authMiddleware");

const router = express.Router();

// Public: view an artisan's portfolio
router.get("/artisan/:artisanId", getArtisanPortfolio);

// Protected artisan routes
router.get("/", protect, artisanOnly, getMyPortfolio);
router.post("/", protect, artisanOnly, createPortfolioItem);
router.patch("/:id", protect, artisanOnly, updatePortfolioItem);
router.delete("/:id", protect, artisanOnly, deletePortfolioItem);

module.exports = router;
