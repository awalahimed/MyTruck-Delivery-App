import { TouchableOpacity, Text, StyleSheet } from "react-native";

const TEAL = "#179B83";

export default function Chip({ label, selected, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[s.chip, selected && s.selected]}
    >
      <Text style={[s.txt, selected && s.selectedTxt]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    backgroundColor: "white",
  },
  selected: { borderColor: TEAL, backgroundColor: "#E6F7F2" },
  txt: { fontWeight: "700", color: "#94A3B8", fontSize: 13 },
  selectedTxt: { color: TEAL },
});
