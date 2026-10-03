const ArtisanProfile = require("../models/ArtisanProfile");
const Product = require("../models/Product");
const Booking = require("../models/Booking");

exports.getPublicPlatformStats = async (req, res) => {
  try {
    const [professionals, verifiedProfessionals, activeProducts, completedBookings] =
      await Promise.all([
        // All professionals currently listed on the platform
        ArtisanProfile.countDocuments(),

        // Professionals actually marked as verified
        ArtisanProfile.countDocuments({
          verified: true,
        }),

        // Only products currently visible/active in the marketplace
        Product.countDocuments({
          status: "active",
          stock: { $gt: 0 },
        }),

        // Only genuinely completed service bookings
        Booking.countDocuments({
          status: "completed",
        }),
      ]);

    return res.status(200).json({
      success: true,
      stats: {
        professionals,
        verifiedProfessionals,
        products: activeProducts,
        completedBookings,
        marketplaceExperiences: 3,
      },
    });
  } catch (error) {
    console.error("Get public platform stats error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to load platform statistics.",
    });
  }
};
