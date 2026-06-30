const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    phone: String,
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ["client", "artisan", "admin"],
      default: "client",
    },
    profileImage: {
      type: String,
      default: "",
    },
    bio: {
      type: String,
      default: "",
    },
    location: {
      type: String,
      default: "",
    },
    profileCompleted: {
      type: Boolean,
      default: false,
    },
    isSuspended: {
      type: Boolean,
      default: false,
    },

    suspendedAt: {
      type: Date,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);
