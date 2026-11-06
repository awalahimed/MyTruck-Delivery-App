import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import BackButton from "../components/ui/BackButton";
import { UserAuth, formatAuthError } from "../contexts/AuthContext";
import {
  checkBiometricSupport,
  isBiometricEnabled,
  saveBiometricCredentials,
} from "../services/biometricService";

const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";

export default function OtpVerificationScreen({ route, navigation }) {
  const { signInWithOtp, requestOtp } = UserAuth();

  const {
    phoneNumber,
    formattedPhone,
    resendCooldown = 60,
  } = route.params || {};

  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [countdown, setCountdown] = useState(resendCooldown);
  const [resending, setResending] = useState(false);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const inputRefs = [
    useRef(null),
    useRef(null),
    useRef(null),
    useRef(null),
    useRef(null),
    useRef(null),
  ];

  // 60-second countdown timer
  useEffect(() => {
    let timer = null;
    if (countdown > 0) {
      timer = setInterval(() => {
        setCountdown((c) => Math.max(0, c - 1));
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [countdown]);

  // Masked phone for privacy e.g. +251 91 *** *89
  const maskedPhone = (() => {
    if (!phoneNumber) return "+251 9XX XXX XXX";
    const str = String(phoneNumber);
    if (str.length >= 10) {
      return `${str.slice(0, 7)} *** *${str.slice(-2)}`;
    }
    return str;
  })();

  const handleDigitChange = (text, index) => {
    if (errorMessage) setErrorMessage("");

    // Handle paste of full 6-digit code
    const clean = text.replace(/\D/g, "");
    if (clean.length === 6) {
      const newDigits = clean.split("");
      setDigits(newDigits);
      inputRefs[5].current?.focus();
      triggerVerification(newDigits.join(""));
      return;
    }

    const val = clean.slice(-1);
    const newDigits = [...digits];
    newDigits[index] = val;
    setDigits(newDigits);

    // Auto-advance to next input
    if (val && index < 5) {
      inputRefs[index + 1].current?.focus();
    }

    // Auto-verify when 6th digit entered
    if (index === 5 && val) {
      const fullCode = newDigits.join("");
      if (fullCode.length === 6) {
        triggerVerification(fullCode);
      }
    }
  };

  const handleKeyPress = (e, index) => {
    if (e.nativeEvent.key === "Backspace") {
      if (!digits[index] && index > 0) {
        inputRefs[index - 1].current?.focus();
        const newDigits = [...digits];
        newDigits[index - 1] = "";
        setDigits(newDigits);
      }
    }
  };

  const triggerVerification = async (codeToVerify) => {
    const code = codeToVerify || digits.join("");
    if (code.length !== 6) {
      setErrorMessage("Please enter all 6 digits.");
      return;
    }
    if (busy) return;

    setBusy(true);
    setErrorMessage("");

    try {
      const result = await signInWithOtp(phoneNumber, code);
      const isNew = !result.isExistingUser || result.profile?.isNewRegistration;

      // Silently update biometric association if already enabled
      try {
        const enabled = await isBiometricEnabled();
        if (enabled) {
          await saveBiometricCredentials({
            identifier: phoneNumber,
            credential: code,
            name: result.profile?.fullName || "User",
            role: result.profile?.role || "customer",
          }).catch(() => {});
        }
      } catch (_) {}

      // Persist account markers so WelcomeScreen routes correctly on next launch
      await AsyncStorage.setItem("@mytruck_has_account", "true").catch(() => {});
      await AsyncStorage.setItem("@mytruck_last_phone", String(phoneNumber || "")).catch(() => {});

      if (isNew) {
        // Guard: only navigate if still mounted (setUser() may have already re-mounted AppStack)
        if (isMountedRef.current) {
          try {
            navigation.replace("User Details");
          } catch (_) {
            // RootNavigator already switched to AppStack — navigation handled automatically
          }
        }
      }
      // If existing user, RootNavigator automatically switches to the authoritative role dashboard
    } catch (err) {
      console.warn("verifyLoginOtp error:", err?.message);
      const friendly = formatAuthError(err, "Incorrect verification code. Please check and try again.");
      setErrorMessage(friendly);
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0 || resending) return;
    setResending(true);
    setErrorMessage("");

    try {
      await requestOtp(phoneNumber);
      setCountdown(60);
      setDigits(["", "", "", "", "", ""]);
      inputRefs[0].current?.focus();
      Alert.alert("Code Sent", "A new 6-digit verification code was sent to your phone.");
    } catch (err) {
      const friendly = formatAuthError(err, "Could not resend SMS code. Please wait a moment.");
      Alert.alert("Resend Code", friendly);
    } finally {
      setResending(false);
    }
  };

  return (
    <View style={s.root}>
      <StatusBar style="light" backgroundColor={TEAL} />

      {/* Standard Curved Teal Header */}
      <View style={s.headerOuter}>
        <SafeAreaView edges={["top"]} style={s.safeTop}>
          <View style={s.topNav}>
            <BackButton fallbackRoute="PhoneAuth" iconColor="white" />
            <View style={s.headerCenter}>
              <Text style={s.navTitle}>Verification</Text>
              <Text style={s.navSub}>Enter 6-digit code</Text>
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
          {/* Header Description */}
          <View style={s.topInfoWrap}>
            <View style={s.iconCircle}>
              <MaterialCommunityIcons name="message-badge-outline" size={32} color={TEAL} />
            </View>
            <Text style={s.title}>Verify Phone Number</Text>
            <Text style={s.subtitle}>
              We sent a 6-digit SMS verification code to
            </Text>
            <Text style={s.phoneHighlight}>{maskedPhone}</Text>
          </View>

          {/* 6-Digit Boxes Card */}
          <View style={s.card}>
            <View style={s.digitsRow}>
              {digits.map((digit, idx) => (
                <TextInput
                  key={idx}
                  ref={inputRefs[idx]}
                  style={[
                    s.digitBox,
                    digit ? s.digitBoxFilled : null,
                    errorMessage ? s.digitBoxError : null,
                  ]}
                  value={digit}
                  onChangeText={(t) => handleDigitChange(t, idx)}
                  onKeyPress={(e) => handleKeyPress(e, idx)}
                  keyboardType="number-pad"
                  maxLength={6}
                  selectTextOnFocus={true}
                  autoFocus={idx === 0}
                />
              ))}
            </View>

            {errorMessage ? (
              <View style={s.errorBox}>
                <MaterialCommunityIcons name="alert-circle-outline" size={16} color="#DC2626" />
                <Text style={s.errorTxt}>{errorMessage}</Text>
              </View>
            ) : null}

            {/* Verify Button */}
            <TouchableOpacity
              style={[s.primaryBtn, busy && { opacity: 0.7 }]}
              onPress={() => triggerVerification()}
              disabled={busy}
              activeOpacity={0.88}
            >
              {busy ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={s.primaryBtnTxt}>Verify & Sign In</Text>
              )}
            </TouchableOpacity>

            {/* Resend Row */}
            <View style={s.resendRow}>
              {countdown > 0 ? (
                <Text style={s.countdownTxt}>
                  Resend code in <Text style={{ fontWeight: "800", color: TEAL }}>{countdown}s</Text>
                </Text>
              ) : (
                <TouchableOpacity
                  onPress={handleResend}
                  disabled={resending}
                  activeOpacity={0.75}
                >
                  <Text style={s.resendLink}>
                    {resending ? "Sending code..." : "Resend Code via SMS"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Edit phone option */}
          <TouchableOpacity
            style={s.changePhoneBtn}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
          >
            <Text style={s.changePhoneTxt}>Wrong number? Change phone number</Text>
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
    paddingTop: 24,
    paddingBottom: 40,
  },
  topInfoWrap: {
    alignItems: "center",
    marginBottom: 24,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#E6F4F1",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: "900",
    color: DARK,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    color: "#64748B",
    textAlign: "center",
  },
  phoneHighlight: {
    fontSize: 15,
    fontWeight: "800",
    color: TEAL,
    marginTop: 4,
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
  digitsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 20,
    marginTop: 8,
  },
  digitBox: {
    width: 44,
    height: 54,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    backgroundColor: "#F8FAFC",
    textAlign: "center",
    fontSize: 22,
    fontWeight: "900",
    color: DARK,
  },
  digitBoxFilled: {
    borderColor: TEAL,
    backgroundColor: "#F0FDFA",
  },
  digitBoxError: {
    borderColor: "#EF4444",
    backgroundColor: "#FEF2F2",
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
  primaryBtn: {
    backgroundColor: TEAL,
    borderRadius: 14,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    elevation: 2,
    shadowColor: TEAL,
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
  },
  primaryBtnTxt: {
    color: "white",
    fontSize: 15,
    fontWeight: "800",
  },
  resendRow: {
    alignItems: "center",
    marginTop: 18,
  },
  countdownTxt: {
    fontSize: 13,
    color: "#64748B",
  },
  resendLink: {
    fontSize: 14,
    fontWeight: "800",
    color: TEAL,
  },
  changePhoneBtn: {
    alignItems: "center",
    marginTop: 20,
    paddingVertical: 8,
  },
  changePhoneTxt: {
    fontSize: 13,
    color: "#64748B",
    fontWeight: "600",
    textDecorationLine: "underline",
  },
});

