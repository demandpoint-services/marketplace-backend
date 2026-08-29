const mongoose = require("mongoose");

const productImageSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
      trim: true,
    },

    publicId: {
      type: String,
      trim: true,
      default: "",
    },

    alt: {
      type: String,
      trim: true,
      maxlength: 180,
      default: "",
    },
  },
  {
    _id: false,
  },
);

const productSchema = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VendorProfile",
      required: true,
      index: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },

    description: {
      type: String,
      trim: true,
      maxlength: 3000,
      default: "",
    },

    category: {
      type: String,
      enum: [
        "fashion",
        "furniture",
        "electronics",
        "handmade",
        "art",
        "beauty",
        "home",
        "other",
      ],
      default: "other",
      index: true,
    },

    priceKobo: {
      type: Number,
      required: true,
      min: 100,
    },

    images: {
      type: [productImageSchema],
      default: [],
    },

    shipping: {
      requiresShipping: {
        type: Boolean,
        default: true,
      },

      weightKg: {
        type: Number,
        default: 0,
        min: 0,
      },

      dimensions: {
        lengthCm: {
          type: Number,
          default: 0,
          min: 0,
        },

        widthCm: {
          type: Number,
          default: 0,
          min: 0,
        },

        heightCm: {
          type: Number,
          default: 0,
          min: 0,
        },
      },
    },

    stock: {
      type: Number,
      default: 0,
      min: 0,
    },

    lowStockThreshold: {
      type: Number,
      default: 3,
      min: 0,
    },

    status: {
      type: String,
      enum: ["draft", "active", "archived"],
      default: "draft",
      index: true,
    },

    totalSold: {
      type: Number,
      default: 0,
      min: 0,
    },

    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },

    reviewCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    archivedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

productSchema.index({
  vendor: 1,
  status: 1,
  createdAt: -1,
});

productSchema.index({
  category: 1,
  status: 1,
  createdAt: -1,
});

productSchema.virtual("isAvailable").get(function () {
  return this.status === "active" && this.stock > 0;
});

productSchema.set("toJSON", {
  virtuals: true,
});

productSchema.set("toObject", {
  virtuals: true,
});

module.exports = mongoose.model("Product", productSchema);
