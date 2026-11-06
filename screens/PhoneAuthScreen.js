import React, { useState } from "react";
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
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import BackButton from "../components/ui/BackButton";
import { UserAuth, normalizeEthiopianPhone } from "../contexts/AuthContext";

const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";

export default function PhoneAuthScreen({ navigation }) {
  const { requestOtp } = UserAuth();

  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handlePhoneChange = (text) => {
    let digits = text.replace(/\D/g, "");
    if (digits.startsWith("251")) digits = digits.slice(3);
    if (digits.startsWith("0")) digits = digits.slice(1);
    setPhone(digits.slice(0, 9));
    if (errorMessage) setErrorMessage("");
  };

  const handleSendOtp = async () => {
    if (busy) return;
    setErrorMessage("");

    const norm = normalizeEthiopianPhone(phone);
    if (!norm.isValid) {
      setErrorMessage(norm.error);
      return;
    }

    setBusy(true);
    try {
      const result = await requestOtp(phone);
      navigation.navigate("OtpVerification", {
        phoneNumber: norm.intlNumber,
        formattedPhone: norm.localNumber,
        expiresInSeconds: result?.expiresInSeconds || 300,
        resendCooldown: result?.resendCooldownSeconds || 60,
      });
    } catch (err) {
      console.warn("requestOtp error:", err?.message);
      let friendly = err?.message || "Could not send verification SMS. Please check your phone number.";
      if (err?.code === "resource-exhausted") {
        friendly = err.message || "Too many requests. Please wait a few minutes.";
      }
      setErrorMessage(friendly);
      Alert.alert("SMS Notice", friendly);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.root}>
      <StatusBar style="light" backgroundColor={TEAL} />

      {/* Enhanced Curved Header */}
      <View style={s.headerOuter}>
        <SafeAreaView edges={["top"]} style={s.safeTop}>
          <View style={s.topNav}>
            <BackButton fallbackRoute="Welcome" iconColor="white" />
            <View style={s.headerCenter}>
              <Text style={s.navTitle}>Phone Sign In</Text>
              <Text style={s.navSub}>Fast & secure 6-digit SMS login</Text>
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
          {/* Logo & Headline */}
          <View style={s.brandWrap}>
            <Image
              source={require("../assets/icon.png")}
              style={s.logo}
              resizeMode="contain"
            />
            <Text style={s.title}>Instant Phone Access</Text>
            <Text style={s.subtitle}>
              Enter your Ethiopian mobile number to receive a secure 6-digit code via SMS.
            </Text>
          </View>

          {/* Input Card */}
          <View style={s.card}>
            <Text style={s.label}>Mobile Phone Number</Text>
            <View style={s.inputWrap}>
              <View style={s.flagBox}>
                <Text style={s.flagEmoji}>🇪🇹</Text>
                <Text style={s.prefixTxt}>+251</Text>
              </View>
              <TextInput
                style={s.input}
                placeholder="9XXXXXXXX or 7XXXXXXXX"
                placeholderTextColor="#94A3B8"
                value={phone}
                onChangeText={handlePhoneChange}
                keyboardType="phone-pad"
                autoFocus={true}
                maxLength={9}
              />
            </View>

            {errorMessage ? (
              <View style={s.errorBox}>
                <MaterialCommunityIcons name="alert-circle-outline" size={16} color="#DC2626" />
                <Text style={s.errorTxt}>{errorMessage}</Text>
              </View>
            ) : null}

            {/* Primary Action Button */}
            <TouchableOpacity
              style={[s.primaryBtn, busy && { opacity: 0.7 }]}
              onPress={handleSendOtp}
              disabled={busy}
              activeOpacity={0.88}
            >
              {busy ? (
                <ActivityIndicator color="white" />
              ) : (
                <View style={s.btnContent}>
                  <MaterialCommunityIcons name="cellphone-message" size={20} color="white" style={{ marginRight: 8 }} />
                  <Text style={s.primaryBtnTxt}>Send 6-Digit Code</Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Password Login Alternative */}
            <TouchableOpacity
              style={s.secondaryBtn}
              onPress={() => navigation.navigate("SignIn")}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name="lock-outline" size={18} color={TEAL} style={{ marginRight: 6 }} />
              <Text style={s.secondaryBtnTxt}>Sign in with Password instead</Text>
            </TouchableOpacity>
          </View>

          {/* New to MyTruck */}
          <View style={s.footerRow}>
            <Text style={s.footerTxt}>Want to register a business? </Text>
            <TouchableOpacity onPress={() => navigation.navigate("SellerApply")}>
              <Text style={s.partnerLink}>Partner with us</Text>
            </TouchableOpacity>
          </View>
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
  brandWrap: {
    alignItems: "center",
    marginBottom: 24,
  },
  logo: {
    width: 68,
    height: 68,
    borderRadius: 20,
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
    lineHeight: 18,
    maxWidth: 290,
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
    paddingHorizontal: 10,
    height: 52,
    marginBottom: 14,
  },
  flagBox: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 8,
    marginRight: 8,
    borderRightWidth: 1,
    borderRightColor: "#E2E8F0",
  },
  flagEmoji: {
    fontSize: 18,
    marginRight: 4,
  },
  prefixTxt: {
    fontSize: 15,
    fontWeight: "800",
    color: DARK,
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    color: DARK,
    letterSpacing: 1,
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
    marginTop: 6,
    elevation: 2,
    shadowColor: TEAL,
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
  },
  btnContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnTxt: {
    color: "white",
    fontSize: 15,
    fontWeight: "800",
  },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F1F5F9",
    borderRadius: 14,
    height: 48,
    marginTop: 12,
  },
  secondaryBtnTxt: {
    color: DARK,
    fontSize: 14,
    fontWeight: "700",
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 24,
  },
  footerTxt: {
    color: "#64748B",
    fontSize: 13,
  },
  partnerLink: {
    color: TEAL,
    fontSize: 13,
    fontWeight: "800",
  },
});

