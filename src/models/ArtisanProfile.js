const mongoose = require("mongoose");

const artisanSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    category: { type: String, required: true },
    location: { type: String },
    bio: { type: String },
    profileImage: { type: String },
    rating: { type: Number, default: 0 },
  },
  { timestamps: true },
);

module.exports = mongoose.model("ArtisanProfile", artisanSchema);
