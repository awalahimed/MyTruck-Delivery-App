import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useNavigation } from "@react-navigation/native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import {
  PlusIcon,
  TrashIcon,
  CheckCircleIcon,
  MapPinIcon,
  BuildingOfficeIcon,
  HomeIcon,
} from "react-native-heroicons/outline";
import { CheckCircleIcon as CheckSolid } from "react-native-heroicons/solid";
import { UserAuth } from "../contexts/AuthContext";
import { db } from "../firebase";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { useDispatch, useSelector } from "react-redux";
import { setUser, selectUser } from "../features/userSlice";
import BackButton from "../components/ui/BackButton";
import DeliveryLocationModal from "../components/DeliveryLocationModal";

const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";
const BG = "#F5FAF9";

export default function DeliveryAddressesScreen() {
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const reduxUser = useSelector(selectUser);
  const { user, dbUser } = UserAuth();

  const [addresses, setAddresses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);

  // New address form state
  const [newLabel, setNewLabel] = useState("Home"); // "Home" | "Work" | "Other"
  const [newAddressText, setNewAddressText] = useState("");
  const [newCoords, setNewCoords] = useState({ latitude: 8.9806, longitude: 38.7578 });

  useEffect(() => {
    async function loadSavedAddresses() {
      if (!user?.uid) {
        setLoading(false);
        return;
      }
      try {
        const snap = await getDoc(doc(db, "user", user.uid));
        if (snap.exists()) {
          const data = snap.data();
          const list = Array.isArray(data.savedAddresses) ? data.savedAddresses : [];
          // If no saved addresses list, initialize with current user address
          if (list.length === 0 && (data.address || reduxUser?.address)) {
            const initialAddr = {
              id: "addr-default",
              label: "Home",
              address: data.address || reduxUser?.address || "My Location, Ethiopia",
              latitude: Number(data.latitude || reduxUser?.latitude || 8.9806),
              longitude: Number(data.longitude || reduxUser?.longitude || 38.7578),
              isDefault: true,
            };
            setAddresses([initialAddr]);
          } else {
            setAddresses(list);
          }
        }
      } catch (e) {
        console.warn("Could not load addresses:", e?.message);
      } finally {
        setLoading(false);
      }
    }

    loadSavedAddresses();
  }, [user?.uid]);

  const saveToFirestore = async (newList) => {
    setSaving(true);
    try {
      if (user?.uid) {
        await updateDoc(doc(db, "user", user.uid), {
          savedAddresses: newList,
        });
      }
    } catch (e) {
      console.warn("Could not save addresses:", e?.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (targetId) => {
    const updated = addresses.map((a) => ({
      ...a,
      isDefault: a.id === targetId,
    }));
    setAddresses(updated);
    await saveToFirestore(updated);

    const defaultAddr = updated.find((a) => a.id === targetId);
    if (defaultAddr) {
      dispatch(
        setUser({
          ...(reduxUser || {}),
          address: defaultAddr.address,
          latitude: defaultAddr.latitude,
          longitude: defaultAddr.longitude,
        })
      );
      if (user?.uid) {
        await updateDoc(doc(db, "user", user.uid), {
          address: defaultAddr.address,
          latitude: defaultAddr.latitude,
          longitude: defaultAddr.longitude,
        });
      }
    }
  };

  const handleDeleteAddress = (targetId) => {
    Alert.alert("Delete Address", "Are you sure you want to remove this address?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const updated = addresses.filter((a) => a.id !== targetId);
          setAddresses(updated);
          await saveToFirestore(updated);
        },
      },
    ]);
  };

  const handleSaveNewAddress = async () => {
    if (!newAddressText.trim()) {
      Alert.alert("Missing Address", "Please enter or pick an address.");
      return;
    }

    const newEntry = {
      id: `addr-${Date.now()}`,
      label: newLabel,
      address: newAddressText.trim(),
      latitude: newCoords.latitude,
      longitude: newCoords.longitude,
      isDefault: addresses.length === 0,
    };

    const updated = [...addresses, newEntry];
    setAddresses(updated);
    await saveToFirestore(updated);

    if (newEntry.isDefault) {
      dispatch(
        setUser({
          ...(reduxUser || {}),
          address: newEntry.address,
          latitude: newEntry.latitude,
          longitude: newEntry.longitude,
        })
      );
    }

    setShowAddModal(false);
    setNewAddressText("");
  };

  const getLabelIcon = (label) => {
    if (label === "Home") return <HomeIcon size={20} color={TEAL} />;
    if (label === "Work") return <BuildingOfficeIcon size={20} color={TEAL} />;
    return <MapPinIcon size={20} color={TEAL} />;
  };

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <StatusBar style="light" backgroundColor={TEAL} />

      {/* Enhanced Teal Header matching My Orders */}
      <View style={s.header}>
        <BackButton fallbackRoute="Options" iconColor="white" />
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>Delivery Addresses</Text>
          <Text style={s.headerSub}>
            {addresses.length === 1 ? "1 saved location" : `${addresses.length} saved locations`}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => setShowAddModal(true)}
          style={s.addBtn}
          activeOpacity={0.8}
          accessibilityLabel="Add new delivery address"
        >
          <PlusIcon size={20} color="white" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={s.centerBox}>
            <ActivityIndicator size="large" color={TEAL} />
            <Text style={s.loadingTxt}>Loading your saved addresses…</Text>
          </View>
        ) : addresses.length === 0 ? (
          <View style={s.centerBox}>
            <View style={s.emptyIconCircle}>
              <MaterialCommunityIcons name="map-marker-plus-outline" size={54} color="#94A3B8" />
            </View>
            <Text style={s.emptyTitle}>No saved addresses</Text>
            <Text style={s.emptySub}>
              Add your home, work, or favorite delivery locations for 1-click checkout.
            </Text>
            <TouchableOpacity
              style={s.addFirstBtn}
              onPress={() => setShowAddModal(true)}
              activeOpacity={0.88}
            >
              <Text style={s.addFirstBtnTxt}>Add Delivery Address</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={s.sectionTitle}>Saved Locations</Text>
            {addresses.map((addr) => (
              <TouchableOpacity
                key={addr.id}
                style={[s.addressCard, addr.isDefault && s.addressCardDefault]}
                activeOpacity={0.88}
                onPress={() => handleSetDefault(addr.id)}
              >
                <View style={s.cardTopRow}>
                  <View style={s.labelBadge}>
                    {getLabelIcon(addr.label)}
                    <Text style={s.labelText}>{addr.label || "Address"}</Text>
                  </View>

                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    {addr.isDefault ? (
                      <View style={s.defaultTag}>
                        <CheckSolid size={14} color="#166534" style={{ marginRight: 4 }} />
                        <Text style={s.defaultTagTxt}>DEFAULT</Text>
                      </View>
                    ) : (
                      <TouchableOpacity
                        onPress={() => handleSetDefault(addr.id)}
                        style={s.makeDefaultBtn}
                      >
                        <Text style={s.makeDefaultBtnTxt}>Set Default</Text>
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity
                      onPress={() => handleDeleteAddress(addr.id)}
                      style={s.deleteBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <TrashIcon size={16} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                </View>

                <Text style={s.addressText}>{addr.address}</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={s.addNewCard}
              onPress={() => setShowAddModal(true)}
              activeOpacity={0.8}
            >
              <PlusIcon size={20} color={TEAL} />
              <Text style={s.addNewCardTxt}>Add Another Address</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      {/* Add Address Modal */}
      {showAddModal && (
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Add Delivery Address</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <MaterialCommunityIcons name="close" size={24} color="#64748B" />
              </TouchableOpacity>
            </View>

            {/* Label Selector (Home / Work / Other) */}
            <Text style={s.fieldLabel}>Label</Text>
            <View style={s.labelRow}>
              {["Home", "Work", "Other"].map((l) => (
                <TouchableOpacity
                  key={l}
                  style={[s.labelOption, newLabel === l && s.labelOptionActive]}
                  onPress={() => setNewLabel(l)}
                >
                  <Text style={[s.labelOptionTxt, newLabel === l && s.labelOptionTxtActive]}>
                    {l}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Address input */}
            <Text style={s.fieldLabel}>Street Address / Area</Text>
            <TextInput
              style={s.addressInput}
              placeholder="e.g. Bole Medhanialem, Behind Edna Mall"
              placeholderTextColor="#94A3B8"
              value={newAddressText}
              onChangeText={setNewAddressText}
            />

            {/* Pick on map CTA */}
            <TouchableOpacity
              style={s.pickMapBtn}
              onPress={() => setShowLocationPicker(true)}
              activeOpacity={0.85}
            >
              <MaterialCommunityIcons name="map-marker-radius" size={20} color={TEAL} />
              <Text style={s.pickMapBtnTxt}>Pin Location on Map</Text>
            </TouchableOpacity>

            {/* Save Button */}
            <TouchableOpacity
              style={s.saveAddressBtn}
              onPress={handleSaveNewAddress}
              disabled={saving}
              activeOpacity={0.88}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={s.saveAddressBtnTxt}>Save Address</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Location Picker Modal */}
      {showLocationPicker && (
        <DeliveryLocationModal
          visible={showLocationPicker}
          onClose={() => setShowLocationPicker(false)}
          initialLocation={{
            address: newAddressText || "My Location, Ethiopia",
            latitude: newCoords.latitude,
            longitude: newCoords.longitude,
          }}
          onConfirmLocation={(loc) => {
            setNewAddressText(loc.address);
            setNewCoords({ latitude: loc.latitude, longitude: loc.longitude });
          }}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
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
  headerTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  headerSub: {
    fontSize: 12,
    color: "rgba(255,255,255,0.85)",
    marginTop: 2,
  },
  addBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  centerBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    marginTop: 40,
  },
  loadingTxt: {
    color: "#64748B",
    marginTop: 10,
    fontSize: 13,
  },
  emptyIconCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: DARK,
  },
  emptySub: {
    fontSize: 12,
    color: "#64748B",
    textAlign: "center",
    marginTop: 6,
    lineHeight: 18,
  },
  addFirstBtn: {
    marginTop: 20,
    backgroundColor: TEAL,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 14,
  },
  addFirstBtnTxt: {
    color: "white",
    fontWeight: "800",
    fontSize: 14,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#64748B",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  addressCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
  },
  addressCardDefault: {
    borderColor: TEAL,
    backgroundColor: "#F0FDF9",
  },
  cardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  labelBadge: {
    flexDirection: "row",
    alignItems: "center",
  },
  labelText: {
    fontSize: 14,
    fontWeight: "800",
    color: DARK,
    marginLeft: 6,
  },
  defaultTag: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginRight: 8,
  },
  defaultTagTxt: {
    color: "#166534",
    fontSize: 10,
    fontWeight: "800",
  },
  makeDefaultBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "#F1F5F9",
    borderRadius: 6,
    marginRight: 8,
  },
  makeDefaultBtnTxt: {
    fontSize: 11,
    color: "#475569",
    fontWeight: "700",
  },
  deleteBtn: {
    padding: 4,
  },
  addressText: {
    fontSize: 13,
    color: "#475569",
    lineHeight: 18,
  },
  addNewCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: "#CBD5E1",
    borderStyle: "dashed",
    marginTop: 6,
  },
  addNewCardTxt: {
    color: TEAL,
    fontWeight: "800",
    fontSize: 14,
    marginLeft: 6,
  },
  modalOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: Platform.OS === "ios" ? 36 : 24,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: DARK,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#475569",
    marginBottom: 6,
  },
  labelRow: {
    flexDirection: "row",
    marginBottom: 14,
  },
  labelOption: {
    flex: 1,
    paddingVertical: 8,
    backgroundColor: "#F1F5F9",
    borderRadius: 10,
    alignItems: "center",
    marginRight: 8,
  },
  labelOptionActive: {
    backgroundColor: TEAL,
  },
  labelOptionTxt: {
    fontSize: 13,
    fontWeight: "700",
    color: "#475569",
  },
  labelOptionTxtActive: {
    color: "white",
  },
  addressInput: {
    height: 46,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 13,
    color: DARK,
    marginBottom: 12,
  },
  pickMapBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F0FDF9",
    borderWidth: 1,
    borderColor: "#CCFBF1",
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 16,
  },
  pickMapBtnTxt: {
    color: TEAL,
    fontWeight: "700",
    fontSize: 13,
    marginLeft: 6,
  },
  saveAddressBtn: {
    backgroundColor: TEAL,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  saveAddressBtnTxt: {
    color: "white",
    fontWeight: "800",
    fontSize: 15,
  },
});

