const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema(
  {
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    artisan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    service: { type: String },
    date: { type: Date, required: true },
    time: { type: String, required: true },
    address: { type: String },
    notes: { type: String },
    price: { type: Number },
    status: {
      type: String,
      enum: ["pending", "accepted", "in-progress", "completed", "cancelled"],
      default: "pending",
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid"],
      default: "pending",
    },
    transactionId: { type: String },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Booking", bookingSchema);
