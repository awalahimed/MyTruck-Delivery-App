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
  Modal,
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
  const [forgotModalVisible, setForgotModalVisible] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetSuccess, setResetSuccess] = useState(false);

  // Forgot password modal opener
  const openForgotPasswordModal = () => {
    setResetEmail(identifier.includes("@") ? identifier.trim() : "");
    setResetError("");
    setResetSuccess(false);
    setForgotModalVisible(true);
  };

  const handleSendResetEmail = async () => {
    const clean = resetEmail.trim().toLowerCase();
    if (!clean || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      setResetError("Please enter a valid email address.");
      return;
    }
    if (clean.endsWith("@login.mytruck.local")) {
      setResetError("Phone-only accounts cannot receive email. Please contact MyTruck support on +251 911 223 344.");
      return;
    }
    setResetBusy(true);
    setResetError("");
    try {
      await sendPasswordResetEmail(auth, clean);
      setResetSuccess(true);
    } catch (e) {
      console.warn("Password reset note:", e?.code);
      if (e?.code === "auth/invalid-email") {
        setResetError("Invalid email address format.");
      } else if (e?.code === "auth/too-many-requests") {
        setResetError("Too many attempts. Please wait a few minutes before trying again.");
      } else {
        // Protect against account enumeration while giving clear confirmation
        setResetSuccess(true);
      }
    } finally {
      setResetBusy(false);
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
              onPress={openForgotPasswordModal}
              style={{ alignSelf: "flex-end", marginTop: 8, paddingVertical: 6 }}
              accessibilityRole="button"
            >
              <Text style={{ fontSize: 13, fontWeight: "700", color: TEAL }}>
                Forgot password?
              </Text>
            </TouchableOpacity>

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

      {/* Forgot Password Modal */}
      <Modal
        visible={forgotModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setForgotModalVisible(false)}
      >
        <View style={s.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={s.modalCentered}
          >
            <View style={s.modalCard}>
              <TouchableOpacity
                style={s.modalCloseBtn}
                onPress={() => setForgotModalVisible(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <MaterialCommunityIcons name="close" size={22} color="#64748B" />
              </TouchableOpacity>

              {resetSuccess ? (
                <View style={{ alignItems: "center", paddingVertical: 10 }}>
                  <View style={s.modalSuccessIconWrap}>
                    <MaterialCommunityIcons name="email-check" size={36} color={TEAL} />
                  </View>
                  <Text style={s.modalTitle}>Check Your Inbox</Text>
                  <Text style={s.modalDesc}>
                    If an account is associated with <Text style={{ fontWeight: "700", color: DARK }}>{resetEmail.trim()}</Text>, we've sent a link to reset your password.
                  </Text>
                  <Text style={[s.modalDesc, { marginTop: 8, fontSize: 12, color: "#64748B" }]}>
                    Be sure to check your spam/junk folder if you don't see it within a couple minutes.
                  </Text>

                  <TouchableOpacity
                    style={[s.modalPrimaryBtn, { marginTop: 22 }]}
                    onPress={() => setForgotModalVisible(false)}
                  >
                    <Text style={s.modalPrimaryBtnTxt}>Back to Sign In</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View>
                  <View style={{ alignItems: "center", marginBottom: 16 }}>
                    <View style={s.modalIconWrap}>
                      <MaterialCommunityIcons name="lock-reset" size={32} color={TEAL} />
                    </View>
                    <Text style={s.modalTitle}>Reset Your Password</Text>
                    <Text style={s.modalDesc}>
                      Enter the email address linked to your MyTruck account to receive a secure password reset link.
                    </Text>
                  </View>

                  <Text style={s.modalInputLabel}>Email Address</Text>
                  <View style={s.modalInputWrap}>
                    <MaterialCommunityIcons name="email-outline" size={20} color={TEAL} style={{ marginRight: 10 }} />
                    <TextInput
                      style={s.modalInput}
                      placeholder="e.g. name@example.com"
                      placeholderTextColor="#94A3B8"
                      value={resetEmail}
                      onChangeText={(t) => {
                        setResetEmail(t);
                        if (resetError) setResetError("");
                      }}
                      autoCapitalize="none"
                      keyboardType="email-address"
                      autoCorrect={false}
                      autoFocus={true}
                      returnKeyType="done"
                      onSubmitEditing={handleSendResetEmail}
                    />
                  </View>

                  {resetError ? (
                    <View style={s.modalErrorBox}>
                      <MaterialCommunityIcons name="alert-circle-outline" size={16} color="#DC2626" />
                      <Text style={s.modalErrorTxt}>{resetError}</Text>
                    </View>
                  ) : null}

                  <TouchableOpacity
                    style={[s.modalPrimaryBtn, resetBusy && { opacity: 0.7 }]}
                    onPress={handleSendResetEmail}
                    disabled={resetBusy}
                    activeOpacity={0.88}
                  >
                    {resetBusy ? (
                      <ActivityIndicator color="white" />
                    ) : (
                      <Text style={s.modalPrimaryBtnTxt}>Send Reset Link</Text>
                    )}
                  </TouchableOpacity>

                  <View style={s.modalSupportNotice}>
                    <MaterialCommunityIcons name="phone-outline" size={14} color="#64748B" style={{ marginRight: 4 }} />
                    <Text style={s.modalSupportTxt}>
                      Phone-only account? Call support: <Text style={{ fontWeight: "700" }}>+251 911 223 344</Text>
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(11, 42, 38, 0.65)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalCentered: {
    width: "100%",
    maxWidth: 400,
  },
  modalCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 10,
    position: "relative",
  },
  modalCloseBtn: {
    position: "absolute",
    top: 18,
    right: 18,
    zIndex: 10,
    padding: 4,
  },
  modalIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#E6F4F1",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  modalSuccessIconWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: "#DCFCE7",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: DARK,
    textAlign: "center",
    marginBottom: 6,
  },
  modalDesc: {
    fontSize: 13.5,
    color: "#475569",
    textAlign: "center",
    lineHeight: 19,
    paddingHorizontal: 8,
  },
  modalInputLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: DARK,
    marginBottom: 6,
    marginTop: 4,
  },
  modalInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 50,
  },
  modalInput: {
    flex: 1,
    fontSize: 15,
    color: DARK,
  },
  modalErrorBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
    gap: 6,
  },
  modalErrorTxt: {
    fontSize: 12.5,
    color: "#DC2626",
    flex: 1,
  },
  modalPrimaryBtn: {
    backgroundColor: TEAL,
    borderRadius: 14,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
    shadowColor: TEAL,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  modalPrimaryBtnTxt: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  modalSupportNotice: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  modalSupportTxt: {
    fontSize: 11.5,
    color: "#64748B",
  },
});
