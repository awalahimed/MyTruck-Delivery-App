import { Text } from "react-native";

const variantStyles = {
  heading: { fontSize: 15, fontWeight: "700", color: "#0B2A26" },
  title:   { fontSize: 18, fontWeight: "800", color: "#0B2A26" },
  body:    { fontSize: 14, fontWeight: "400", color: "#0F172A" },
  caption: { fontSize: 12, fontWeight: "400", color: "#64748B" },
  label:   { fontSize: 13, fontWeight: "700", color: "#475569" },
};

const toneStyles = {
  default: {},
  muted:   { color: "#64748B" },
  faint:   { color: "#94A3B8" },
  primary: { color: "#179B83" },
  error:   { color: "#EF4444" },
  inverse: { color: "#FFFFFF" },
};

export default function Txt({ v = "body", tone = "default", style, children, ...props }) {
  return (
    <Text
      style={[variantStyles[v] || variantStyles.body, toneStyles[tone] || {}, style]}
      {...props}
    >
      {children}
    </Text>
  );
}
