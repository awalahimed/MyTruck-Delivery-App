import { TouchableOpacity } from "react-native";

export default function PressableScale({ children, onPress, style, containerStyle, hitSlop, scaleTo, accessibilityLabel, ...props }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[containerStyle, style]}
      hitSlop={typeof hitSlop === "number" ? { top: hitSlop, bottom: hitSlop, left: hitSlop, right: hitSlop } : hitSlop}
      activeOpacity={0.75}
      accessibilityLabel={accessibilityLabel}
      {...props}
    >
      {children}
    </TouchableOpacity>
  );
}
