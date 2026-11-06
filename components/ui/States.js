import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

const TEAL = "#179B83";
const DARK = "#0B2A26";

export function EmptyState({
  icon = "inbox-outline",
  title = "Nothing here",
  subtitle,
  message,
  action,
  actionLabel,
  onAction,
}) {
  const displaySubtitle = subtitle || message;
  const displayAction = action || actionLabel;

  const renderIcon = () => {
    if (React.isValidElement(icon)) return icon;
    if (typeof icon === "function") {
      const IconComp = icon;
      return <IconComp size={52} color="#CBD5E1" />;
    }
    if (typeof icon === "string") {
      return <MaterialCommunityIcons name={icon} size={52} color="#CBD5E1" />;
    }
    return <MaterialCommunityIcons name="inbox-outline" size={52} color="#CBD5E1" />;
  };

  return (
    <View style={s.wrap}>
      {renderIcon()}
      <Text style={s.title}>{title}</Text>
      {displaySubtitle ? <Text style={s.subtitle}>{displaySubtitle}</Text> : null}
      {displayAction && onAction ? (
        <TouchableOpacity onPress={onAction} style={s.btn} activeOpacity={0.8}>
          <Text style={s.btnTxt}>{displayAction}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function ErrorState({
  icon = "wifi-off",
  title = "Something went wrong",
  subtitle,
  message,
  action,
  actionLabel,
  onAction,
  onRetry,
}) {
  const displaySubtitle = subtitle || message;
  const displayAction = action || actionLabel || "Try again";
  const handleAction = onRetry || onAction;

  const renderIcon = () => {
    if (React.isValidElement(icon)) return icon;
    if (typeof icon === "function") {
      const IconComp = icon;
      return <IconComp size={52} color="#CBD5E1" />;
    }
    if (typeof icon === "string") {
      return <MaterialCommunityIcons name={icon} size={52} color="#CBD5E1" />;
    }
    return <MaterialCommunityIcons name="wifi-off" size={52} color="#CBD5E1" />;
  };

  return (
    <View style={s.wrap}>
      {renderIcon()}
      <Text style={s.title}>{title}</Text>
      {displaySubtitle ? <Text style={s.subtitle}>{displaySubtitle}</Text> : null}
      {handleAction ? (
        <TouchableOpacity onPress={handleAction} style={s.btn} activeOpacity={0.8}>
          <Text style={s.btnTxt}>{displayAction}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", padding: 32 },
  title: { fontSize: 16, fontWeight: "700", color: DARK, marginTop: 12, textAlign: "center" },
  subtitle: { color: "#64748B", textAlign: "center", marginTop: 6, lineHeight: 20 },
  btn: {
    marginTop: 16,
    backgroundColor: TEAL,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 10,
    elevation: 2,
  },
  btnTxt: { color: "white", fontWeight: "700" },
});
