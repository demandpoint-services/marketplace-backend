const Booking = require("../models/Booking");
const ArtisanProfile = require("../models/ArtisanProfile");

// CREATE BOOKING
exports.createBooking = async (req, res) => {
  try {
    const { artisan, service, date, time, address, notes, price } = req.body;

    const booking = await Booking.create({
      client: req.user._id,
      artisan,
      service,
      date,
      time,
      address,
      notes,
      price,
    });

    res.status(201).json(booking);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET MY BOOKINGS (client view)
exports.getMyBookings = async (req, res) => {
  try {
    const bookings = await Booking.find({
      client: req.user._id,
    })
      .populate({
        path: "artisan",
        populate: {
          path: "user",
          select: "name email",
        },
      })
      .sort({ createdAt: -1 });

    res.json(bookings);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// GET ARTISAN BOOKINGS
exports.getArtisanBookings = async (req, res) => {
  try {
    const profile = await ArtisanProfile.findOne({
      user: req.user._id,
    });

    if (!profile) {
      return res.status(404).json({
        message: "Artisan profile not found",
      });
    }

    const bookings = await Booking.find({
      artisan: profile._id,
    })
      .populate("client", "name email phone")
      .sort({ createdAt: -1 });

    res.json(bookings);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// UPDATE BOOKING STATUS
exports.updateBookingStatus = async (req, res) => {
  try {
    const { status } = req.body;

    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    booking.status = status;
    await booking.save();

    res.json(booking);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
