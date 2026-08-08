const mongoose = require("mongoose");

const attachmentSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["image", "video", "document", "file"],
      required: true,
    },

    url: {
      type: String,
      required: true,
      trim: true,
    },

    publicId: {
      type: String,
      default: "",
      trim: true,
    },

    thumbnailUrl: {
      type: String,
      default: "",
      trim: true,
    },

    originalName: {
      type: String,
      default: "",
      trim: true,
    },

    mimeType: {
      type: String,
      default: "",
      trim: true,
    },

    size: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    _id: false,
  },
);

const messageSchema = new mongoose.Schema(
  {
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },

    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      index: true,
    },

    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: ["text", "image", "file", "mixed"],
      default: "text",
    },

    text: {
      type: String,
      trim: true,
      default: "",
      maxlength: 2000,
    },

    attachments: {
      type: [attachmentSchema],
      default: [],
    },

    read: {
      type: Boolean,
      default: false,
      index: true,
    },

    readAt: {
      type: Date,
      default: null,
    },

    deletedBySender: {
      type: Boolean,
      default: false,
    },

    deletedByRecipient: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

messageSchema.index({
  conversation: 1,
  createdAt: -1,
});

messageSchema.index({
  recipient: 1,
  read: 1,
  createdAt: -1,
});

messageSchema.pre("validate", function () {
  const hasText = typeof this.text === "string" && this.text.trim().length > 0;

  const hasAttachments =
    Array.isArray(this.attachments) && this.attachments.length > 0;

  if (!hasText && !hasAttachments) {
    throw new Error("A message must contain text or at least one attachment.");
  }

  if (hasText) {
    this.text = this.text.trim();
  }
});

module.exports = mongoose.model("Message", messageSchema);
