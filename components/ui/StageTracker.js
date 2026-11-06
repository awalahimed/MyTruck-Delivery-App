import { View, Text, StyleSheet } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

const TEAL = "#179B83";
const STAGES = [
  { key: "PENDING",        label: "Placed",       icon: "check-circle-outline" },
  { key: "ACCEPTED",       label: "Accepted",     icon: "store-check-outline" },
  { key: "PREPARING",      label: "Preparing",    icon: "chef-hat" },
  { key: "READY",          label: "Ready",        icon: "package-variant" },
  { key: "DRIVERACCEPTED", label: "Driver",       icon: "account-outline" },
  { key: "DRIVERPICKEDUP", label: "On the way",   icon: "truck-fast-outline" },
  { key: "COMPLETE",       label: "Delivered",    icon: "home-circle-outline" },
];

const ORDER = STAGES.map((s) => s.key);

export default function StageTracker({ status }) {
  const currentIndex = ORDER.indexOf(status);
  return (
    <View style={s.wrap}>
      {STAGES.map((stage, i) => {
        const done = i <= currentIndex;
        const active = i === currentIndex;
        return (
          <View key={stage.key} style={s.row}>
            <View style={s.left}>
              <View style={[s.dot, done && s.dotDone, active && s.dotActive]}>
                <MaterialCommunityIcons
                  name={stage.icon}
                  size={14}
                  color={done ? "white" : "#CBD5E1"}
                />
              </View>
              {i < STAGES.length - 1 && (
                <View style={[s.line, done && i < currentIndex && s.lineDone]} />
              )}
            </View>
            <Text style={[s.label, done && s.labelDone]}>{stage.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingVertical: 8 },
  row: { flexDirection: "row", alignItems: "flex-start", minHeight: 36 },
  left: { alignItems: "center", marginRight: 12, width: 28 },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
  },
  dotDone: { backgroundColor: TEAL, borderColor: TEAL },
  dotActive: { backgroundColor: TEAL, borderColor: TEAL },
  line: { width: 2, height: 16, backgroundColor: "#E2E8F0", marginTop: 2 },
  lineDone: { backgroundColor: TEAL },
  label: { fontSize: 13, color: "#94A3B8", paddingTop: 6 },
  labelDone: { color: "#0B2A26", fontWeight: "700" },
});
