import React from "react";
import { TouchableOpacity, Text, ActivityIndicator, StyleSheet, View } from "react-native";

const TEAL = "#179B83";

export default function Button({
  title,
  onPress,
  loading,
  disabled,
  variant = "primary",
  size = "md",
  icon: IconComponent,
  iconPosition = "left",
  style,
  textStyle,
}) {
  const isGhost = variant === "ghost";
  const isOutline = variant === "outline";
  const isSmall = size === "sm";

  const renderIcon = () => {
    if (!IconComponent) return null;
    if (React.isValidElement(IconComponent)) return IconComponent;
    if (typeof IconComponent === "function") {
      const iconColor = isGhost || isOutline ? TEAL : "white";
      const iconSize = isSmall ? 16 : 20;
      return <IconComponent size={iconSize} color={iconColor} style={iconPosition === "left" ? { marginRight: 8 } : { marginLeft: 8 }} />;
    }
    return null;
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
      style={[
        s.base,
        isSmall && s.small,
        isGhost ? s.ghost : isOutline ? s.outline : s.primary,
        (disabled || loading) && { opacity: 0.6 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isGhost || isOutline ? TEAL : "white"} />
      ) : (
        <View style={s.contentRow}>
          {iconPosition === "left" && renderIcon()}
          {title ? (
            <Text
              style={[
                s.txt,
                isGhost && s.ghostTxt,
                isOutline && s.outlineTxt,
                isSmall && s.smallTxt,
                textStyle,
              ]}
            >
              {title}
            </Text>
          ) : null}
          {iconPosition === "right" && renderIcon()}
        </View>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  base: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  contentRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  small: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  primary: { backgroundColor: TEAL },
  ghost: { backgroundColor: "transparent" },
  outline: { backgroundColor: "transparent", borderWidth: 1.5, borderColor: TEAL },
  txt: { color: "white", fontWeight: "800", fontSize: 15 },
  ghostTxt: { color: TEAL },
  outlineTxt: { color: TEAL },
  smallTxt: { fontSize: 13 },
});
