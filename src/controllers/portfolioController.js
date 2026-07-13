const PortfolioItem = require("../models/PortfolioItem");
const User = require("../models/User");

const MAX_PORTFOLIO_ITEMS = 12;

const ALLOWED_MEDIA_TYPES = ["image", "video", "document"];

const MAX_FILE_SIZES = {
  image: 5 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  document: 10 * 1024 * 1024,
};

// GET /api/portfolio
exports.getMyPortfolio = async (req, res) => {
  try {
    const items = await PortfolioItem.find({
      artisan: req.user._id,
    }).sort({ createdAt: -1 });

    return res.status(200).json(items);
  } catch (err) {
    console.error("Get portfolio error:", err);

    return res.status(500).json({
      message: "Unable to retrieve portfolio.",
    });
  }
};

// GET /api/portfolio/artisan/:artisanId
exports.getArtisanPortfolio = async (req, res) => {
  try {
    const items = await PortfolioItem.find({
      artisan: req.params.artisanId,
    }).sort({
      featured: -1,
      createdAt: -1,
    });

    return res.status(200).json(items);
  } catch (err) {
    console.error("Get public portfolio error:", err);

    return res.status(500).json({
      message: "Unable to retrieve artisan portfolio.",
    });
  }
};

// POST /api/portfolio
exports.createPortfolioItem = async (req, res) => {
  try {
    const {
      title,
      description,
      mediaType,
      url,
      publicId,
      thumbnailUrl,
      originalName,
      mimeType,
      size,
    } = req.body;

    if (req.user.role !== "artisan") {
      return res.status(403).json({
        message: "Only artisans can add portfolio items.",
      });
    }

    if (!title?.trim()) {
      return res.status(400).json({
        message: "Portfolio title is required.",
      });
    }

    if (!ALLOWED_MEDIA_TYPES.includes(mediaType)) {
      return res.status(400).json({
        message: "Invalid portfolio media type.",
      });
    }

    if (!url || !publicId || !mimeType || !size) {
      return res.status(400).json({
        message: "Complete uploaded file information is required.",
      });
    }

    if (Number(size) > MAX_FILE_SIZES[mediaType]) {
      const limits = {
        image: "5 MB",
        video: "50 MB",
        document: "10 MB",
      };

      return res.status(400).json({
        message: `${mediaType} files must not exceed ${limits[mediaType]}.`,
      });
    }

    const portfolioCount = await PortfolioItem.countDocuments({
      artisan: req.user._id,
    });

    if (portfolioCount >= MAX_PORTFOLIO_ITEMS) {
      return res.status(400).json({
        message: `You can upload a maximum of ${MAX_PORTFOLIO_ITEMS} portfolio items.`,
      });
    }

    const item = await PortfolioItem.create({
      artisan: req.user._id,
      title: title.trim(),
      description: description?.trim() || "",
      mediaType,
      url,
      publicId,
      thumbnailUrl: thumbnailUrl || "",
      originalName: originalName || "",
      mimeType,
      size: Number(size),
    });

    return res.status(201).json(item);
  } catch (err) {
    console.error("Create portfolio error:", err);

    return res.status(500).json({
      message: "Unable to create portfolio item.",
    });
  }
};

// PATCH /api/portfolio/:id
exports.updatePortfolioItem = async (req, res) => {
  try {
    const { title, description, featured } = req.body;

    const item = await PortfolioItem.findOne({
      _id: req.params.id,
      artisan: req.user._id,
    });

    if (!item) {
      return res.status(404).json({
        message: "Portfolio item not found.",
      });
    }

    if (title !== undefined) {
      if (!title.trim()) {
        return res.status(400).json({
          message: "Portfolio title cannot be empty.",
        });
      }

      item.title = title.trim();
    }

    if (description !== undefined) {
      item.description = description.trim();
    }

    if (featured !== undefined) {
      item.featured = Boolean(featured);
    }

    await item.save();

    return res.status(200).json(item);
  } catch (err) {
    console.error("Update portfolio error:", err);

    return res.status(500).json({
      message: "Unable to update portfolio item.",
    });
  }
};

// DELETE /api/portfolio/:id
exports.deletePortfolioItem = async (req, res) => {
  try {
    const item = await PortfolioItem.findOne({
      _id: req.params.id,
      artisan: req.user._id,
    });

    if (!item) {
      return res.status(404).json({
        message: "Portfolio item not found.",
      });
    }

    // This removes the MongoDB record.
    // Add Cloudinary deletion here later using item.publicId.
    await item.deleteOne();

    return res.status(200).json({
      message: "Portfolio item removed successfully.",
    });
  } catch (err) {
    console.error("Delete portfolio error:", err);

    return res.status(500).json({
      message: "Unable to remove portfolio item.",
    });
  }
};
