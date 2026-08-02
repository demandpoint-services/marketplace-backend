const express = require("express");

const {
  getMyPortfolio,
  getArtisanPortfolio,
  createPortfolioItem,
  updatePortfolioItem,
  deletePortfolioItem,
} = require("../controllers/portfolioController");

const { protect, artisanOnly } = require("../middleware/authMiddleware");
const requireActiveSubscription = require("../middleware/requireActiveSubscription");

const router = express.Router();

/*
 * Public portfolio route.
 * The controller will verify marketplace visibility.
 */
router.get("/artisan/:artisanId", getArtisanPortfolio);

/*
 * Artisans can still view their own stored portfolio after expiry,
 * but write operations require an active trial or paid subscription.
 */
router.get("/", protect, artisanOnly, getMyPortfolio);

router.post(
  "/",
  protect,
  artisanOnly,
  requireActiveSubscription,
  createPortfolioItem,
);

router.patch(
  "/:id",
  protect,
  artisanOnly,
  requireActiveSubscription,
  updatePortfolioItem,
);

router.delete(
  "/:id",
  protect,
  artisanOnly,
  requireActiveSubscription,
  deletePortfolioItem,
);

module.exports = router;
