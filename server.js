const express = require("express");
const cors = require("cors");
require("dotenv").config();
const connectDB = require("./src/config/db");

const authRoutes = require("./src/routes/authRoutes");
const artisanRoutes = require("./src/routes/artisanRoutes");
const bookingRoutes = require("./src/routes/bookingRoutes");
const portfolioRoutes = require("./src/routes/portfolioRoutes");

// MARKETPLACE ROUTES
const productRoutes = require("./src/routes/productRoutes");
const cartRoutes = require("./src/routes/cartRoutes");
const orderRoutes = require("./src/routes/orderRoutes");
const userRoutes = require("./src/routes/userRoutes");

const notificationRoutes = require("./src/routes/notificationRoutes");

const app = express();

const allowedOrigins = [
  "http://localhost:3000",
  "https://demandpointmarketplace.vercel.app",
  "https://demandpoint.app",
  "https://www.demandpoint.app",
];

// Connect to MongoDB
connectDB();

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
app.use("/api/products", productRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/portfolio", portfolioRoutes);
app.use("/api/notifications", notificationRoutes);

// Test route
app.get("/", (req, res) => {
  res.send("Demand Point Backend Running...");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
