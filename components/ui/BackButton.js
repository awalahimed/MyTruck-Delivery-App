import React, { useRef } from "react";
import { TouchableOpacity, Animated, StyleSheet, Platform } from "react-native";
import { ArrowLeftIcon } from "react-native-heroicons/solid";
import { useNavigation } from "@react-navigation/native";
import { UserAuth } from "../../contexts/AuthContext";
import { getRoleInfo, homeRouteFor } from "../../utils/roles";

const TEAL = "#179B83";
const DARK = "#0B2A26";

/**
 * Premium Reusable Back Button for MyTruck Delivery.
 * 
 * Automatically checks navigation history:
 * - If canGoBack() is true, smoothly navigates back.
 * - If false, gracefully redirects to the user's role-appropriate home screen.
 * - Handles press animation, proper hitSlop, safe-area alignment, and accessibility.
 */
export default function BackButton({
  onPress,
  fallbackRoute,
  style,
  size = 20,
  color = TEAL,
  variant = "white", // "white" | "teal" | "dark" | "transparent"
  accessibilityLabel = "Go back",
}) {
  const navigation = useNavigation();
  let dbUser = null;
  let authUser = null;
  try {
    const auth = UserAuth();
    dbUser = auth?.dbUser;
    authUser = auth?.user;
  } catch (_) {}
  // Where "home" is for this account (drivers/stores/admins have their own dashboards)
  const roleHome = homeRouteFor(getRoleInfo(authUser, dbUser));
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.92,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 40,
      bounciness: 8,
    }).start();
  };

  const handlePress = () => {
    if (typeof onPress === "function") {
      onPress();
      return;
    }

    // 1. Try standard stack goBack() first
    try {
      if (navigation && typeof navigation.canGoBack === "function" && navigation.canGoBack()) {
        navigation.goBack();
        return;
      }
    } catch (_) {}

    // 2. Fallback route handling (nested-aware for React Navigation v6)
    // Non-customers never fall back into the customer app
    if (roleHome !== "Home" && (!fallbackRoute || fallbackRoute === "HomeTab" || fallbackRoute === "Home")) {
      try { navigation.navigate(roleHome); return; } catch (_) {}
    }
    if (fallbackRoute) {
      if (fallbackRoute === "HomeTab" || fallbackRoute === "Home") {
        try {
          navigation.navigate("Home", { screen: "HomeTab" });
          return;
        } catch (_) {}
        try {
          navigation.navigate("HomeTab");
          return;
        } catch (_) {}
        try {
          navigation.navigate("Home");
          return;
        } catch (_) {}
      } else {
        try {
          navigation.navigate(fallbackRoute);
          return;
        } catch (_) {}
      }
    }

    // 3. Role-specific fallback navigation
    const role = (dbUser?.role || "").toLowerCase().trim();
    if (role === "driver") {
      try { navigation.navigate("DriverDashboard"); return; } catch (_) {}
    }
    if (role === "restaurant" || role === "shop" || role === "pendingSeller") {
      try { navigation.navigate("SellerHome"); return; } catch (_) {}
    }
    // For admin or customer, gracefully return to Customer Home
    try { navigation.navigate("Home"); return; } catch (_) {}

    // 4. Default: Customer Home
    try {
      navigation.navigate("Home", { screen: "HomeTab" });
      return;
    } catch (_) {}
    try {
      navigation.navigate("Home");
      return;
    } catch (_) {}
    try {
      navigation.navigate("HomeTab");
      return;
    } catch (_) {}
  };

  const bgStyle =
    variant === "teal"
      ? s.bgTeal
      : variant === "dark"
      ? s.bgDark
      : variant === "transparent"
      ? s.bgTransparent
      : s.bgWhite;

  const iconColor =
    variant === "teal" || variant === "dark"
      ? "white"
      : color;

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, style]}>
      <TouchableOpacity
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={[s.btn, bgStyle]}
      >
        <ArrowLeftIcon size={size} color={iconColor} />
      </TouchableOpacity>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.12,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  bgWhite: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E6ECEB",
  },
  bgTeal: {
    backgroundColor: TEAL,
  },
  bgDark: {
    backgroundColor: DARK,
  },
  bgTransparent: {
    backgroundColor: "rgba(255,255,255,0.85)",
    borderWidth: 1,
    borderColor: "rgba(23,155,131,0.2)",
  },
});
