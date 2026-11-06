import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  Image,
  StyleSheet,
  Animated,
  Dimensions,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

const { width } = Dimensions.get("window");
const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";

// Official MyTruck Logo and Delivery Assets
const APP_ICON = require("../assets/icon.png");

export default function AnimatedSplash({ onFinish, message = "Initializing MyTruck..." }) {
  const glowAnim = useRef(new Animated.Value(0.4)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const truckTranslate = useRef(new Animated.Value(-24)).current;

  useEffect(() => {
    // Fade in entrance
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();

    // Subtle glow & pulse animation
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(glowAnim, {
            toValue: 0.9,
            duration: 1100,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1.06,
            duration: 1100,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(glowAnim, {
            toValue: 0.4,
            duration: 1100,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1100,
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    pulseLoop.start();

    // Delivery vehicle glide motion
    const truckLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(truckTranslate, {
          toValue: 24,
          duration: 1400,
          useNativeDriver: true,
        }),
        Animated.timing(truckTranslate, {
          toValue: -24,
          duration: 1400,
          useNativeDriver: true,
        }),
      ])
    );
    truckLoop.start();

    // Progress bar fill animation
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 2200,
      useNativeDriver: false,
    }).start(() => {
      if (onFinish) onFinish();
    });

    return () => {
      pulseLoop.stop();
      truckLoop.stop();
    };
  }, []);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["10%", "96%"],
  });

  return (
    <View style={s.root}>
      <StatusBar style="light" backgroundColor={DARK} />

      <Animated.View style={[s.content, { opacity: fadeAnim }]}>
        {/* Top: App Logo with Glowing Aura */}
        <View style={s.logoContainer}>
          <Animated.View
            style={[
              s.logoGlow,
              {
                opacity: glowAnim,
                transform: [{ scale: pulseAnim }],
              },
            ]}
          />
          <Image source={APP_ICON} style={s.appLogo} resizeMode="contain" />
          <Text style={s.brandTitle}>
            My<Text style={{ color: ORANGE }}>Truck</Text>
          </Text>
        </View>

        {/* Center: Pure Native Delivery Animation */}
        <View style={s.centerAnimWrap}>
          <Animated.View
            style={[
              s.deliveryCircle,
              {
                transform: [{ scale: pulseAnim }],
              },
            ]}
          >
            <Animated.View style={{ transform: [{ translateX: truckTranslate }] }}>
              <MaterialCommunityIcons name="truck-fast" size={56} color="#FFFFFF" />
            </Animated.View>
          </Animated.View>
          <View style={s.speedLinesRow}>
            <View style={[s.speedLine, { width: 28 }]} />
            <View style={[s.speedLine, { width: 44, marginHorizontal: 6 }]} />
            <View style={[s.speedLine, { width: 20 }]} />
          </View>
        </View>

        {/* Bottom: Tagline & Progress Bar */}
        <Text style={s.tagline}>Fast, Reliable Delivery Across Ethiopia</Text>

        <View style={s.progressTrack}>
          <Animated.View style={[s.progressBar, { width: progressWidth }]} />
        </View>

        <Text style={s.loadingStatus}>{message}</Text>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: DARK,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    paddingHorizontal: 28,
  },
  logoContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    position: "relative",
  },
  logoGlow: {
    position: "absolute",
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: "rgba(23, 155, 131, 0.4)",
    shadowColor: TEAL,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 30,
    elevation: 16,
  },
  appLogo: {
    width: 76,
    height: 76,
    borderRadius: 20,
    marginBottom: 10,
    elevation: 10,
  },
  brandTitle: {
    fontSize: 32,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: -0.5,
  },
  centerAnimWrap: {
    width: "100%",
    height: 160,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 10,
  },
  deliveryCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: TEAL,
    alignItems: "center",
    justifyContent: "center",
    elevation: 12,
    shadowColor: TEAL,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    borderWidth: 3,
    borderColor: "rgba(255, 255, 255, 0.3)",
    marginBottom: 14,
  },
  speedLinesRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  speedLine: {
    height: 3,
    backgroundColor: "rgba(23, 155, 131, 0.6)",
    borderRadius: 2,
  },
  tagline: {
    fontSize: 13,
    color: "rgba(255, 255, 255, 0.8)",
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 24,
    letterSpacing: 0.2,
  },
  progressTrack: {
    width: width * 0.68,
    height: 6,
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 12,
  },
  progressBar: {
    height: "100%",
    backgroundColor: ORANGE,
    borderRadius: 3,
  },
  loadingStatus: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.7)",
    fontWeight: "600",
  },
});
