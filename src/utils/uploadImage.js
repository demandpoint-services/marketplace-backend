const cloudinary = require("../config/cloudinary");

const uploadImage = async (file) => {
  const result = await cloudinary.uploader.upload(file, {
    folder: "demand-point/artisans",
  });

  return result.secure_url;
};

module.exports = uploadImage;
