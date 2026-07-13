const cloudinary = require("../config/cloudinary");

// Create artisan profile
const ArtisanProfile = require("../models/ArtisanProfile");
const User = require("../models/User");

exports.createProfile = async (req, res) => {
  try {
    const {
      category,
      skills,
      minimumCharge,
      hourlyRate,
      yearsOfExperience,
      serviceAreas,
    } = req.body;

    if (!category?.trim()) {
      return res.status(400).json({
        message: "Service category is required",
      });
    }

    const existing = await ArtisanProfile.findOne({
      user: req.user._id,
    });

    if (existing) {
      return res.status(400).json({
        message: "Profile already exists",
      });
    }

    const profile = await ArtisanProfile.create({
      user: req.user._id,
      category: category.trim(),
      skills: Array.isArray(skills) ? skills : [],
      minimumCharge: Number(minimumCharge) || 0,
      hourlyRate: Number(hourlyRate) || 0,
      yearsOfExperience: Number(yearsOfExperience) || 0,
      serviceAreas: Array.isArray(serviceAreas) ? serviceAreas : [],
    });

    await User.findByIdAndUpdate(req.user._id, {
      role: "artisan",
    });

    const populatedProfile = await ArtisanProfile.findById(
      profile._id,
    ).populate("user", "name email phone profileImage bio location");

    return res.status(201).json(populatedProfile);
  } catch (error) {
    console.error("Create artisan profile error:", error);

    return res.status(500).json({
      message: error.message,
    });
  }
};

// Get all artisans
exports.getArtisans = async (req, res) => {
  try {
    const artisans = await ArtisanProfile.find().populate(
      "user",
      "name email phone profileImage bio location isSuspended",
    );

    const activeArtisans = artisans.filter(
      (artisan) => artisan.user && artisan.user.isSuspended === false,
    );

    res.json(activeArtisans);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Get single artisan
exports.getArtisan = async (req, res) => {
  try {
    const artisan = await ArtisanProfile.findById(req.params.id).populate(
      "user",
      "name email phone",
    );

    if (!artisan) {
      return res.status(404).json({ message: "Artisan not found" });
    }

    res.json(artisan);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.getMyArtisanProfile = async (req, res) => {
  try {
    const profile = await ArtisanProfile.findOne({
      user: req.user._id,
    }).populate(
      "user",
      "name email phone profileImage bio location isVerified",
    );

    if (!profile) {
      return res.status(404).json({
        message: "Artisan profile not found",
      });
    }

    return res.status(200).json(profile);
  } catch (err) {
    return res.status(500).json({
      message: err.message,
    });
  }
};

// Update artisan profile
exports.updateProfile = async (req, res) => {
  try {
    const profile = await ArtisanProfile.findOne({ user: req.user._id });

    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    const updated = await ArtisanProfile.findByIdAndUpdate(
      profile._id,
      req.body,
      { new: true },
    );

    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
