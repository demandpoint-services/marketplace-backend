const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    title: { type: String, required: true },
    description: { type: String },
    price: { type: Number, required: true },

    images: [{ type: String }],

    category: {
      type: String,
      enum: ["fashion", "furniture", "art", "handmade", "electronics", "other"],
      default: "other",
    },

    stock: { type: Number, default: 1 },

    rating: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Product", productSchema);
