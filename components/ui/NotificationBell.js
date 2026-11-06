import React from "react";
import { TouchableOpacity, View, Text, StyleSheet } from "react-native";
import { useNavigation } from "@react-navigation/native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useNotifications } from "../../contexts/NotificationContext";

const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";

export default function NotificationBell({
  size = 24,
  iconColor = DARK,
  badgeColor = ORANGE,
  style,
  onPress,
}) {
  const navigation = useNavigation();
  const { unreadCount } = useNotifications();

  const handlePress = () => {
    if (onPress) {
      onPress();
    } else {
      navigation.navigate("NotificationCenter");
    }
  };

  const badgeText = unreadCount > 9 ? "9+" : String(unreadCount);

  return (
    <TouchableOpacity
      style={[styles.btn, style]}
      onPress={handlePress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`Notifications, ${unreadCount} unread`}
    >
      <MaterialCommunityIcons
        name={unreadCount > 0 ? "bell-badge-outline" : "bell-outline"}
        size={size}
        color={iconColor}
      />
      {unreadCount > 0 && (
        <View style={[styles.badge, { backgroundColor: badgeColor }]}>
          <Text style={styles.badgeText}>{badgeText}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  badge: {
    position: "absolute",
    top: 4,
    right: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
  },
  badgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
    textAlign: "center",
  },
});
