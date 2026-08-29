const VendorProfile = require("../models/VendorProfile");
const ArtisanProfile = require("../models/ArtisanProfile");

const {
  getOrCreateArtisanSubscription,
} = require("../services/subscriptionService");

const { getSubscriptionAccess } = require("../utils/subscriptionStatus");

function serializeVendor(vendor) {
  if (!vendor) {
    return null;
  }

  return {
    _id: vendor._id,

    storeName: vendor.storeName,
    storeDescription: vendor.storeDescription,

    storeLogo: vendor.storeLogo,
    storeBanner: vendor.storeBanner,

    phone: vendor.phone,

    businessAddress: vendor.businessAddress,
    state: vendor.state,
    city: vendor.city,

    pickupLocation: {
      contactName: vendor.pickupLocation?.contactName || "",
      phone: vendor.pickupLocation?.phone || "",
      address: vendor.pickupLocation?.address || "",
      city: vendor.pickupLocation?.city || "",
      state: vendor.pickupLocation?.state || "",
      country: vendor.pickupLocation?.country || "Nigeria",
    },

    status: vendor.status,
    onboardingCompleted: vendor.onboardingCompleted,

    bankAccount: {
      bankName: vendor.bankAccount?.bankName || "",
      accountNumber: vendor.bankAccount?.accountNumber || "",
      accountName: vendor.bankAccount?.accountName || "",
      verified: Boolean(vendor.bankAccount?.verified),
    },

    stats: {
      totalProducts: Number(vendor.totalProducts) || 0,

      totalOrders: Number(vendor.totalOrders) || 0,

      grossSalesKobo: Number(vendor.grossSalesKobo) || 0,

      pendingBalanceKobo: Number(vendor.pendingBalanceKobo) || 0,

      availableBalanceKobo: Number(vendor.availableBalanceKobo) || 0,

      lockedBalanceKobo: Number(vendor.lockedBalanceKobo) || 0,

      withdrawnKobo: Number(vendor.withdrawnKobo) || 0,
    },

    activatedAt: vendor.activatedAt,

    createdAt: vendor.createdAt,
    updatedAt: vendor.updatedAt,
  };
}

// GET /api/vendors/me
exports.getMyVendorProfile = async (req, res) => {
  try {
    if (req.user.role !== "artisan") {
      return res.status(403).json({
        success: false,
        message: "Only artisan accounts can become vendors.",
      });
    }

    const subscription = await getOrCreateArtisanSubscription(req.user._id);

    const access = getSubscriptionAccess(subscription);

    const vendor = await VendorProfile.findOne({
      user: req.user._id,
    });

    return res.status(200).json({
      success: true,

      eligibleToSell: access.hasAccess,

      vendorExists: Boolean(vendor),

      vendor: serializeVendor(vendor),

      subscription: {
        status: access.status,
        hasAccess: access.hasAccess,
      },
    });
  } catch (error) {
    console.error("Get vendor profile error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve vendor information.",
    });
  }
};

