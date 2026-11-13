import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Alert,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useNavigation } from "@react-navigation/native";
import { Marker } from "react-native-maps";
import SharedMapView from "../components/SharedMapView";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { UserAuth } from "../contexts/AuthContext";
import { db } from "../firebase";
import { doc, getDoc, updateDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { useDispatch, useSelector } from "react-redux";
import { setUser, selectUser } from "../features/userSlice";
import BackButton from "../components/ui/BackButton";
import {
  requestGpsLocation,
  reverseGeocodeLocation,
} from "../utils/mapService";

const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";

export default function ProfileScreen() {
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const reduxUser = useSelector(selectUser);
  const { user, dbUser, refreshProfile } = UserAuth();

  // Controlled form state initialized from dbUser and Redux
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState(8.9806);
  const [longitude, setLongitude] = useState(38.7578);

  const [loadingProfile, setLoadingProfile] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [phoneError, setPhoneError] = useState("");

  // Determine administrative governance privileges
  const rawRole = (dbUser?.role || reduxUser?.role || "").toLowerCase().trim();
  const userEmail = String(user?.email || dbUser?.email || reduxUser?.email || "").toLowerCase().trim();
  const userPhone = String(dbUser?.phoneNumber || reduxUser?.phoneNumber || "").replace(/\D/g, "");

  const isMiniAdmin =
    rawRole === "miniadmin" ||
    rawRole === "mini_admin" ||
    dbUser?.isMiniAdmin === true ||
    reduxUser?.isMiniAdmin === true;

  const isSuperAdminAuthority =
    userEmail.includes("251911000001") ||
    userEmail.includes("911000001") ||
    userPhone.includes("911000001") ||
    userEmail === "superadmin@mytruck.et" ||
    userEmail === "admin@mytruck.et";

  const isSuperAdminUser =
    isSuperAdminAuthority ||
    rawRole === "superadmin" ||
    rawRole === "admin" ||
    rawRole === "super_admin" ||
    isMiniAdmin ||
    dbUser?.isSuperAdmin === true ||
    dbUser?.isAdmin === true ||
    reduxUser?.isSuperAdmin === true ||
    reduxUser?.isAdmin === true;
  const isRestaurantUser =
    rawRole === "restaurant" ||
    rawRole === "seller" ||
    rawRole === "merchant";
  const isShopUser =
    rawRole === "shop" ||
    rawRole === "store";
  const isDriverUser =
    rawRole === "driver";

  // Helper to extract clean values from a user object
  const applyProfileValues = (source) => {
    if (!source) return;
    const name = source.fullName || source.name || "";
    const nameParts = name.trim().split(" ");
    const fName = source.firstName || nameParts[0] || "";
    const lName = source.lastName || nameParts.slice(1).join(" ") || "";
    if (fName) setFirstName(fName);
    if (lName) setLastName(lName);

    if (source.phoneNumber) {
      let clean = String(source.phoneNumber).replace(/\D/g, "");
      if (clean.startsWith("251")) clean = clean.slice(3);
      if (clean.startsWith("0")) clean = clean.slice(1);
      setPhoneNumber(clean.slice(0, 9));
    }

    if (source.address) setAddress(source.address);
    if (source.latitude) setLatitude(Number(source.latitude));
    if (source.longitude) setLongitude(Number(source.longitude));
  };

  // Populate data reliably from dbUser, Redux, and fresh Firestore lookup
  useEffect(() => {
    let active = true;

    // 1. Immediate sync from cached profile or Redux
    applyProfileValues(dbUser || reduxUser);

    // 2. Fresh Firestore lookup
    async function fetchFreshData() {
      if (!user?.uid) {
        if (active) setLoadingProfile(false);
        return;
      }

      try {
        let snap = await getDoc(doc(db, "user", user.uid));
        if (!snap.exists()) {
          const altSnap = await getDoc(doc(db, "users", user.uid));
          if (altSnap.exists()) snap = altSnap;
        }

        if (active && snap.exists()) {
          applyProfileValues(snap.data());
        }
      } catch (e) {
        console.warn("Could not fetch fresh profile in ProfileScreen:", e?.message);
      } finally {
        if (active) setLoadingProfile(false);
      }
    }

    fetchFreshData();
    return () => {
      active = false;
    };
  }, [user?.uid, dbUser]);

  const handlePhoneNumberChange = (text) => {
    let clean = text.replace(/\D/g, "");
    if (clean.startsWith("251")) clean = clean.slice(3);
    if (clean.startsWith("0")) clean = clean.slice(1);
    setPhoneNumber(clean.slice(0, 9));

    if (clean.length > 0 && clean.length !== 9) {
      setPhoneError("Ethiopian mobile number must be 9 digits (e.g. 912345678)");
    } else {
      setPhoneError("");
    }
  };

  // "Get Current Location" button - fully working
  const handleGetCurrentLocation = async () => {
    setLocating(true);
    try {
      const coords = await requestGpsLocation();
      setLatitude(coords.latitude);
      setLongitude(coords.longitude);

      const resolved = await reverseGeocodeLocation(coords.latitude, coords.longitude);
      setAddress(resolved);
      Alert.alert("Location Found", `Detected: ${resolved}`);
    } catch (err) {
      Alert.alert("GPS Error", err.message || "Could not retrieve GPS coordinates.");
    } finally {
      setLocating(false);
    }
  };

  const onSave = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      Alert.alert("Missing Name", "Please enter both first name and last name.");
      return;
    }

    if (!phoneNumber || phoneNumber.length !== 9 || (!phoneNumber.startsWith("9") && !phoneNumber.startsWith("7"))) {
      Alert.alert("Invalid Phone", "Please enter a valid 9-digit Ethiopian mobile number starting with 9 or 7.");
      return;
    }

    if (!address.trim()) {
      Alert.alert("Missing Address", "Please enter your street address or tap 'Get Current Location'.");
      return;
    }

    setSaving(true);
    const updatedPayload = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      fullName: `${firstName.trim()} ${lastName.trim()}`,
      phoneNumber: `+251${phoneNumber.trim()}`,
      address: address.trim(),
      latitude,
      longitude,
      countryCode: "ET",
      currency: "ETB",
      updatedAt: new Date(),
    };

    try {
      if (user?.uid) {
        await setDoc(doc(db, "user", user.uid), updatedPayload, { merge: true });
        await refreshProfile();
        dispatch(setUser({ ...(reduxUser || {}), ...updatedPayload, uid: user.uid }));
      }

      Alert.alert("Success", "Your profile details have been saved successfully!", [
        {
          text: "OK",
          onPress: () => navigation.goBack(),
        },
      ]);
    } catch (e) {
      Alert.alert("Save Error", e.message || "Could not update your profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <StatusBar style="light" backgroundColor={TEAL} />
      {/* Premium Header */}
      <View style={s.header}>
        <BackButton fallbackRoute="HomeTab" iconColor="white" />
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>Update Your Details</Text>
          <Text style={s.headerSub}>Manage your account information</Text>
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
          {loadingProfile ? (
            <View style={{ padding: 40, alignItems: "center" }}>
              <ActivityIndicator size="large" color={TEAL} />
              <Text style={{ color: "#64748B", marginTop: 10 }}>Loading your information…</Text>
            </View>
          ) : (
            <>
              {/* SUPER ADMIN GOVERNANCE CONTROL CENTER (Visible to authorized administrators) */}
              {isSuperAdminUser ? (
                <TouchableOpacity
                  style={s.adminCard}
                  activeOpacity={0.88}
                  onPress={() => navigation.navigate("AdminDashboard")}
                >
                  <View style={s.adminCardLeft}>
                    <View style={[s.adminIconCircle, isMiniAdmin && { backgroundColor: "#CCFBF1" }]}>
                      <MaterialCommunityIcons
                        name={isMiniAdmin ? "shield-account" : "shield-crown"}
                        size={24}
                        color={isMiniAdmin ? "#0D9488" : "#B91C1C"}
                      />
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "nowrap" }}>
                        <Text style={[s.adminCardTitle, isMiniAdmin && { color: "#0F766E" }]} numberOfLines={1}>
                          {isMiniAdmin ? "Mini Admin Operations" : "Super Admin Control"}
                        </Text>
                        <View style={[s.adminBadge, isMiniAdmin && { backgroundColor: "#E6F7F1" }]}>
                          <Text style={[s.adminBadgeTxt, isMiniAdmin && { color: "#0D9488" }]}>
                            {isMiniAdmin ? "OPERATIONS" : "GOVERNANCE"}
                          </Text>
                        </View>
                      </View>
                      <Text style={s.adminCardSub} numberOfLines={2}>
                        {isMiniAdmin
                          ? "Operational order management, payments, and live platform delivery dispatch"
                          : "Manage users, approve restaurants & shops, view platform analytics"}
                      </Text>
                    </View>
                  </View>
                  <MaterialCommunityIcons
                    name="chevron-right"
                    size={20}
                    color={isMiniAdmin ? "#0D9488" : "#B91C1C"}
                    style={{ marginLeft: 4 }}
                  />
                </TouchableOpacity>
              ) : null}

              {/* RESTAURANT KITCHEN & MENU CONTROL CENTER */}
              {isRestaurantUser ? (
                <TouchableOpacity
                  style={[s.adminCard, { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" }]}
                  activeOpacity={0.88}
                  onPress={() => navigation.navigate("SellerHome", { isShop: false })}
                >
                  <View style={s.adminCardLeft}>
                    <View style={[s.adminIconCircle, { backgroundColor: "#DCFCE7" }]}>
                      <MaterialCommunityIcons name="storefront" size={24} color="#166534" />
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "nowrap" }}>
                        <Text style={[s.adminCardTitle, { color: "#166534" }]} numberOfLines={1}>Restaurant Control Center</Text>
                        <View style={[s.adminBadge, { backgroundColor: "#166534" }]}>
                          <Text style={s.adminBadgeTxt}>KITCHEN & MENU</Text>
                        </View>
                      </View>
                      <Text style={[s.adminCardSub, { color: "#15803D" }]} numberOfLines={2}>
                        Live kitchen queue, dish listings, pricing & store settings
                      </Text>
                    </View>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={20} color="#166534" style={{ marginLeft: 4 }} />
                </TouchableOpacity>
              ) : null}

              {/* SHOP INVENTORY & CATALOG CONTROL CENTER */}
              {isShopUser ? (
                <TouchableOpacity
                  style={[s.adminCard, { backgroundColor: "#FAF5FF", borderColor: "#E9D5FF" }]}
                  activeOpacity={0.88}
                  onPress={() => navigation.navigate("SellerHome", { isShop: true })}
                >
                  <View style={s.adminCardLeft}>
                    <View style={[s.adminIconCircle, { backgroundColor: "#F3E8FF" }]}>
                      <MaterialCommunityIcons name="shopping" size={24} color="#6D28D9" />
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "nowrap" }}>
                        <Text style={[s.adminCardTitle, { color: "#6D28D9" }]} numberOfLines={1}>Shop Control Center</Text>
                        <View style={[s.adminBadge, { backgroundColor: "#6D28D9" }]}>
                          <Text style={s.adminBadgeTxt}>INVENTORY</Text>
                        </View>
                      </View>
                      <Text style={[s.adminCardSub, { color: "#7C3AED" }]} numberOfLines={2}>
                        Customer grocery orders, stock catalog, items & store settings
                      </Text>
                    </View>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={20} color="#6D28D9" style={{ marginLeft: 4 }} />
                </TouchableOpacity>
              ) : null}

              {/* DRIVER OPERATIONS & FLEET DASHBOARD */}
              {isDriverUser ? (
                <TouchableOpacity
                  style={[s.adminCard, { backgroundColor: "#FFFBEB", borderColor: "#FDE68A" }]}
                  activeOpacity={0.88}
                  onPress={() => navigation.navigate("DriverDashboard")}
                >
                  <View style={s.adminCardLeft}>
                    <View style={[s.adminIconCircle, { backgroundColor: "#FEF3C7" }]}>
                      <MaterialCommunityIcons name="motorbike" size={24} color="#B45309" />
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "nowrap" }}>
                        <Text style={[s.adminCardTitle, { color: "#92400E" }]} numberOfLines={1}>Driver Operations Center</Text>
                        <View style={[s.adminBadge, { backgroundColor: "#B45309" }]}>
                          <Text style={s.adminBadgeTxt}>DISPATCH</Text>
                        </View>
                      </View>
                      <Text style={[s.adminCardSub, { color: "#B45309" }]} numberOfLines={2}>
                        Live deliveries, route navigation, order pickup & earnings
                      </Text>
                    </View>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={20} color="#B45309" style={{ marginLeft: 4 }} />
                </TouchableOpacity>
              ) : null}

              {/* PARTNER WITH MYTRUCK (For Customers: Become a Driver or Register Business) */}
              {!isSuperAdminUser && !isRestaurantUser && !isShopUser && !isDriverUser && (
                <View style={s.partnerSection}>
                  <Text style={s.partnerSectionTitle}>Work & Partner with MyTruck</Text>

                  {/* Drive with MyTruck */}
                  <TouchableOpacity
                    style={[s.partnerCard, { backgroundColor: "#FFF7ED", borderColor: "#FFEDD5" }]}
                    activeOpacity={0.88}
                    onPress={() => {
                      Alert.alert(
                        "Join Driver Fleet",
                        "Would you like to activate Driver mode to accept delivery requests and earn daily income?",
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Activate Driver Mode",
                            onPress: async () => {
                              try {
                                if (!user?.uid) return;
                                const driverData = {
                                  role: "driver",
                                  isDriver: true,
                                  isOnline: false,
                                  workingPhone: phoneNumber || "",
                                  driverLat: 8.9806,
                                  driverLng: 38.7578,
                                  updatedAt: serverTimestamp(),
                                };
                                await Promise.all([
                                  setDoc(doc(db, "user", user.uid), driverData, { merge: true }),
                                  setDoc(doc(db, "users", user.uid), driverData, { merge: true }),
                                ]);
                                Alert.alert("Driver Mode Activated!", "Your driver console is ready. Switch online to receive delivery requests.");
                              } catch (e) {
                                Alert.alert("Error", e?.message || "Could not activate driver mode.");
                              }
                            },
                          },
                        ]
                      );
                    }}
                  >
                    <View style={s.partnerCardLeft}>
                      <View style={[s.partnerIconCircle, { backgroundColor: "#FFEDD5" }]}>
                        <MaterialCommunityIcons name="motorbike" size={24} color={ORANGE} />
                      </View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={[s.partnerCardTitle, { color: "#9A3412" }]}>Drive with MyTruck</Text>
                        <Text style={s.partnerCardSub}>Deliver orders in your area & earn daily income</Text>
                      </View>
                    </View>
                    <MaterialCommunityIcons name="chevron-right" size={20} color={ORANGE} />
                  </TouchableOpacity>

                  {/* Register Restaurant or Shop */}
                  <TouchableOpacity
                    style={[s.partnerCard, { backgroundColor: "#F0FDF4", borderColor: "#DCFCE7", marginTop: 8 }]}
                    activeOpacity={0.88}
                    onPress={() => navigation.navigate("SellerApply")}
                  >
                    <View style={s.partnerCardLeft}>
                      <View style={[s.partnerIconCircle, { backgroundColor: "#DCFCE7" }]}>
                        <MaterialCommunityIcons name="storefront" size={24} color="#166534" />
                      </View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={[s.partnerCardTitle, { color: "#166534" }]}>Register Restaurant or Shop</Text>
                        <Text style={s.partnerCardSub}>Expand your business reach with our fast delivery</Text>
                      </View>
                    </View>
                    <MaterialCommunityIcons name="chevron-right" size={20} color="#166534" />
                  </TouchableOpacity>
                </View>
              )}

              {/* Form Card */}
              <View style={s.card}>
                <Text style={s.cardHeading}>Personal Information</Text>

                {/* First Name */}
                <Text style={s.fieldLabel}>First Name *</Text>
                <View style={s.inputWrap}>
                  <MaterialCommunityIcons name="account-outline" size={20} color={TEAL} style={s.inputIcon} />
                  <TextInput
                    style={s.input}
                    value={firstName}
                    onChangeText={setFirstName}
                    placeholder="First name"
                    placeholderTextColor="#94A3B8"
                    autoCapitalize="words"
                  />
                </View>

                {/* Last Name */}
                <Text style={s.fieldLabel}>Last Name *</Text>
                <View style={s.inputWrap}>
                  <MaterialCommunityIcons name="account-outline" size={20} color={TEAL} style={s.inputIcon} />
                  <TextInput
                    style={s.input}
                    value={lastName}
                    onChangeText={setLastName}
                    placeholder="Last name"
                    placeholderTextColor="#94A3B8"
                    autoCapitalize="words"
                  />
                </View>

                {/* Phone Number */}
                <Text style={s.fieldLabel}>Phone Number (+251) *</Text>
                <View style={[s.inputWrap, phoneError ? s.inputError : null]}>
                  <Text style={s.prefixTxt}>+251</Text>
                  <TextInput
                    style={s.input}
                    value={phoneNumber}
                    onChangeText={handlePhoneNumberChange}
                    placeholder="9XXXXXXXX"
                    placeholderTextColor="#94A3B8"
                    keyboardType="phone-pad"
                    maxLength={9}
                  />
                </View>
                {phoneError ? <Text style={s.errorTxt}>{phoneError}</Text> : null}

                {/* Street Address & Location */}
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 14, marginBottom: 6 }}>
                  <Text style={s.fieldLabel}>Delivery Address *</Text>
                  <TouchableOpacity
                    onPress={handleGetCurrentLocation}
                    style={s.gpsBadge}
                    activeOpacity={0.8}
                  >
                    {locating ? (
                      <ActivityIndicator size="small" color={TEAL} />
                    ) : (
                      <>
                        <MaterialCommunityIcons name="crosshairs-gps" size={14} color={TEAL} />
                        <Text style={s.gpsBadgeTxt}>Get Current Location</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>

                <View style={s.inputWrap}>
                  <MaterialCommunityIcons name="map-marker-outline" size={20} color={TEAL} style={s.inputIcon} />
                  <TextInput
                    style={s.input}
                    value={address}
                    onChangeText={setAddress}
                    placeholder="Street, area, building or house number"
                    placeholderTextColor="#94A3B8"
                  />
                </View>

                {/* Location Map Preview */}
                <View style={s.mapWrapper}>
                  <SharedMapView
                    style={StyleSheet.absoluteFillObject}
                    initialRegion={{
                      latitude: latitude || 8.9806,
                      longitude: longitude || 38.7578,
                      latitudeDelta: 0.015,
                      longitudeDelta: 0.015,
                    }}
                    onLocationChange={(c) => {
                      if (c?.latitude && c?.longitude) {
                        setLatitude(c.latitude);
                        setLongitude(c.longitude);
                        reverseGeocodeLocation(c.latitude, c.longitude).then(setAddress);
                      }
                    }}
                    onRecenter={handleGetCurrentLocation}
                    recenterLoading={locating}
                  />

                  <View style={s.mapOverlayHint} pointerEvents="none">
                    <Text style={s.mapHintTxt}>Tap map or drag marker to set exact location</Text>
                  </View>
                </View>
              </View>

              {/* Save Button */}
              <TouchableOpacity
                style={[s.saveButton, saving && { opacity: 0.7 }]}
                onPress={onSave}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={s.saveButtonTxt}>Save Details</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F5FAF9" },
  header: {
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
  headerTitle: { fontSize: 18, fontWeight: "800", color: "#FFFFFF" },
  headerSub: { fontSize: 12, color: "rgba(255,255,255,0.85)", marginTop: 2 },
  scroll: { padding: 16, paddingBottom: 60 },
  card: {
    backgroundColor: "white",
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: "#E6ECEB",
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 5,
    marginBottom: 16,
  },
  cardHeading: { fontSize: 16, fontWeight: "900", color: DARK, marginBottom: 14 },
  fieldLabel: { fontSize: 13, fontWeight: "700", color: DARK, marginBottom: 6 },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
    marginBottom: 12,
  },
  inputError: { borderColor: "#EF4444" },
  inputIcon: { marginRight: 8 },
  prefixTxt: { fontSize: 14, fontWeight: "800", color: TEAL, marginRight: 8 },
  input: { flex: 1, fontSize: 14, color: DARK },
  errorTxt: { color: "#EF4444", fontSize: 11, marginTop: -8, marginBottom: 8, marginLeft: 4 },
  gpsBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E6F4F1",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  gpsBadgeTxt: { fontSize: 11, fontWeight: "800", color: TEAL, marginLeft: 4 },
  mapWrapper: {
    height: 180,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginTop: 8,
    position: "relative",
  },
  pinWrapper: { alignItems: "center", justifyContent: "center" },
  mapOverlayHint: {
    position: "absolute",
    bottom: 8,
    left: 8,
    right: 8,
    backgroundColor: "rgba(11,42,38,0.75)",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  mapHintTxt: { color: "white", fontSize: 10, fontWeight: "600", textAlign: "center" },
  saveButton: {
    backgroundColor: TEAL,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
    shadowColor: TEAL,
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  saveButtonTxt: { color: "white", fontSize: 16, fontWeight: "800" },
  adminCard: {
    backgroundColor: "#FEF2F2",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1.5,
    borderColor: "#FCA5A5",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
    elevation: 2,
  },
  adminCardLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  adminIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
  },
  adminCardTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#991B1B",
  },
  adminBadge: {
    backgroundColor: "#B91C1C",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    marginLeft: 6,
  },
  adminBadgeTxt: {
    color: "white",
    fontSize: 9,
    fontWeight: "800",
  },
  adminCardSub: {
    fontSize: 11,
    color: "#7F1D1D",
    marginTop: 2,
    lineHeight: 15,
  },
  partnerSection: {
    marginBottom: 16,
  },
  partnerSectionTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: DARK,
    marginBottom: 8,
    marginLeft: 2,
  },
  partnerCard: {
    borderRadius: 16,
    padding: 14,
    borderWidth: 1.5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  partnerCardLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 8,
  },
  partnerIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  partnerCardTitle: {
    fontSize: 14,
    fontWeight: "800",
  },
  partnerCardSub: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
});
