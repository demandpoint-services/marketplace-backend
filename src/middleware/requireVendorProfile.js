const VendorProfile = require("../models/VendorProfile");

async function requireVendorProfile(req, res, next) {
  try {
    if (req.user?.role !== "artisan") {
      return res.status(403).json({
        success: false,
        code: "ARTISAN_REQUIRED",
        message: "Only artisan accounts have vendor profiles.",
      });
    }

    const vendor = await VendorProfile.findOne({
      user: req.user._id,
    });

    if (!vendor) {
      return res.status(403).json({
        success: false,
        code: "VENDOR_PROFILE_REQUIRED",
        message: "Complete vendor onboarding first.",
      });
    }

    req.vendor = vendor;

    return next();
  } catch (error) {
    console.error("Vendor profile access error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to verify vendor access.",
    });
  }
}

module.exports = requireVendorProfile;
