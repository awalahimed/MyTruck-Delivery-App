import React, { useState } from "react";
import { Image, View, StyleSheet } from "react-native";

const FALLBACK_IMAGES = {
  dish: require("../../assets/cropped/banner_burger.png"),
  restaurant: require("../../assets/cropped/habesha_kitchen.png"),
  shop: require("../../assets/cropped/pizza_house.png"),
  driver: require("../../assets/cropped/driver_avatar.png"),
  banner: require("../../assets/cropped/exact_home_hero_banner.png"),
  default: require("../../assets/icon.png"),
};

export default function SmartImage({
  uri,
  source,
  style,
  resizeMode = "cover",
  fallbackType = "default",
  fallbackSource,
}) {
  const [hasError, setHasError] = useState(false);

  // Determine fallback asset
  const resolvedFallback =
    fallbackSource ||
    FALLBACK_IMAGES[fallbackType] ||
    FALLBACK_IMAGES.default;

  // Direct source passed (e.g. require(...) or { uri: ... })
  if (source) {
    if (typeof source === "number") {
      return (
        <Image
          source={source}
          style={style}
          resizeMode={resizeMode}
        />
      );
    }
    if (source.uri && typeof source.uri === "string") {
      const clean = source.uri.trim();
      if (!hasError && (clean.startsWith("http://") || clean.startsWith("https://") || clean.startsWith("file://") || clean.startsWith("data:"))) {
        return (
          <Image
            source={{ uri: clean, cache: "force-cache" }}
            defaultSource={typeof resolvedFallback === "number" ? resolvedFallback : undefined}
            style={style}
            resizeMode={resizeMode}
            onError={() => setHasError(true)}
          />
        );
      }
      return (
        <Image
          source={resolvedFallback}
          style={style}
          resizeMode={resizeMode}
        />
      );
    }
  }

  // Number passed directly as uri (e.g. uri={require(...)})
  if (typeof uri === "number") {
    return (
      <Image
        source={uri}
        style={style}
        resizeMode={resizeMode}
      />
    );
  }

  // Object passed as uri
  if (uri && typeof uri === "object" && uri.uri) {
    const clean = typeof uri.uri === "string" ? uri.uri.trim() : "";
    if (!hasError && (clean.startsWith("http://") || clean.startsWith("https://") || clean.startsWith("file://") || clean.startsWith("data:"))) {
      return (
        <Image
          source={{ uri: clean, cache: "force-cache" }}
          defaultSource={typeof resolvedFallback === "number" ? resolvedFallback : undefined}
          style={style}
          resizeMode={resizeMode}
          onError={() => setHasError(true)}
        />
      );
    }
    return (
      <Image
        source={resolvedFallback}
        style={style}
        resizeMode={resizeMode}
      />
    );
  }

  // Remote URL string
  const cleanUri = uri && typeof uri === "string" ? uri.trim() : "";
  const isValidRemote =
    !hasError &&
    cleanUri &&
    (cleanUri.startsWith("http://") ||
      cleanUri.startsWith("https://") ||
      cleanUri.startsWith("file://") ||
      cleanUri.startsWith("data:"));

  return (
    <Image
      source={isValidRemote ? { uri: cleanUri, cache: "force-cache" } : resolvedFallback}
      defaultSource={typeof resolvedFallback === "number" ? resolvedFallback : undefined}
      style={style}
      resizeMode={resizeMode}
      onError={() => setHasError(true)}
    />
  );
}
