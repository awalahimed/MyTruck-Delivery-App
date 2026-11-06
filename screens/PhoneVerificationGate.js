import React, { useEffect, useState } from "react";
import { Alert, Text, TextInput, TouchableOpacity, View, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "../firebase";
import { UserAuth, OTP_VERIFICATION_REQUIRED } from "../contexts/AuthContext";

const TEAL = "#179B83";

export default function PhoneVerificationGate() {
  const { user, dbUser, signOutUser, refreshProfile, completeOtpFlow } = UserAuth();
  const [phone, setPhone] = useState(dbUser?.phoneNumber || "");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  // Safety net: if OTP is globally disabled, complete verification immediately
  // and never render this gate. This handles edge cases where the gate is reached
  // despite the navigator check.
  useEffect(() => {
    if (!OTP_VERIFICATION_REQUIRED) {
      completeOtpFlow();
    }
  }, [completeOtpFlow]);

  if (!OTP_VERIFICATION_REQUIRED) {
    // Render nothing — completeOtpFlow() above will trigger re-navigation
    return null;
  }

  const start = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const fn = httpsCallable(getFunctions(app), "startPhoneOtp");
      await fn({ phoneNumber: phone });
      setSent(true);
      Alert.alert("Code sent", "Enter the six-digit code sent by SMS.");
    } catch (e) {
      const code = e?.code || "";
      if (["functions/unavailable", "functions/not-found", "functions/internal"].includes(code)) {
        // SMS not configured — bypass gracefully
        console.warn("OTP service unavailable, bypassing:", e.message);
        await refreshProfile();
        completeOtpFlow();
      } else {
        Alert.alert("Could not send code", e.message || "Check your phone number and SMS setup.");
      }
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (busy) return;
    if (!/^\d{6}$/.test(code)) {
      Alert.alert("Code required", "Enter the six-digit SMS code.");
      return;
    }
    setBusy(true);
    try {
      const fn = httpsCallable(getFunctions(app), "verifyPhoneOtp");
      const r = await fn({ phoneNumber: phone, code });
      if (!r.data?.verified) throw new Error("Phone verification failed.");
      await refreshProfile();
      completeOtpFlow();
    } catch (e) {
      Alert.alert("Verification failed", e.message || "Request a new code.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#F5FAF9", justifyContent: "center", padding: 22 }}>
      <View style={{ backgroundColor: "white", padding: 22, borderRadius: 18 }}>
        <Text style={{ fontSize: 25, fontWeight: "800", color: "#0B2A26", marginBottom: 10 }}>Verify your phone</Text>
        <Text style={{ color: "#52615E", lineHeight: 22, marginBottom: 14 }}>
          A one-time SMS code is needed to verify your account.
        </Text>

        <TextInput
          value={phone}
          onChangeText={setPhone}
          editable={!sent}
          keyboardType="phone-pad"
          placeholder="Ethiopian number (+2519XXXXXXXX)"
          style={{ borderWidth: 1, borderColor: "#CCD8D5", borderRadius: 10, padding: 13 }}
        />

        {sent ? (
          <TextInput
            value={code}
            onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="Six-digit SMS code"
            style={{ borderWidth: 1, borderColor: "#CCD8D5", borderRadius: 10, padding: 13, fontSize: 20, letterSpacing: 5 }}
          />
        ) : null}

        {sent ? (
          <TouchableOpacity disabled={busy} onPress={start} style={{ alignSelf: "flex-end", padding: 6 }}>
            <Text style={{ color: TEAL, fontWeight: "700" }}>Resend code</Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          disabled={busy}
          onPress={sent ? verify : start}
          style={{ backgroundColor: TEAL, padding: 15, borderRadius: 10, alignItems: "center", opacity: busy ? 0.6 : 1 }}
        >
          {busy
            ? <ActivityIndicator color="white" />
            : <Text style={{ color: "white", fontWeight: "800" }}>{sent ? "Verify and continue" : "Send verification code"}</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity onPress={signOutUser} style={{ padding: 10, alignItems: "center" }}>
          <Text style={{ color: TEAL, fontWeight: "700" }}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
