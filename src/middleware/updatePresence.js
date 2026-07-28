const User = require("../models/User");

async function updatePresence(req, res, next) {
  if (!req.user?._id) {
    return next();
  }

  try {
    await User.findByIdAndUpdate(req.user._id, {
      $set: {
        lastSeen: new Date(),
      },
    });
  } catch (error) {
    // Presence tracking should never break the actual request
    console.error("Presence update error:", error);
  }

  return next();
}

module.exports = updatePresence;