// POST /api/vendors/onboard
exports.createVendorProfile = async (req, res) => {
  try {
    if (req.user.role !== "artisan") {
      return res.status(403).json({
        success: false,
        message: "Only artisan accounts can become vendors.",
      });
    }

    const subscription = await getOrCreateArtisanSubscription(req.user._id);

    const access = getSubscriptionAccess(subscription);

    if (!access.hasAccess) {
      return res.status(403).json({
        success: false,
        code: "SUBSCRIPTION_REQUIRED",
        message:
          "An active DemandPoint Professional subscription or free trial is required to become a vendor.",
      });
    }

    const existingVendor = await VendorProfile.findOne({
      user: req.user._id,
    });

    if (existingVendor) {
      return res.status(409).json({
        success: false,
        code: "VENDOR_ALREADY_EXISTS",
        message: "You already have a vendor account.",
        vendor: serializeVendor(existingVendor),
      });
    }

    const artisanProfile = await ArtisanProfile.findOne({
      user: req.user._id,
    });

    if (!artisanProfile) {
      return res.status(409).json({
        success: false,
        code: "ARTISAN_PROFILE_REQUIRED",
        message:
          "Complete your professional artisan profile before becoming a vendor.",
      });
    }

    const {
      storeName,
      storeDescription = "",
      phone = "",
      businessAddress = "",
      state = "",
      city = "",
      bankName = "",
      accountNumber = "",
      accountName = "",
    } = req.body;

    const normalizedStoreName = String(storeName || "").trim();

    if (!normalizedStoreName) {
      return res.status(400).json({
        success: false,
        message: "Store name is required.",
      });
    }

    if (normalizedStoreName.length > 120) {
      return res.status(400).json({
        success: false,
        message: "Store name must not exceed 120 characters.",
      });
    }

    const normalizedAccountNumber = String(accountNumber || "")
      .replace(/\D/g, "")
      .trim();

    if (normalizedAccountNumber && normalizedAccountNumber.length !== 10) {
      return res.status(400).json({
        success: false,
        message: "Bank account number must be 10 digits.",
      });
    }

    const vendor = await VendorProfile.create({
      user: req.user._id,

      artisanProfile: artisanProfile._id,

      storeName: normalizedStoreName,

      storeDescription: String(storeDescription || "").trim(),

      phone: String(phone || req.user.phone || "").trim(),

      businessAddress: String(businessAddress || "").trim(),

      state: String(state || "").trim(),

      city: String(city || "").trim(),

      pickupLocation: {
        contactName: String(req.user.name || "").trim(),

        phone: String(phone || req.user.phone || "").trim(),

        address: String(businessAddress || "").trim(),

        city: String(city || "").trim(),

        state: String(state || "").trim(),

        country: "Nigeria",
      },

      bankAccount: {
        bankName: String(bankName || "").trim(),

        accountNumber: normalizedAccountNumber,

        accountName: String(accountName || "").trim(),

        verified: false,
      },

      onboardingCompleted: true,

      status: "active",

      activatedAt: new Date(),
    });

    return res.status(201).json({
      success: true,

      message: "Your DemandPoint vendor account has been created.",

      vendor: serializeVendor(vendor),
    });
  } catch (error) {
    console.error("Create vendor profile error:", error);

    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A vendor profile already exists for this artisan.",
      });
    }

    return res.status(500).json({
      success: false,
      message: error?.message || "Unable to create your vendor account.",
    });
  }
};

// PATCH /api/vendors/me
exports.updateMyVendorProfile = async (req, res) => {
  try {
    if (req.user.role !== "artisan") {
      return res.status(403).json({
        success: false,
        message: "Only artisan accounts have vendor profiles.",
      });
    }

    const vendor = await VendorProfile.findOne({
      user: req.user._id,
    });

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor profile not found.",
      });
    }

    const allowedFields = [
      "storeName",
      "storeDescription",
      "storeLogo",
      "storeBanner",
      "phone",
      "businessAddress",
      "state",
      "city",
    ];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        vendor[field] =
          typeof req.body[field] === "string"
            ? req.body[field].trim()
            : req.body[field];
      }
    }
    if (!vendor.pickupLocation) {
      vendor.pickupLocation = {};
    }

    if (req.body.pickupLocation !== undefined) {
      const pickup = req.body.pickupLocation || {};

      if (pickup.contactName !== undefined) {
        vendor.pickupLocation.contactName = String(
          pickup.contactName || "",
        ).trim();
      }

      if (pickup.phone !== undefined) {
        vendor.pickupLocation.phone = String(pickup.phone || "").trim();
      }

      if (pickup.address !== undefined) {
        vendor.pickupLocation.address = String(pickup.address || "").trim();
      }

      if (pickup.city !== undefined) {
        vendor.pickupLocation.city = String(pickup.city || "").trim();
      }

      if (pickup.state !== undefined) {
        vendor.pickupLocation.state = String(pickup.state || "").trim();
      }

      if (pickup.country !== undefined) {
        vendor.pickupLocation.country =
          String(pickup.country || "Nigeria").trim() || "Nigeria";
      }
    }

    if (req.body.bankName !== undefined) {
      vendor.bankAccount.bankName = String(req.body.bankName).trim();

      vendor.bankAccount.verified = false;
      vendor.bankAccount.verifiedAt = null;
    }

    if (req.body.accountName !== undefined) {
      vendor.bankAccount.accountName = String(req.body.accountName).trim();

      vendor.bankAccount.verified = false;
      vendor.bankAccount.verifiedAt = null;
    }

    if (req.body.accountNumber !== undefined) {
      const accountNumber = String(req.body.accountNumber).replace(/\D/g, "");

      if (accountNumber.length !== 10) {
        return res.status(400).json({
          success: false,
          message: "Bank account number must be 10 digits.",
        });
      }

      vendor.bankAccount.accountNumber = accountNumber;

      vendor.bankAccount.verified = false;
      vendor.bankAccount.verifiedAt = null;
    }

    await vendor.save();

    return res.status(200).json({
      success: true,

      message: "Vendor profile updated successfully.",

      vendor: serializeVendor(vendor),
    });
  } catch (error) {
    console.error("Update vendor profile error:", error);

    return res.status(500).json({
      success: false,
      message: error?.message || "Unable to update vendor information.",
    });
  }
};
