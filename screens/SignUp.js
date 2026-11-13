import React, { useState, useEffect } from "react";
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
import { useNavigation } from "@react-navigation/native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { StatusBar } from "expo-status-bar";
import { UserAuth, normalizeEthiopianPhone, formatAuthError } from "../contexts/AuthContext";
import { verifySignupCode } from "../services/otpClient";
import BackButton from "../components/ui/BackButton";

const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";

export default function SignUp() {
  const navigation = useNavigation();
  const { registerCustomer, checkPhoneRegistered, requestOtp } = UserAuth();

  const [step, setStep] = useState("form"); // "form" | "otp"
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [countdown, setCountdown] = useState(60);
  const [normalizedPhone, setNormalizedPhone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // Countdown timer for OTP resend
  useEffect(() => {
    if (step !== "otp" || countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((c) => (c > 0 ? c - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [step, countdown]);

  const handlePhoneChange = (text) => {
    let digits = text.replace(/\D/g, "");
    if (digits.startsWith("251")) digits = digits.slice(3);
    if (digits.startsWith("0")) digits = digits.slice(1);
    setPhone(digits.slice(0, 9));
    if (errorMessage) setErrorMessage("");
  };

  // Step 1: Send OTP Verification Code
  const onSendOtp = async () => {
    if (busy) return;
    setErrorMessage("");

    if (!fullName.trim()) {
      setErrorMessage("Please enter your full name.");
      return;
    }

    const norm = normalizeEthiopianPhone(phone);
    if (!norm.isValid) {
      setErrorMessage(norm.error);
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErrorMessage("Enter a valid email address. You'll sign in with it and use it to reset your password.");
      return;
    }

    if (!password || password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setErrorMessage("Password must be at least 8 characters and include letters and numbers.");
      return;
    }

    setBusy(true);

    try {
      // 1. Check duplicate mobile registration
      const check = await checkPhoneRegistered(norm.localNumber);
      if (check.isRegistered) {
        setErrorMessage("This mobile number is already registered. Please sign in instead.");
        setBusy(false);
        return;
      }

      // 2. Dispatch real SMS OTP code
      await requestOtp(norm.intlNumber);
      setNormalizedPhone(norm);
      setStep("otp");
      setCountdown(60);
    } catch (error) {
      console.warn("Sign-up OTP request error:", error?.message);
      setErrorMessage(formatAuthError(error, "Could not send verification code. Please check your phone number."));
    } finally {
      setBusy(false);
    }
  };

  // Resend OTP Code
  const onResendOtp = async () => {
    if (countdown > 0 || busy || !normalizedPhone) return;
    setBusy(true);
    setErrorMessage("");
    try {
      await requestOtp(normalizedPhone.intlNumber);
      setCountdown(60);
      Alert.alert("Code Sent", "A new 6-digit verification code has been sent to your phone.");
    } catch (e) {
      setErrorMessage(e?.message || "Could not resend verification code.");
    } finally {
      setBusy(false);
    }
  };

  // Step 2: Verify OTP and Atomic Account Creation
  const onVerifyAndRegister = async () => {
    if (busy) return;
    setErrorMessage("");

    const cleanCode = String(otpCode).replace(/\D/g, "");
    if (cleanCode.length !== 6) {
      setErrorMessage("Please enter the 6-digit verification code sent to your phone.");
      return;
    }

    setBusy(true);

    try {
      // Server checks the code (attempts, expiry, single use) and returns a short-lived proof
      const proof = await verifySignupCode(normalizedPhone.intlNumber, cleanCode);

      // Creates the account, saves the profile and reserves the phone number.
      // Any failure undoes the account, so the customer can simply try again.
      await registerCustomer({
        fullName: fullName.trim(),
        phone: normalizedPhone.localNumber,
        password,
        email: email.trim(),
        proof,
      });

      // Navigation is automatic via RootNavigator once the profile is set
    } catch (error) {
      console.warn("Sign-up verification error:", error?.code, error?.message);
      const code = String(error?.code || "");
      if (code === "otp/taken" || code === "auth/email-already-in-use") {
        // Details on the first step are the problem: send them back to fix it
        setStep("form");
        setOtpCode("");
      }
      setErrorMessage(formatAuthError(error, "Verification failed. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.root}>
      <StatusBar style="light" backgroundColor={TEAL} />

      {/* Enhanced Teal Header matching My Orders & Sign In */}
      <View style={s.headerOuter}>
        <SafeAreaView edges={["top"]} style={s.safeTop}>
          <View style={s.topNav}>
            <BackButton
              fallbackRoute="Welcome"
              iconColor="white"
              onPress={() => {
                if (step === "otp") {
                  setStep("form");
                  setErrorMessage("");
                } else if (navigation.canGoBack()) {
                  navigation.goBack();
                } else {
                  navigation.navigate("Welcome");
                }
              }}
            />
            <View style={s.headerCenter}>
              <Text style={s.navTitle}>{step === "otp" ? "Verify Phone" : "Create Account"}</Text>
              <Text style={s.navSub}>{step === "otp" ? "Step 2 of 2" : "Step 1 of 2"}</Text>
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
          {step === "form" ? (
            <>
              {/* Logo & Heading */}
              <View style={s.brandWrap}>
                <Image
                  source={require("../assets/icon.png")}
                  style={s.logo}
                  resizeMode="contain"
                />
                <Text style={s.title}>Join MyTruck</Text>
                <Text style={s.subtitle}>
                  Fast food, grocery & parcel delivery across Ethiopia
                </Text>
              </View>

              {/* Form Card */}
              <View style={s.card}>
                {/* Full Name */}
                <Text style={s.label}>Full Name</Text>
                <View style={s.inputWrap}>
                  <MaterialCommunityIcons
                    name="account-outline"
                    size={20}
                    color={TEAL}
                    style={s.inputIcon}
                  />
                  <TextInput
                    style={s.input}
                    placeholder="e.g. Abebe Bikila"
                    placeholderTextColor="#94A3B8"
                    value={fullName}
                    onChangeText={(t) => {
                      setFullName(t);
                      if (errorMessage) setErrorMessage("");
                    }}
                    autoCapitalize="words"
                  />
                </View>

                {/* Mobile Phone */}
                <Text style={s.label}>Ethiopian Mobile Number (+251)</Text>
                <View style={s.inputWrap}>
                  <Text style={s.prefixTxt}>+251</Text>
                  <TextInput
                    style={s.input}
                    placeholder="9XXXXXXXX"
                    placeholderTextColor="#94A3B8"
                    value={phone}
                    onChangeText={handlePhoneChange}
                    keyboardType="phone-pad"
                    maxLength={9}
                  />
                </View>

                {/* Email (sign-in and password reset) */}
                <Text style={s.label}>Email</Text>
                <View style={s.inputWrap}>
                  <TextInput
                    style={s.input}
                    placeholder="you@example.com"
                    placeholderTextColor="#94A3B8"
                    value={email}
                    onChangeText={(t) => {
                      setEmail(t);
                      if (errorMessage) setErrorMessage("");
                    }}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>

                {/* Password */}
                <Text style={s.label}>Password</Text>
                <View style={s.inputWrap}>
                  <MaterialCommunityIcons
                    name="lock-outline"
                    size={20}
                    color={TEAL}
                    style={s.inputIcon}
                  />
                  <TextInput
                    style={s.input}
                    placeholder="At least 8 letters and numbers"
                    placeholderTextColor="#94A3B8"
                    value={password}
                    onChangeText={(t) => {
                      setPassword(t);
                      if (errorMessage) setErrorMessage("");
                    }}
                    secureTextEntry={!showPassword}
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

                {/* Continue to Phone Verification Button */}
                <TouchableOpacity
                  style={[s.signUpBtn, busy && { opacity: 0.7 }]}
                  onPress={onSendOtp}
                  disabled={busy}
                  activeOpacity={0.88}
                >
                  {busy ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <>
                      <Text style={s.signUpBtnTxt}>Verify Phone & Continue</Text>
                      <MaterialCommunityIcons name="arrow-right" size={18} color="white" style={{ marginLeft: 6 }} />
                    </>
                  )}
                </TouchableOpacity>
              </View>

              {/* Already have an account row */}
              <View style={s.footerRow}>
                <Text style={s.footerTxt}>Already have an account? </Text>
                <TouchableOpacity onPress={() => navigation.navigate("SignIn")}>
                  <Text style={s.signInLink}>Sign In</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            /* Step 2: OTP Verification Card */
            <>
              <View style={s.brandWrap}>
                <View style={s.otpIconCircle}>
                  <MaterialCommunityIcons name="cellphone-message" size={36} color={TEAL} />
                </View>
                <Text style={s.title}>Verify Your Mobile</Text>
                <Text style={s.subtitle}>
                  We sent a 6-digit verification code to{"\n"}
                  <Text style={{ fontWeight: "800", color: DARK }}>
                    {normalizedPhone?.intlNumber || `+251 ${phone}`}
                  </Text>
                </Text>
              </View>

              <View style={s.card}>
                <Text style={s.label}>6-Digit Verification Code</Text>
                <View style={s.inputWrap}>
                  <MaterialCommunityIcons
                    name="shield-key-outline"
                    size={20}
                    color={TEAL}
                    style={s.inputIcon}
                  />
                  <TextInput
                    style={[s.input, { letterSpacing: 8, fontSize: 20, fontWeight: "800" }]}
                    placeholder="••••••"
                    placeholderTextColor="#94A3B8"
                    value={otpCode}
                    onChangeText={(t) => {
                      setOtpCode(t.replace(/\D/g, "").slice(0, 6));
                      if (errorMessage) setErrorMessage("");
                    }}
                    keyboardType="number-pad"
                    maxLength={6}
                    autoFocus
                  />
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

                {/* Verify & Create Account Button */}
                <TouchableOpacity
                  style={[s.signUpBtn, busy && { opacity: 0.7 }]}
                  onPress={onVerifyAndRegister}
                  disabled={busy}
                  activeOpacity={0.88}
                >
                  {busy ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text style={s.signUpBtnTxt}>Verify & Create Account</Text>
                  )}
                </TouchableOpacity>

                {/* Resend and Change Number Links */}
                <View style={{ marginTop: 16, alignItems: "center", gap: 10 }}>
                  <TouchableOpacity
                    onPress={onResendOtp}
                    disabled={countdown > 0 || busy}
                  >
                    <Text style={[s.resendTxt, countdown > 0 && { color: "#94A3B8" }]}>
                      {countdown > 0 ? `Resend code in ${countdown}s` : "Resend Code"}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => {
                      setStep("form");
                      setErrorMessage("");
                      setOtpCode("");
                    }}
                  >
                    <Text style={s.changeNumberTxt}>Edit Phone Number</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </>
          )}
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
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    shadowColor: "#0B2A26",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 8,
  },
  topNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  navTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },
  navSub: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    marginTop: 2,
  },
  scroll: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
  },
  brandWrap: {
    alignItems: "center",
    marginBottom: 20,
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 16,
    marginBottom: 10,
  },
  otpIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#E6F7F1",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: DARK,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: "#64748B",
    textAlign: "center",
    paddingHorizontal: 20,
    lineHeight: 18,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 20,
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
  },
  label: {
    fontSize: 12.5,
    fontWeight: "700",
    color: DARK,
    marginBottom: 6,
    marginTop: 10,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    paddingHorizontal: 14,
    height: 50,
  },
  inputIcon: {
    marginRight: 10,
  },
  prefixTxt: {
    fontSize: 14,
    fontWeight: "800",
    color: TEAL,
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 14,
    color: DARK,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEF2F2",
    borderRadius: 10,
    padding: 10,
    marginTop: 14,
    borderWidth: 1,
    borderColor: "#FCA5A5",
  },
  errorTxt: {
    color: "#DC2626",
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 6,
    flex: 1,
  },
  signUpBtn: {
    backgroundColor: TEAL,
    borderRadius: 14,
    height: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
    elevation: 3,
    shadowColor: TEAL,
    shadowOpacity: 0.35,
    shadowRadius: 6,
  },
  signUpBtnTxt: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  resendTxt: {
    fontSize: 13,
    fontWeight: "700",
    color: TEAL,
  },
  changeNumberTxt: {
    fontSize: 12.5,
    color: "#64748B",
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 24,
  },
  footerTxt: {
    fontSize: 13,
    color: "#64748B",
    fontWeight: "600",
  },
  signInLink: {
    fontSize: 13,
    color: ORANGE,
    fontWeight: "800",
  },
});
