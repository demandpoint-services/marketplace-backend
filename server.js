const express = require("express");
const cors = require("cors");
require("dotenv").config();
const connectDB = require("./src/config/db");
const {
  startSubscriptionMaintenanceScheduler,
} = require("./src/services/subscriptionMaintenanceScheduler");

const authRoutes = require("./src/routes/authRoutes");
const artisanRoutes = require("./src/routes/artisanRoutes");
const bookingRoutes = require("./src/routes/bookingRoutes");
const portfolioRoutes = require("./src/routes/portfolioRoutes");
const messageRoutes = require("./src/routes/messageRoutes");
const reviewRoutes = require("./src/routes/reviewRoutes");

// MARKETPLACE ROUTES
const productRoutes = require("./src/routes/productRoutes");
const cartRoutes = require("./src/routes/cartRoutes");
const orderRoutes = require("./src/routes/orderRoutes");
const userRoutes = require("./src/routes/userRoutes");

const notificationRoutes = require("./src/routes/notificationRoutes");
const subscriptionRoutes = require("./src/routes/subscriptionRoutes");

const app = express();

const allowedOrigins = [
  "http://localhost:3000",
  "https://demandpointmarketplace.vercel.app",
  "https://demandpoint.app",
  "https://www.demandpoint.app",
];

// MongoDB is connected during server bootstrap below.

app.set("trust proxy", 1);

// Middleware
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }),
);
app.use(express.json());

// Core API Routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/artisans", artisanRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/products", productRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/portfolio", portfolioRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/subscriptions", subscriptionRoutes);

// Test route
app.get("/", (req, res) => {
  res.send("Demand Point Backend Running...");
});

const PORT = process.env.PORT || 5000;

async function startServer() {
  await connectDB();

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startSubscriptionMaintenanceScheduler();
  });
}

startServer().catch((error) => {
  console.error("Server startup failed:", error);
  process.exit(1);
});
