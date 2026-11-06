import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  Switch,
  StyleSheet,
  ScrollView,
} from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useNotifications } from "../contexts/NotificationContext";

const TEAL = "#179B83";
const DARK = "#0B2A26";

export default function NotificationPreferencesModal({ visible, onClose }) {
  const { preferences, updatePreferences } = useNotifications();
  const [localPrefs, setLocalPrefs] = useState(preferences);

  useEffect(() => {
    if (visible) {
      setLocalPrefs(preferences);
    }
  }, [visible, preferences]);

  const toggle = (key) => {
    setLocalPrefs((prev) => {
      const updated = { ...prev, [key]: !prev[key] };
      updatePreferences(updated);
      return updated;
    });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={s.overlay}>
        <View style={s.sheet}>
          {/* Header */}
          <View style={s.header}>
            <View>
              <Text style={s.title}>Notification Settings</Text>
              <Text style={s.sub}>Choose which alerts you want to receive</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={s.closeBtn}>
              <MaterialCommunityIcons name="close" size={22} color="#64748B" />
            </TouchableOpacity>
          </View>

          <ScrollView style={s.content} showsVerticalScrollIndicator={false}>
            {/* Section: Operational */}
            <Text style={s.sectionHeader}>ORDERS & DELIVERIES</Text>

            <View style={s.row}>
              <View style={s.rowIconWrap}>
                <MaterialCommunityIcons name="food-fork-drink" size={20} color={TEAL} />
              </View>
              <View style={s.rowTextWrap}>
                <Text style={s.rowTitle}>Order Updates</Text>
                <Text style={s.rowDesc}>Status updates, kitchen preparation, ready for pickup</Text>
              </View>
              <Switch
                value={localPrefs.orderUpdates !== false}
                onValueChange={() => toggle("orderUpdates")}
                trackColor={{ false: "#CBD5E1", true: TEAL }}
                thumbColor="#FFFFFF"
              />
            </View>

            <View style={s.row}>
              <View style={s.rowIconWrap}>
                <MaterialCommunityIcons name="moped" size={20} color={TEAL} />
              </View>
              <View style={s.rowTextWrap}>
                <Text style={s.rowTitle}>Delivery Tracking</Text>
                <Text style={s.rowDesc}>Driver assignment, live tracking, arrival alerts</Text>
              </View>
              <Switch
                value={localPrefs.deliveryTracking !== false}
                onValueChange={() => toggle("deliveryTracking")}
                trackColor={{ false: "#CBD5E1", true: TEAL }}
                thumbColor="#FFFFFF"
              />
            </View>

            {/* Section: Marketing */}
            <Text style={s.sectionHeader}>PROMOTIONS & OFFERS</Text>

            <View style={s.row}>
              <View style={s.rowIconWrap}>
                <MaterialCommunityIcons name="tag-outline" size={20} color={TEAL} />
              </View>
              <View style={s.rowTextWrap}>
                <Text style={s.rowTitle}>Special Offers & Discounts</Text>
                <Text style={s.rowDesc}>Tasty discounts, exclusive coupons, new restaurant launches</Text>
              </View>
              <Switch
                value={localPrefs.promotions !== false}
                onValueChange={() => toggle("promotions")}
                trackColor={{ false: "#CBD5E1", true: TEAL }}
                thumbColor="#FFFFFF"
              />
            </View>

            {/* Section: Sound & Alert Style */}
            <Text style={s.sectionHeader}>ALERTS & SOUND</Text>

            <View style={s.row}>
              <View style={s.rowIconWrap}>
                <MaterialCommunityIcons name="volume-high" size={20} color={TEAL} />
              </View>
              <View style={s.rowTextWrap}>
                <Text style={s.rowTitle}>Sound Effects</Text>
                <Text style={s.rowDesc}>Play chime when order status changes</Text>
              </View>
              <Switch
                value={localPrefs.sound !== false}
                onValueChange={() => toggle("sound")}
                trackColor={{ false: "#CBD5E1", true: TEAL }}
                thumbColor="#FFFFFF"
              />
            </View>

            <View style={s.row}>
              <View style={s.rowIconWrap}>
                <MaterialCommunityIcons name="vibrate" size={20} color={TEAL} />
              </View>
              <View style={s.rowTextWrap}>
                <Text style={s.rowTitle}>Vibration</Text>
                <Text style={s.rowDesc}>Vibrate device on important delivery events</Text>
              </View>
              <Switch
                value={localPrefs.vibration !== false}
                onValueChange={() => toggle("vibration")}
                trackColor={{ false: "#CBD5E1", true: TEAL }}
                thumbColor="#FFFFFF"
              />
            </View>
          </ScrollView>

          {/* Footer Done Button */}
          <TouchableOpacity style={s.doneBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={s.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(11, 42, 38, 0.65)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 36,
    maxHeight: "85%",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: DARK,
  },
  sub: {
    fontSize: 13,
    color: "#64748B",
    marginTop: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    marginTop: 12,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: "800",
    color: "#94A3B8",
    letterSpacing: 0.8,
    marginTop: 16,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F8FAFC",
  },
  rowIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#F0FDF4",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  rowTextWrap: {
    flex: 1,
    paddingRight: 10,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: DARK,
  },
  rowDesc: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
    lineHeight: 16,
  },
  doneBtn: {
    backgroundColor: TEAL,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  doneBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
});
