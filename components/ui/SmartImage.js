import React, { useEffect, useState } from "react";
import { Image } from "react-native";
import useFirebaseImageSource, { getImageSourceKey } from "../../utils/useFirebaseImageSource";

const FALLBACK_IMAGES = {
  dish: require("../../assets/cropped/banner_burger.png"),
  restaurant: require("../../assets/cropped/habesha_kitchen.png"),
  shop: require("../../assets/cropped/pizza_house.png"),
  driver: require("../../assets/cropped/driver_avatar.png"),
  banner: require("../../assets/optimized/home-banner.jpg"),
  default: require("../../assets/optimized/runtime-icon.jpg"),
};

export default function SmartImage({
  uri,
  source,
  style,
  resizeMode = "cover",
  fallbackType = "default",
  fallbackSource,
}) {
  const input = source !== undefined ? source : uri;
  const resolvedSource = useFirebaseImageSource(input);
  const sourceKey = getImageSourceKey(input);
  const [failedKey, setFailedKey] = useState("");
  useEffect(() => setFailedKey(""), [sourceKey]);

  const fallback = fallbackSource || FALLBACK_IMAGES[fallbackType] || FALLBACK_IMAGES.default;
  const imageSource = failedKey === sourceKey || !resolvedSource ? fallback : resolvedSource;

  return (
    <Image
      source={imageSource}
      defaultSource={typeof fallback === "number" ? fallback : undefined}
      style={style}
      resizeMode={resizeMode}
      onError={() => setFailedKey(sourceKey)}
    />
  );
}
