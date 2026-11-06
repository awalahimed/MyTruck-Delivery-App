import { View, TextInput, StyleSheet } from "react-native";

export default function Input({ label, icon: Icon, right, style, ...props }) {
  return (
    <View style={[s.wrap, style]}>
      {Icon ? <Icon size={18} color="#94A3B8" style={s.icon} /> : null}
      <TextInput
        style={[s.input, Icon && s.inputWithIcon]}
        placeholderTextColor="#94A3B8"
        {...props}
      />
      {right || null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 12,
    height: 48,
  },
  icon: { marginRight: 8 },
  input: { flex: 1, fontSize: 15, color: "#0F172A" },
  inputWithIcon: { paddingLeft: 0 },
});
