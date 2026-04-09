const ArtisanProfile = require("../models/ArtisanProfile");

// Create artisan profile
exports.createProfile = async (req, res) => {
  try {
    const { category, location, bio, profileImage } = req.body;

    const existing = await ArtisanProfile.findOne({ user: req.user._id });

    if (existing) {
      return res.status(400).json({ message: "Profile already exists" });
    }

    const profile = await ArtisanProfile.create({
      user: req.user._id,
      category,
      location,
      bio,
      profileImage,
    });

    res.status(201).json(profile);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get all artisans
exports.getArtisans = async (req, res) => {
  try {
    const artisans = await ArtisanProfile.find().populate(
      "user",
      "name email phone",
    );

    res.json(artisans);
  } catch (error) {
    res.status(500).json({ message: error.message });
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
