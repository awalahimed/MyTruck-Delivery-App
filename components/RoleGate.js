import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { UserAuth } from "../contexts/AuthContext";
import { getRoleInfo, homeRouteFor } from "../utils/roles";

const TEAL = "#179B83";
const DARK = "#0B2A26";

/**
 * Wraps a role dashboard so only the right accounts can open it
 * (deep links and stray navigation can otherwise reach any registered screen).
 * `allow` receives the role info from utils/roles.
 */
export function withRoleGate(Screen, allow, label) {
  function Gated(props) {
    const { user, dbUser } = UserAuth();
    const info = getRoleInfo(user, dbUser);
    if (allow(info)) return <Screen {...props} />;

    const home = homeRouteFor(info);
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.card}>
          <MaterialCommunityIcons name="lock-outline" size={40} color={TEAL} />
          <Text style={s.title}>{`${label} only`}</Text>
          <Text style={s.body}>Your account doesn't have access to this area.</Text>
          <TouchableOpacity
            style={s.btn}
            activeOpacity={0.85}
            onPress={() => props.navigation?.reset({ index: 0, routes: [{ name: home }] })}
          >
            <Text style={s.btnTxt}>Go to my home</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }
  Gated.displayName = `RoleGate(${Screen.displayName || Screen.name || "Screen"})`;
  return Gated;
}

/** Shown instead of the app for banned / suspended accounts. */
export function BlockedAccountScreen({ status, onSignOut }) {
  const banned = status === "BANNED";
  return (
    <SafeAreaView style={[s.safe, { backgroundColor: DARK }]}>
      <View style={s.card}>
        <MaterialCommunityIcons name={banned ? "account-cancel" : "account-clock"} size={44} color="#DC2626" />
        <Text style={s.title}>{banned ? "Account Banned" : "Account Suspended"}</Text>
        <Text style={s.body}>
          {banned
            ? "This account has been banned from MyTruck. Contact MyTruck support if you think this is a mistake."
            : "This account is temporarily suspended. Please contact MyTruck support to restore access."}
        </Text>
        <TouchableOpacity style={[s.btn, { backgroundColor: "#DC2626" }]} activeOpacity={0.85} onPress={onSignOut}>
          <Text style={s.btnTxt}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F5FAF9", justifyContent: "center", padding: 24 },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    width: "100%",
    maxWidth: 380,
    alignSelf: "center",
  },
  title: { fontSize: 19, fontWeight: "800", color: DARK, marginTop: 12, textAlign: "center" },
  body: { fontSize: 13.5, color: "#64748B", marginTop: 8, textAlign: "center", lineHeight: 20 },
  btn: { marginTop: 20, backgroundColor: TEAL, paddingVertical: 13, paddingHorizontal: 28, borderRadius: 12 },
  btnTxt: { color: "#FFFFFF", fontWeight: "800", fontSize: 14 },
});
