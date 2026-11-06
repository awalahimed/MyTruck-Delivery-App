import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import BackButton from "./BackButton";

const TEAL = "#179B83";
const DARK = "#0B2A26";

export function IconButton({ icon: Icon, onPress, size = 22, color = TEAL, badge, label, accessibilityLabel }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={s.iconBtn}
      activeOpacity={0.75}
      accessibilityLabel={accessibilityLabel || label}
    >
      {Icon ? <Icon size={size} color={color} /> : null}
      {badge ? (
        <View style={s.badge}>
          <Text style={s.badgeTxt}>{badge}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

export default function ScreenHeader({ title, subtitle, onBack, fallbackRoute, right, style }) {
  return (
    <View style={[s.header, style]}>
      <View style={s.left}>
        <BackButton onPress={onBack} fallbackRoute={fallbackRoute} />
      </View>
      <View style={s.center}>
        <Text style={s.title} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={s.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      <View style={s.right}>{right || <View style={{ width: 40 }} />}</View>
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "white",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#EDF2F1",
  },
  left: { width: 44, alignItems: "flex-start" },
  center: { flex: 1, alignItems: "center", paddingHorizontal: 8 },
  right: { width: 44, alignItems: "flex-end" },
  title: { fontSize: 18, fontWeight: "800", color: DARK },
  subtitle: { fontSize: 12, color: "#64748B", marginTop: 2 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F5FAF9",
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: -2,
    right: -2,
    backgroundColor: "#F47721",
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeTxt: { color: "white", fontSize: 10, fontWeight: "800" },
});
