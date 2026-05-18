const jwt = require("jsonwebtoken");
const User = require("../models/User");

const protect = async (req, res, next) => {
  try {
    let token;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Not authorized, token failed" });
  }
};

const artisanOnly = (req, res, next) => {
  if (req.user?.role === "artisan") return next();
  return res.status(403).json({ message: "Artisan access only" });
};

const vendorOnly = (req, res, next) => {
  if (req.user?.role === "vendor") return next();
  return res.status(403).json({ message: "Vendor access only" });
};

module.exports = { protect, artisanOnly, vendorOnly };
