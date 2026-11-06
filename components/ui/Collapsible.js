import React, { useState } from "react";
import { TouchableOpacity, View, Text, StyleSheet } from "react-native";

const TEAL = "#179B83";

export default function Collapsible({
  title,
  subtitle,
  icon: Icon,
  children,
  open: controlledOpen,
  onToggle,
  right,
  bare,
  style,
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;

  const handleToggle = () => {
    const next = !isOpen;
    if (onToggle) onToggle(next);
    else setInternalOpen(next);
  };

  return (
    <View style={[bare ? null : s.card, style]}>
      <TouchableOpacity onPress={handleToggle} style={s.header} activeOpacity={0.8}>
        {Icon ? <Icon size={20} color={TEAL} style={{ marginRight: 8 }} /> : null}
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{title}</Text>
          {subtitle ? <Text style={s.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {right ? <View style={{ marginRight: 8 }}>{right}</View> : null}
        <Text style={[s.chevron, isOpen && s.chevronOpen]}>›</Text>
      </TouchableOpacity>
      {isOpen ? <View style={bare ? null : s.body}>{children}</View> : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: "white",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
  },
  title: { fontWeight: "700", color: "#0B2A26", fontSize: 14 },
  subtitle: { color: "#64748B", fontSize: 12, marginTop: 2 },
  chevron: {
    fontSize: 20,
    color: "#94A3B8",
    transform: [{ rotate: "0deg" }],
  },
  chevronOpen: { transform: [{ rotate: "90deg" }] },
  body: { paddingHorizontal: 14, paddingBottom: 14 },
});
