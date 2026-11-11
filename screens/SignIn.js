import React, { useState, useEffect, useRef } from "react";
import {
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Text,
  View,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { StatusBar } from "expo-status-bar";
import { UserAuth, formatAuthError } from "../contexts/AuthContext";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "../firebase";
import BackButton from "../components/ui/BackButton";
import {
  checkBiometricSupport,
  isBiometricEnabled,
  saveBiometricCredentials,
} from "../services/biometricService";

const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";

export default function SignIn() {
  const navigation = useNavigation();
  const route = useRoute();
  const { signInUser, refreshProfile } = UserAuth();

  const [identifier, setIdentifier] = useState(route.params?.prefillPhone || "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [bioAvailable, setBioAvailable] = useState(false);
  const [phoneAutoFilled, setPhoneAutoFilled] = useState(false);

  const passwordRef = useRef(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetNotice, setResetNotice] = useState("");

  // Forgot password. Reset emails only go to a real email address. Phone-only accounts use an
  // internal address that can't receive mail, so they're pointed to support instead.
  const onForgotPassword = async () => {
    if (resetBusy) return;
    setErrorMessage("");
    setResetNotice("");
    const input = identifier.trim();
    if (!input.includes("@") || input.endsWith("@login.mytruck.local")) {
      setErrorMessage(
        "Enter the email address on your account to reset your password. Phone-only accounts: contact MyTruck support on +251 911 223 344."
      );
      return;
    }
    setResetBusy(true);
    try {
      await sendPasswordResetEmail(auth, input.toLowerCase());
    } catch (e) {
      // Same message whether or not the account exists (no account enumeration)
      console.warn("Password reset note:", e?.code);
    } finally {
      setResetBusy(false);
      setResetNotice("If an account exists for that email, a reset link has been sent. Check your inbox and spam folder.");
    }
  };

  useEffect(() => {
    (async () => {
      try {
        if (!identifier) {
          const savedPhone = await AsyncStorage.getItem("@mytruck_last_phone");
          if (savedPhone) {
            setIdentifier(savedPhone);
            setPhoneAutoFilled(true);
            // Auto-focus password field since phone is already known
            setTimeout(() => { passwordRef.current?.focus(); }, 400);
          }
        } else {
          // Phone was passed via route.params (prefillPhone) — also treat as auto-filled
          setPhoneAutoFilled(true);
          setTimeout(() => { passwordRef.current?.focus(); }, 400);
        }
        const enabled = await isBiometricEnabled();
        setBioAvailable(enabled);
      } catch (_) {}
    })();
  }, []);

  const onSignIn = async () => {
    if (busy) return;
    setErrorMessage("");

    const input = identifier.trim();
    if (!input) {
      setErrorMessage("Enter your phone number (e.g. 0912345678) or email.");
      return;
    }
    if (!password) {
      setErrorMessage("Enter your password.");
      return;
    }

    setBusy(true);

    try {
      await signInUser(input, password);
      const profile = await refreshProfile();

      // Persist existing customer indicator & last phone
      try {
        await AsyncStorage.setItem("@mytruck_has_account", "true");
        if (input.replace(/\D/g, "").length >= 9) {
          await AsyncStorage.setItem("@mytruck_last_phone", input);
        }
      } catch (_) {}

      // Silently update biometric credentials if already enabled by user
      try {
        const enabled = await isBiometricEnabled();
        if (enabled) {
          await saveBiometricCredentials({
            identifier: input,
            credential: password,
            name: profile?.fullName || profile?.firstName || "User",
            role: profile?.role || "customer",
          }).catch(() => {});
        }
      } catch (_) {}
      // RootNavigator auth state listener handles safe transition to AppStack
    } catch (error) {
      console.warn("Sign-in error:", error?.code, error?.message);
      const friendly = formatAuthError(error, "Could not sign in. Please check your credentials and try again.");
      setErrorMessage(friendly);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.root}>
      <StatusBar style="light" backgroundColor={TEAL} />

      {/* Enhanced Teal Header matching My Orders */}
      <View style={s.headerOuter}>
        <SafeAreaView edges={["top"]} style={s.safeTop}>
          <View style={s.topNav}>
            <BackButton fallbackRoute="Welcome" iconColor="white" />
            <View style={s.headerCenter}>
              <Text style={s.navTitle}>Sign In</Text>
              <Text style={s.navSub}>Welcome back to MyTruck</Text>
            </View>
            <View style={{ width: 40 }} />
          </View>
        </SafeAreaView>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Logo & Brand */}
          <View style={s.brandWrap}>
            <Image
              source={require("../assets/icon.png")}
              style={s.logo}
              resizeMode="contain"
            />
            <Text style={s.title}>Welcome Back</Text>
            <Text style={s.subtitle}>
              Sign in with your phone number or account
            </Text>
          </View>

          {/* Form Card */}
          <View style={s.card}>
            {/* Phone / Email Input */}
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
              <Text style={s.label}>Phone Number or Email</Text>
              {phoneAutoFilled && (
                <View style={{ flexDirection: "row", alignItems: "center", marginLeft: 8, backgroundColor: "#D1FAE5", borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 }}>
                  <MaterialCommunityIcons name="check-circle-outline" size={12} color="#065F46" />
                  <Text style={{ fontSize: 10.5, color: "#065F46", fontWeight: "700", marginLeft: 3 }}>Remembered</Text>
                </View>
              )}
            </View>
            <View style={s.inputWrap}>
              <MaterialCommunityIcons
                name="account-outline"
                size={20}
                color={TEAL}
                style={s.inputIcon}
              />
              <TextInput
                style={s.input}
                placeholder="Phone (09XXXXXXXX) or Email"
                placeholderTextColor="#94A3B8"
                value={identifier}
                onChangeText={(t) => {
                  setIdentifier(t);
                  setPhoneAutoFilled(false);
                  if (errorMessage) setErrorMessage("");
                }}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
              {phoneAutoFilled && identifier ? (
                <TouchableOpacity
                  onPress={() => { setIdentifier(""); setPhoneAutoFilled(false); }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityLabel="Clear saved phone number"
                >
                  <MaterialCommunityIcons name="close-circle" size={20} color="#94A3B8" />
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Password Input */}
            <Text style={[s.label, { marginTop: 4 }]}>Password</Text>
            <View style={s.inputWrap}>
              <MaterialCommunityIcons
                name="lock-outline"
                size={20}
                color={TEAL}
                style={s.inputIcon}
              />
              <TextInput
                ref={passwordRef}
                style={s.input}
                placeholder="Your password"
                placeholderTextColor="#94A3B8"
                value={password}
                onChangeText={(t) => {
                  setPassword(t);
                  if (errorMessage) setErrorMessage("");
                }}
                secureTextEntry={!showPassword}
                returnKeyType="done"
                onSubmitEditing={onSignIn}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(!showPassword)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialCommunityIcons
                  name={showPassword ? "eye-off-outline" : "eye-outline"}
                  size={20}
                  color="#94A3B8"
                />
              </TouchableOpacity>
            </View>

            {errorMessage ? (
              <View style={s.errorBox}>
                <MaterialCommunityIcons
                  name="alert-circle-outline"
                  size={16}
                  color="#DC2626"
                />
                <Text style={s.errorTxt}>{errorMessage}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              onPress={onForgotPassword}
              disabled={resetBusy}
              style={{ alignSelf: "flex-end", marginTop: 8, paddingVertical: 6 }}
              accessibilityRole="button"
            >
              <Text style={{ fontSize: 13, fontWeight: "700", color: TEAL }}>
                {resetBusy ? "Sending…" : "Forgot password?"}
              </Text>
            </TouchableOpacity>
            {resetNotice ? <Text style={{ fontSize: 12.5, color: "#166534", marginTop: 6 }}>{resetNotice}</Text> : null}

            {/* Sign In Button */}
            <TouchableOpacity
              style={[s.signInBtn, busy && { opacity: 0.7 }]}
              onPress={onSignIn}
              disabled={busy}
              activeOpacity={0.88}
            >
              {busy ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={s.signInBtnTxt}>Sign In</Text>
              )}
            </TouchableOpacity>

            {/* Biometric Quick Login Button (when enabled) */}
            {bioAvailable && (
              <TouchableOpacity
                style={s.bioQuickBtn}
                onPress={() => navigation.navigate("BiometricWelcome")}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="fingerprint" size={20} color={TEAL} style={{ marginRight: 8 }} />
                <Text style={s.bioQuickBtnTxt}>Sign In with Fingerprint</Text>
              </TouchableOpacity>
            )}

            {/* SMS-code sign-in disabled for security (see AuthContext.signInWithOtp) */}
          </View>

          {/* New to MyTruck */}
          <View style={s.footerRow}>
            <Text style={s.footerTxt}>New to MyTruck? </Text>
            <TouchableOpacity onPress={() => navigation.navigate("SignUp")}>
              <Text style={s.signUpLink}>Create Account</Text>
            </TouchableOpacity>
          </View>

          {/* Business registration */}
          <TouchableOpacity
            onPress={() => navigation.navigate("SellerApply")}
            style={{ marginTop: 14, paddingVertical: 8, alignItems: "center" }}
          >
            <Text style={{ fontSize: 13, color: TEAL, fontWeight: "600" }}>
              Want to sell? Apply as a Restaurant or Shop Partner
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#F5FAF9",
  },
  headerOuter: {
    backgroundColor: "#F5FAF9",
  },
  safeTop: {
    backgroundColor: TEAL,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    shadowColor: "#0B2A26",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 6,
  },
  topNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
    backgroundColor: TEAL,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  headerCenter: {
    flex: 1,
    marginLeft: 12,
  },
  navTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  navSub: {
    fontSize: 12,
    color: "rgba(255,255,255,0.85)",
    marginTop: 2,
  },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
  },
  brandWrap: {
    alignItems: "center",
    marginBottom: 24,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 20,
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: "900",
    color: DARK,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: "#64748B",
    textAlign: "center",
  },
  card: {
    backgroundColor: "white",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "#E6ECEB",
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: DARK,
    marginBottom: 6,
    marginTop: 4,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
    marginBottom: 14,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: DARK,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FCA5A5",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 14,
  },
  errorTxt: {
    color: "#DC2626",
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 6,
    flex: 1,
  },
  signInBtn: {
    backgroundColor: TEAL,
    borderRadius: 14,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
    elevation: 2,
    shadowColor: TEAL,
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
  },
  signInBtnTxt: {
    color: "white",
    fontSize: 15,
    fontWeight: "800",
  },
  bioQuickBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E6F4F1",
    borderWidth: 1.5,
    borderColor: "#CCFBF1",
    borderRadius: 14,
    height: 48,
    marginTop: 10,
  },
  bioQuickBtnTxt: {
    color: TEAL,
    fontSize: 14,
    fontWeight: "800",
  },
  phoneOtpBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F0FDFA",
    borderWidth: 1.5,
    borderColor: "#99F6E4",
    borderRadius: 14,
    height: 48,
    marginTop: 10,
  },
  phoneOtpBtnTxt: {
    color: TEAL,
    fontSize: 14,
    fontWeight: "800",
  },
  bioQuickBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E6F4F1",
    borderWidth: 1.5,
    borderColor: "#CCFBF1",
    borderRadius: 14,
    height: 48,
    marginTop: 10,
  },
  bioQuickBtnTxt: {
    color: TEAL,
    fontSize: 14,
    fontWeight: "800",
  },
  phoneOtpBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F0FDFA",
    borderWidth: 1.5,
    borderColor: "#99F6E4",
    borderRadius: 14,
    height: 48,
    marginTop: 10,
  },
  phoneOtpBtnTxt: {
    color: TEAL,
    fontSize: 14,
    fontWeight: "800",
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 24,
  },
  footerTxt: {
    fontSize: 13,
    color: "#64748B",
  },
  signUpLink: {
    fontSize: 13,
    fontWeight: "800",
    color: ORANGE,
  },
});
