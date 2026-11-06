import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Dimensions,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import {
  checkBiometricSupport,
  isBiometricEnabled,
  getSavedBiometricAccount,
  retrieveBiometricCredentials,
  authenticateWithBiometrics,
  recordBiometricLoginSuccess,
} from "../services/biometricService";
import { UserAuth } from "../contexts/AuthContext";

const { width } = Dimensions.get("window");
const TEAL = "#179B83";
const TEAL_LIGHT = "#2DD4BF";
const DARK = "#0B2A26";
const DARK_SURFACE = "#123833";
const ORANGE = "#F47721";

export default function BiometricWelcomeScreen({ navigation }) {
  const { signInUser, refreshProfile } = UserAuth();

  const [checking, setChecking] = useState(true);
  const [hasBiometrics, setHasBiometrics] = useState(false);
  const [savedAccount, setSavedAccount] = useState(null);
  const [authenticating, setAuthenticating] = useState(false);
  const [authStatusText, setAuthStatusText] = useState("");
  const [authError, setAuthError] = useState("");

  // Animations
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const ringScale = useRef(new Animated.Value(1)).current;
  const ringOpacity = useRef(new Animated.Value(0.6)).current;

  // Pulse animation for fingerprint icon
  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(ringScale, {
            toValue: 1.4,
            duration: 1800,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(ringOpacity, {
            toValue: 0,
            duration: 1800,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(ringScale, {
            toValue: 1,
            duration: 0,
            useNativeDriver: true,
          }),
          Animated.timing(ringOpacity, {
            toValue: 0.6,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    pulseLoop.start();
    return () => pulseLoop.stop();
  }, [ringScale, ringOpacity]);

  // Entrance animation
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  // Initial check on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [support, enabled, account] = await Promise.all([
          checkBiometricSupport(),
          isBiometricEnabled(),
          getSavedBiometricAccount(),
        ]);

        if (mounted) {
          if (support.isReady && enabled && account) {
            setHasBiometrics(true);
            setSavedAccount(account);
          } else {
            setHasBiometrics(false);
            setSavedAccount(null);
          }
          setChecking(false);
        }
      } catch (err) {
        if (mounted) {
          setHasBiometrics(false);
          setChecking(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const handleFingerprintLogin = async () => {
    if (authenticating) return;
    setAuthError("");
    setAuthenticating(true);
    setAuthStatusText("Scan your fingerprint to unlock...");

    try {
      // 1. Native OS Biometric Prompt
      const authResult = await authenticateWithBiometrics(
        "Scan fingerprint to sign in to MyTruck"
      );

      if (!authResult.success) {
        if (authResult.cancelled) {
          setAuthenticating(false);
          setAuthStatusText("");
          return;
        }
        setAuthError(authResult.error || "Biometric authentication was not recognized.");
        setAuthenticating(false);
        setAuthStatusText("");
        return;
      }

      // 2. Retrieve Keystore-protected credentials
      setAuthStatusText("Securing session...");
      const saved = await retrieveBiometricCredentials();
      if (!saved || !saved.identifier || !saved.credential) {
        setAuthError("No valid biometric credential found. Please sign in with password.");
        setAuthenticating(false);
        setAuthStatusText("");
        return;
      }

      // 3. Authenticate with backend
      setAuthStatusText("Authenticating with backend...");
      await signInUser(saved.identifier, saved.credential);

      // 4. Load authoritative profile and verify roles
      setAuthStatusText("Initializing workspace...");
      await refreshProfile();
      await recordBiometricLoginSuccess();

      // Navigation is automatically handled by RootNavigator observing user & dbUser state
    } catch (err) {
      console.warn("Biometric login failure:", err?.message);
      let msg = "Could not sign in with fingerprint. Please use password.";
      if (err?.code === "auth/wrong-password") {
        msg = "Account password was updated. Please sign in with your new password.";
      } else if (err?.code === "auth/user-not-found") {
        msg = "User account not found. Please sign in again.";
      } else if (err?.code === "auth/network-request-failed") {
        msg = "Network connection failed. Check your internet connection.";
      }
      setAuthError(msg);
    } finally {
      setAuthenticating(false);
      setAuthStatusText("");
    }
  };

  const handleUsePassword = () => {
    navigation.navigate("SignIn");
  };

  if (checking) {
    return (
      <View style={[styles.root, styles.center]}>
        <StatusBar style="light" backgroundColor={DARK} />
        <ActivityIndicator size="large" color={TEAL} />
      </View>
    );
  }

  const displayName = savedAccount?.name ? savedAccount.name.split(" ")[0] : null;

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <StatusBar style="light" backgroundColor={DARK} />

      <Animated.View
        style={[
          styles.container,
          { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
        ]}
      >
        {/* Header Branding */}
        <View style={styles.brandRow}>
          <Image
            source={require("../assets/icon.png")}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.brandTitle}>MYTRUCK</Text>
        </View>

        {/* Central Biometric Section */}
        <View style={styles.centerSection}>
          <View style={styles.scannerOuter}>
            {/* Animated Pulsing Ring */}
            {hasBiometrics && (
              <Animated.View
                style={[
                  styles.pulseRing,
                  {
                    transform: [{ scale: ringScale }],
                    opacity: ringOpacity,
                  },
                ]}
              />
            )}

            {/* Main Scanner Circle */}
            <TouchableOpacity
              style={[
                styles.scannerCircle,
                authenticating && styles.scannerCircleActive,
              ]}
              onPress={hasBiometrics ? handleFingerprintLogin : handleUsePassword}
              activeOpacity={0.85}
              disabled={authenticating}
            >
              <MaterialCommunityIcons
                name={hasBiometrics ? "fingerprint" : "lock-outline"}
                size={76}
                color={hasBiometrics ? TEAL_LIGHT : "white"}
              />
            </TouchableOpacity>
          </View>

          {/* Headings */}
          <Text style={styles.heading}>
            {displayName ? `Welcome back, ${displayName}` : "Welcome Back"}
          </Text>
          <Text style={styles.subtext}>
            {hasBiometrics
              ? "Securely access your MyTruck account with your fingerprint."
              : "Sign in to access your MyTruck account."}
          </Text>

          {/* Status / Error Messages */}
          {authenticating ? (
            <View style={styles.statusWrap}>
              <ActivityIndicator size="small" color={TEAL_LIGHT} style={{ marginRight: 8 }} />
              <Text style={styles.statusTxt}>{authStatusText}</Text>
            </View>
          ) : authError ? (
            <View style={styles.errorBox}>
              <MaterialCommunityIcons name="alert-circle-outline" size={16} color="#F87171" style={{ marginRight: 6 }} />
              <Text style={styles.errorTxt}>{authError}</Text>
            </View>
          ) : (
            <View style={{ height: 28 }} />
          )}
        </View>

        {/* Action Controls */}
        <View style={styles.actionsWrap}>
          {hasBiometrics ? (
            <>
              {/* Primary: Sign In with Fingerprint */}
              <TouchableOpacity
                style={[styles.primaryBtn, authenticating && { opacity: 0.7 }]}
                onPress={handleFingerprintLogin}
                disabled={authenticating}
                activeOpacity={0.88}
              >
                {authenticating ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <View style={styles.btnContent}>
                    <MaterialCommunityIcons
                      name="fingerprint"
                      size={22}
                      color="white"
                      style={{ marginRight: 10 }}
                    />
                    <Text style={styles.primaryBtnTxt}>Sign In with Fingerprint</Text>
                  </View>
                )}
              </TouchableOpacity>

              {/* Secondary: Sign in with Password */}
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={handleUsePassword}
                disabled={authenticating}
                activeOpacity={0.8}
              >
                <Text style={styles.secondaryBtnTxt}>Sign in with Password</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              {/* Primary: Sign In with Password */}
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={handleUsePassword}
                activeOpacity={0.88}
              >
                <View style={styles.btnContent}>
                  <MaterialCommunityIcons
                    name="login"
                    size={20}
                    color="white"
                    style={{ marginRight: 8 }}
                  />
                  <Text style={styles.primaryBtnTxt}>Sign in with Password</Text>
                </View>
              </TouchableOpacity>

              {/* Create Account link */}
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => navigation.navigate("SignUp")}
                activeOpacity={0.8}
              >
                <Text style={styles.secondaryBtnTxt}>Create New Account</Text>
              </TouchableOpacity>
            </>
          )}

          {/* Switch Account */}
          {hasBiometrics && (
            <TouchableOpacity
              style={styles.switchAccountBtn}
              onPress={() => navigation.navigate("SignIn")}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.switchAccountTxt}>Switch Account</Text>
            </TouchableOpacity>
          )}
        </View>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: DARK,
  },
  center: {
    justifyContent: "center",
    alignItems: "center",
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: "space-between",
    paddingTop: 16,
    paddingBottom: 24,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  logo: {
    width: 38,
    height: 38,
    borderRadius: 10,
    marginRight: 10,
  },
  brandTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: 2,
  },
  centerSection: {
    alignItems: "center",
    marginVertical: "auto",
  },
  scannerOuter: {
    width: 140,
    height: 140,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 32,
    position: "relative",
  },
  pulseRing: {
    position: "absolute",
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 2,
    borderColor: TEAL,
    backgroundColor: "rgba(23, 155, 131, 0.12)",
  },
  scannerCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: DARK_SURFACE,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(45, 212, 191, 0.35)",
    shadowColor: TEAL,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  scannerCircleActive: {
    borderColor: TEAL_LIGHT,
    backgroundColor: "#164E44",
  },
  heading: {
    fontSize: 24,
    fontWeight: "800",
    color: "#FFFFFF",
    textAlign: "center",
    marginBottom: 8,
  },
  subtext: {
    fontSize: 14,
    color: "#94A3B8",
    textAlign: "center",
    maxWidth: 280,
    lineHeight: 20,
  },
  statusWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(45, 212, 191, 0.12)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 18,
    borderWidth: 1,
    borderColor: "rgba(45, 212, 191, 0.25)",
  },
  statusTxt: {
    fontSize: 13,
    color: TEAL_LIGHT,
    fontWeight: "600",
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 14,
    marginTop: 18,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
    maxWidth: width - 64,
  },
  errorTxt: {
    fontSize: 12,
    color: "#FCA5A5",
    fontWeight: "600",
    flexShrink: 1,
  },
  actionsWrap: {
    width: "100%",
    paddingBottom: 8,
  },
  primaryBtn: {
    backgroundColor: TEAL,
    height: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: TEAL,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    marginBottom: 12,
  },
  btnContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnTxt: {
    color: "white",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  secondaryBtn: {
    height: 50,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.15)",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  secondaryBtnTxt: {
    color: "#E2E8F0",
    fontSize: 15,
    fontWeight: "700",
  },
  switchAccountBtn: {
    alignItems: "center",
    marginTop: 14,
    paddingVertical: 6,
  },
  switchAccountTxt: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
});

