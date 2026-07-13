const User = require("../models/User");
const ArtisanProfile = require("../models/ArtisanProfile");
const PortfolioItem = require("../models/PortfolioItem");
const Booking = require("../models/Booking");
const Cart = require("../models/Cart");
const Order = require("../models/Order");

// Setup Account
exports.setupAccount = async (req, res) => {
  try {
    const { role, phone, bio, location, profileImage, category } = req.body;

    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    // Role can only be selected once
    if (!user.role && role) {
      user.role = role;
    }

    if (phone !== undefined) user.phone = phone;
    if (bio !== undefined) user.bio = bio;
    if (location !== undefined) user.location = location;
    if (profileImage !== undefined) {
      user.profileImage = profileImage;
    }

    user.profileCompleted = true;

    await user.save();

    // Ensure an artisan profile exists
    if (user.role === "artisan") {
      await ArtisanProfile.findOneAndUpdate(
        { user: user._id },
        {
          $setOnInsert: {
            user: user._id,
            category: category?.trim() || "General Services",
          },
        },
        {
          new: true,
          upsert: true,
          runValidators: true,
        },
      );
    }

    return res.status(200).json({
      message: "Account setup completed",
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        bio: user.bio,
        location: user.location,
        profileImage: user.profileImage,
        profileCompleted: user.profileCompleted,
        isVerified: user.isVerified,
        provider: user.provider,
      },
    });
  } catch (err) {
    console.error("Setup account error:", err);

    return res.status(500).json({
      message: err.message,
    });
  }
};

// Get Current Logged-in User
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "-password -verificationCode -verificationExpires",
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    res.json(user);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
};

// Update User Profile
exports.updateMe = async (req, res) => {
  try {
    const { name, phone, bio, location, profileImage } = req.body;

    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (name) user.name = name;
    if (phone) user.phone = phone;
    if (bio) user.bio = bio;
    if (location) user.location = location;
    if (profileImage) user.profileImage = profileImage;

    await user.save();

    res.json(user);
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
};

// Delete User Account
exports.deleteMe = async (req, res) => {
  try {
    const userId = req.user._id;

    await Promise.all([
      ArtisanProfile.deleteOne({ user: userId }),

      PortfolioItem.deleteMany({
        artisan: userId,
      }),

      Booking.deleteMany({
        $or: [{ client: userId }, { artisan: userId }],
      }),

      Cart.deleteMany({
        user: userId,
      }),

      Order.deleteMany({
        user: userId,
      }),
    ]);

    await User.findByIdAndDelete(userId);

    return res.status(200).json({
      message: "Account and associated data deleted successfully",
    });
  } catch (err) {
    console.error("Delete account error:", err);

    return res.status(500).json({
      message: "Unable to delete account",
    });
  }
};

// Suspend User Account
exports.toggleSuspension = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user)
      return res.status(404).json({
        message: "User not found",
      });

    user.isSuspended = !user.isSuspended;

    user.suspendedAt = user.isSuspended ? new Date() : null;

    await user.save();

    res.json({
      success: true,
      suspended: user.isSuspended,
      message: user.isSuspended ? "Account suspended." : "Account reactivated.",
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
    });
  }
};
