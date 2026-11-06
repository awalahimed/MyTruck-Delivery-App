import React, { useState } from "react";
import { Image, View, StyleSheet, ActivityIndicator } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

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
  const [hasError, setHasError] = useState(false);

  const getCategorizedFallback = () => {
    if (fallbackSource) return fallbackSource;
    const cat = String(fallbackCategory).toLowerCase();
    if (cat.includes("burger") || cat.includes("fast")) return DEFAULT_BURGER;
    if (cat.includes("pizza") || cat.includes("italian")) return DEFAULT_PIZZA;
    if (cat.includes("shop") || cat.includes("grocer") || cat.includes("supermarket")) return DEFAULT_HABESHA;
    return DEFAULT_HABESHA;
  };

  const resolvedSource = () => {
    if (hasError || !source) {
      return getCategorizedFallback();
    }
    if (typeof source === "string") {
      if (source.startsWith("http://") || source.startsWith("https://")) {
        return { uri: source, cache: "force-cache" };
      }
      return getCategorizedFallback();
    }
    if (typeof source === "object" && source.uri) {
      if (typeof source.uri === "string" && source.uri.trim().length > 0) {
        return { ...source, cache: source.cache || "force-cache" };
      }
      return getCategorizedFallback();
    }
    return source || getCategorizedFallback();
  };

  const fallbackAsset = getCategorizedFallback();

  return (
    <View style={[styles.container, style]}>
      <Image
        {...props}
        source={resolvedSource()}
        defaultSource={typeof fallbackAsset === "number" ? fallbackAsset : undefined}
        style={[StyleSheet.absoluteFillObject, style]}
        resizeMode={resizeMode}
        onError={() => setHasError(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
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

