const cloudinary = require("../config/cloudinary");

const uploadSpaceImage = async (file) => {
  if (!file) {
    throw new Error("No image file provided.");
  }

  const result = await cloudinary.uploader.upload(file, {
    folder: "demand-point/spaces",
    resource_type: "image",
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
    type: "image",
    alt: "",
  };
};

module.exports = uploadSpaceImage;
