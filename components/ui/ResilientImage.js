import React, { useEffect, useState } from "react";
import { Image, View, StyleSheet, ActivityIndicator } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import useFirebaseImageSource, { getImageSourceKey } from "../../utils/useFirebaseImageSource";

const DEFAULT_BURGER = require("../../assets/cropped/banner_burger.png");
const DEFAULT_HABESHA = require("../../assets/cropped/habesha_kitchen.png");
const DEFAULT_PIZZA = require("../../assets/cropped/pizza_house.png");

/**
 * ResilientImage — Fail-safe, high-speed image component for MyTruck Delivery
 *
 * Guarantees instantaneous local fallback rendering, aggressive force-caching,
 * and eliminates white flashes or layout pops.
 */
export default function ResilientImage({
  source,
  fallbackSource,
  fallbackCategory = "food", // 'food' | 'burger' | 'pizza' | 'shop' | 'package'
  style,
  resizeMode = "cover",
  showPlaceholderIcon = true,
  ...props
}) {
  const resolved = useFirebaseImageSource(source);
  const sourceKey = getImageSourceKey(source);
  const [failedKey, setFailedKey] = useState("");
  useEffect(() => setFailedKey(""), [sourceKey]);

  const getCategorizedFallback = () => {
    if (fallbackSource) return fallbackSource;
    const cat = String(fallbackCategory).toLowerCase();
    if (cat === "none") return null;
    if (cat.includes("burger") || cat.includes("fast")) return DEFAULT_BURGER;
    if (cat.includes("pizza") || cat.includes("italian")) return DEFAULT_PIZZA;
    if (cat.includes("shop") || cat.includes("grocer") || cat.includes("supermarket")) return DEFAULT_HABESHA;
    return DEFAULT_HABESHA;
  };

  const fallbackAsset = getCategorizedFallback();
  const hasError = failedKey === sourceKey;
  const imageSource = hasError ? fallbackAsset : resolved;

  return (
    <View style={[styles.container, style]}>
      {imageSource ? (
        <Image
          {...props}
          source={imageSource}
          defaultSource={typeof fallbackAsset === "number" ? fallbackAsset : undefined}
          style={[StyleSheet.absoluteFillObject, style]}
          resizeMode={resizeMode}
          onError={() => setFailedKey(sourceKey)}
        />
      ) : showPlaceholderIcon ? (
        <View style={[StyleSheet.absoluteFillObject, styles.placeholder]}>
          <MaterialCommunityIcons name="image-off-outline" size={28} color="#94A3B8" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { alignItems: "center", justifyContent: "center", backgroundColor: "#E8F1EF" },
  container: {
    overflow: "hidden",
    backgroundColor: "#F1F5F9",
    position: "relative",
  },
  loaderWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(241, 245, 249, 0.4)",
  },
});

