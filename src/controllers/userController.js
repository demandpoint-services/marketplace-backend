const PortfolioItem = require("../models/PortfolioItem");
const Booking = require("../models/Booking");
const Cart = require("../models/Cart");
const Order = require("../models/Order");
const { createNotification } = require("../services/notificationService");

// Setup Account
const User = require("../models/User");
const ArtisanProfile = require("../models/ArtisanProfile");

exports.setupAccount = async (req, res) => {
  try {
    const { role, phone, bio, location, profileImage, category } = req.body;

    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    if (!user.role && role) {
      user.role = role;
    }

    if (!["client", "artisan", "admin"].includes(user.role)) {
      return res.status(400).json({
        message: "Invalid account type",
      });
    }

    if (user.role === "artisan" && !category?.trim()) {
      return res.status(400).json({
        message: "Profession is required for artisan accounts",
      });
    }

    if (phone !== undefined) user.phone = phone.trim();
    if (bio !== undefined) user.bio = bio.trim();
    if (location !== undefined) user.location = location.trim();
    if (profileImage !== undefined) {
      user.profileImage = profileImage;
    }

    user.profileCompleted = true;

    await user.save();

    let artisanProfile = null;

    if (user.role === "artisan") {
      artisanProfile = await ArtisanProfile.findOneAndUpdate(
        {
          user: user._id,
        },
        {
          $set: {
            category: category.trim(),
          },

          $setOnInsert: {
            user: user._id,
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

      artisanProfile,
    });
  } catch (err) {
    console.error("Setup account error:", err);

    return res.status(500).json({
      message: err.message || "Unable to complete account setup",
    });
  }
};

// Get current logged-in user
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

    return res.status(200).json(user);
  } catch (err) {
    console.error("Get current user error:", err);

    return res.status(500).json({
      message: err.message || "Unable to retrieve user",
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

    if (name !== undefined) user.name = name.trim();
    if (phone !== undefined) user.phone = phone.trim();
    if (bio !== undefined) user.bio = bio.trim();
    if (location !== undefined) user.location = location.trim();
    if (profileImage !== undefined) {
      user.profileImage = profileImage;
    }

    await user.save();

    await createNotification({
      recipient: user._id,
      type: "PROFILE_UPDATED",
      category: "security",
      title: "Profile updated",
      message: "Your DemandPoint profile information was updated successfully.",
      actionUrl: "/settings?section=personal",
      resourceType: "user",
      resourceId: user._id,
    });

    const safeUser = await User.findById(user._id).select(
      "-password -verificationCode -verificationExpires",
    );

    return res.status(200).json(safeUser);
  } catch (err) {
    console.error("Update user error:", err);

    return res.status(500).json({
      message: err.message || "Unable to update profile",
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
