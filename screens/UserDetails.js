import React, { useState, useEffect } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  Alert,
  Platform,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { UserAuth } from "../contexts/AuthContext";
import { db } from "../firebase";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { useNavigation } from "@react-navigation/native";
import { Marker } from "react-native-maps";
import SharedMapView from "../components/SharedMapView";
import { StatusBar } from "expo-status-bar";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import BackButton from "../components/ui/BackButton";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import {
  MAP_TILE_URL,
  requestGpsLocation,
  reverseGeocodeLocation,
} from "../utils/mapService";

const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";

export default function UserDetails() {
  const navigation = useNavigation();
  const { user, dbUser, refreshProfile, completeOtpFlow } = UserAuth();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState({ latitude: 8.9806, longitude: 38.7578 });
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (dbUser) {
      if (dbUser.firstName) setFirstName(dbUser.firstName);
      if (dbUser.lastName) setLastName(dbUser.lastName);
      if (dbUser.phoneNumber) {
        const p = String(dbUser.phoneNumber).replace(/^\+251/, "");
        setPhoneNumber(p);
      }
      if (dbUser.address) setAddress(dbUser.address);
      if (dbUser.latitude && dbUser.longitude) {
        setCoords({ latitude: dbUser.latitude, longitude: dbUser.longitude });
      }
    }
  }, [dbUser]);

  const handlePhoneNumberChange = (text) => {
    let clean = text.replace(/\D/g, "");
    if (clean.startsWith("251")) clean = clean.slice(3);
    if (clean.startsWith("0")) clean = clean.slice(1);
    setPhoneNumber(clean.slice(0, 9));
  };

  const handleGetCurrentLocation = async () => {
    setLocating(true);
    try {
      const c = await requestGpsLocation();
      setCoords(c);
      const addr = await reverseGeocodeLocation(c.latitude, c.longitude);
      setAddress(addr);
    } catch (err) {
      Alert.alert("GPS Error", err.message || "Could not retrieve GPS location.");
    } finally {
      setLocating(false);
    }
  };

  const onSave = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      Alert.alert("Missing Name", "Please enter your first and last name.");
      return;
    }
    if (!phoneNumber || phoneNumber.length !== 9) {
      Alert.alert("Invalid Phone", "Please enter a valid 9-digit Ethiopian phone number.");
      return;
    }
    if (!address.trim()) {
      Alert.alert("Missing Address", "Please enter your delivery street address.");
      return;
    }

    setSaving(true);
    try {
      if (user?.uid) {
        await setDoc(
          doc(db, "user", user.uid),
          {
            role: dbUser?.role || "customer",
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            fullName: `${firstName.trim()} ${lastName.trim()}`,
            phoneNumber: `+251${phoneNumber}`,
            address: address.trim(),
            countryCode: "ET",
            currency: "ETB",
            latitude: coords.latitude,
            longitude: coords.longitude,
            updatedAt: new Date(),
          },
          { merge: true }
        );
        await refreshProfile();
      }

      if (typeof completeOtpFlow === "function") {
        completeOtpFlow();
      }

      // Request location + notification permissions on first login
      // Done after save so the customer is already registered in the system
      try {
        const { status: locStatus } = await Location.requestForegroundPermissionsAsync();
        if (locStatus === "granted") {
          // Pre-fetch location so Home.js has it cached immediately
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
            .then((pos) => {
              if (pos?.coords) {
                reverseGeocodeLocation(pos.coords.latitude, pos.coords.longitude).catch(() => {});
              }
            })
            .catch(() => {});
        }
      } catch (_) {}

      try {
        await Notifications.requestPermissionsAsync();
      } catch (_) {}

      Alert.alert("Success", "Your details have been saved!", [
        {
          text: "Continue",
          onPress: () => {
            if (navigation.canGoBack()) navigation.goBack();
            else navigation.navigate("Home");
          },
        },
      ]);
    } catch (error) {
      Alert.alert("Could not save your details", error.message || "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <StatusBar style="light" backgroundColor={TEAL} />
      <View style={s.topNav}>
        <BackButton fallbackRoute="HomeTab" iconColor="white" />
        <View style={s.headerCenter}>
          <Text style={s.title}>Your Details</Text>
          <Text style={s.subTitle}>Update personal information & address</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.card}>
            <Text style={s.label}>First Name *</Text>
            <TextInput
              style={s.input}
              value={firstName}
              onChangeText={setFirstName}
              placeholder="e.g. Abebe"
              placeholderTextColor="#94A3B8"
            />

            <Text style={s.label}>Last Name *</Text>
            <TextInput
              style={s.input}
              value={lastName}
              onChangeText={setLastName}
              placeholder="e.g. Bikila"
              placeholderTextColor="#94A3B8"
            />

            <Text style={s.label}>Phone Number (+251) *</Text>
            <View style={s.phoneRow}>
              <Text style={s.phonePrefix}>+251</Text>
              <TextInput
                style={[s.input, { flex: 1, marginBottom: 0 }]}
                value={phoneNumber}
                onChangeText={handlePhoneNumberChange}
                placeholder="9XXXXXXXX"
                placeholderTextColor="#94A3B8"
                keyboardType="phone-pad"
                maxLength={9}
              />
            </View>

            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 14, marginBottom: 6 }}>
              <Text style={s.label}>Delivery Address *</Text>
              <TouchableOpacity onPress={handleGetCurrentLocation} style={s.gpsBtn} activeOpacity={0.8}>
                {locating ? (
                  <ActivityIndicator size="small" color={TEAL} />
                ) : (
                  <>
                    <MaterialCommunityIcons name="crosshairs-gps" size={14} color={TEAL} />
                    <Text style={s.gpsTxt}>Get Current Location</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            <TextInput
              style={s.input}
              value={address}
              onChangeText={setAddress}
              placeholder="Bole, Addis Ababa"
              placeholderTextColor="#94A3B8"
            />

            {/* Map Preview */}
            <View style={s.mapWrapper}>
              <SharedMapView
                style={StyleSheet.absoluteFillObject}
                initialRegion={{
                  latitude: coords.latitude || 8.9806,
                  longitude: coords.longitude || 38.7578,
                  latitudeDelta: 0.015,
                  longitudeDelta: 0.015,
                }}
                onLocationChange={(c) => {
                  if (c?.latitude && c?.longitude) {
                    setCoords(c);
                    reverseGeocodeLocation(c.latitude, c.longitude).then(setAddress);
                  }
                }}
                onRecenter={handleGetCurrentLocation}
                recenterLoading={locating}
              />
            </View>
          </View>

          <TouchableOpacity
            style={[s.saveBtn, saving && { opacity: 0.7 }]}
            onPress={onSave}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={s.saveTxt}>Save & Continue</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F5FAF9" },
  topNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: TEAL,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    shadowColor: "#0B2A26",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  headerCenter: {
    flex: 1,
    marginLeft: 12,
  },
  title: { fontSize: 18, fontWeight: "800", color: "#FFFFFF" },
  subTitle: { fontSize: 12, color: "rgba(255,255,255,0.85)", marginTop: 2 },
  scroll: { padding: 16, paddingBottom: 60 },
  card: {
    backgroundColor: "white",
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: "#E6ECEB",
    elevation: 2,
    marginBottom: 16,
  },
  label: { fontSize: 13, fontWeight: "700", color: DARK, marginBottom: 6 },
  input: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
    fontSize: 14,
    color: DARK,
    marginBottom: 12,
  },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  phonePrefix: { fontSize: 14, fontWeight: "800", color: TEAL, marginRight: 8 },
  gpsBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E6F4F1",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  gpsTxt: { fontSize: 11, fontWeight: "800", color: TEAL, marginLeft: 4 },
  mapWrapper: {
    height: 160,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginTop: 6,
  },
  saveBtn: {
    backgroundColor: TEAL,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
  },
  saveTxt: { color: "white", fontSize: 16, fontWeight: "800" },
});
