const mongoose = require("mongoose");
const Notification = require("../models/Notification");

exports.getMyNotifications = async (req, res) => {
  try {
    const {
      category = "all",
      status = "all",
      page = 1,
      limit = 20,
    } = req.query;

    const parsedPage = Math.max(Number(page) || 1, 1);
    const parsedLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);

    const query = {
      recipient: req.user._id,
    };

    if (category !== "all") {
      query.category = category;
    }

    if (status === "unread") {
      query.read = false;
    }

    if (status === "read") {
      query.read = true;
    }

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .populate("actor", "name profileImage role")
        .sort({ createdAt: -1 })
        .skip((parsedPage - 1) * parsedLimit)
        .limit(parsedLimit),

      Notification.countDocuments(query),

      Notification.countDocuments({
        recipient: req.user._id,
        read: false,
      }),
    ]);

    return res.status(200).json({
      notifications,
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        pages: Math.ceil(total / parsedLimit),
      },
      unreadCount,
    });
  } catch (error) {
    console.error("Get notifications error:", error);

    return res.status(500).json({
      message: "Unable to retrieve notifications.",
    });
  }
};

exports.getUnreadCount = async (req, res) => {
  try {
    const unreadCount = await Notification.countDocuments({
      recipient: req.user._id,
      read: false,
    });

    return res.status(200).json({
      unreadCount,
    });
  } catch (error) {
    console.error("Get unread count error:", error);

    return res.status(500).json({
      message: "Unable to retrieve unread count.",
    });
  }
};

exports.markNotificationAsRead = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid notification ID.",
      });
    }

    const notification = await Notification.findOneAndUpdate(
      {
        _id: req.params.id,
        recipient: req.user._id,
      },
      {
        $set: {
          read: true,
          readAt: new Date(),
        },
      },
      {
        new: true,
      },
    );

    if (!notification) {
      return res.status(404).json({
        message: "Notification not found.",
      });
    }

    return res.status(200).json(notification);
  } catch (error) {
    console.error("Mark notification read error:", error);

    return res.status(500).json({
      message: "Unable to update notification.",
    });
  }
};

exports.markAllNotificationsAsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      {
        recipient: req.user._id,
        read: false,
      },
      {
        $set: {
          read: true,
          readAt: new Date(),
        },
      },
    );

    return res.status(200).json({
      message: "All notifications marked as read.",
    });
  } catch (error) {
    console.error("Mark all notifications read error:", error);

    return res.status(500).json({
      message: "Unable to update notifications.",
    });
  }
};

exports.deleteNotification = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid notification ID.",
      });
    }

    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      recipient: req.user._id,
    });

    if (!notification) {
      return res.status(404).json({
        message: "Notification not found.",
      });
    }

    return res.status(200).json({
      message: "Notification removed.",
    });
  } catch (error) {
    console.error("Delete notification error:", error);

    return res.status(500).json({
      message: "Unable to remove notification.",
    });
  }
};

exports.clearReadNotifications = async (req, res) => {
  try {
    await Notification.deleteMany({
      recipient: req.user._id,
      read: true,
    });

    return res.status(200).json({
      message: "Read notifications cleared.",
    });
  } catch (error) {
    console.error("Clear notifications error:", error);

    return res.status(500).json({
      message: "Unable to clear notifications.",
    });
  }
};
