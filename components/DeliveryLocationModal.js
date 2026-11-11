import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  StyleSheet,
  Dimensions,
  Platform,
  ScrollView,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
} from "react-native";
import { Marker } from "react-native-maps";
import SharedMapView from "./SharedMapView";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { XMarkIcon } from "react-native-heroicons/outline";
import {
  DEFAULT_COORDS,
  ADDIS_DELIVERY_ZONES,
  reverseGeocodeLocation,
  searchPlaces,
  requestGpsLocation,
  isWithinEthiopia,
} from "../utils/mapService";

const { width, height } = Dimensions.get("window");
const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";

export default function DeliveryLocationModal({
  visible,
  onClose,
  initialLocation,
  onConfirmLocation,
}) {
  const mapRef = useRef(null);
  const safeInitCoords = () => {
    const lat = Number(initialLocation?.latitude);
    const lon = Number(initialLocation?.longitude);
    if (isWithinEthiopia(lat, lon)) {
      return { latitude: lat, longitude: lon };
    }
    return {
      latitude: DEFAULT_COORDS.latitude,
      longitude: DEFAULT_COORDS.longitude,
    };
  };

  const [selectedCoords, setSelectedCoords] = useState(safeInitCoords);
  const [resolvedAddress, setResolvedAddress] = useState(
    initialLocation?.address && !initialLocation.address.includes("Montana") && !initialLocation.address.includes("Cascade")
      ? initialLocation.address
      : "My Location, Ethiopia"
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [selectedZoneId, setSelectedZoneId] = useState("bole");

  // When modal becomes visible, update address
  useEffect(() => {
    if (visible && selectedCoords.latitude && selectedCoords.longitude) {
      updateAddressFromCoords(selectedCoords.latitude, selectedCoords.longitude);
    }
  }, [visible]);

  const updateAddressFromCoords = async (lat, lon) => {
    const safeLat = isWithinEthiopia(lat, lon) ? lat : DEFAULT_COORDS.latitude;
    const safeLon = isWithinEthiopia(lat, lon) ? lon : DEFAULT_COORDS.longitude;
    setGeocoding(true);
    try {
      const addr = await reverseGeocodeLocation(safeLat, safeLon);
      if (addr && !addr.includes("Montana") && !addr.includes("Cascade") && !addr.includes("United States")) {
        setResolvedAddress(addr);
      } else {
        setResolvedAddress("My Location, Ethiopia");
      }
    } catch (_) {
      setResolvedAddress("My Location, Ethiopia");
    } finally {
      setGeocoding(false);
    }
  };

  const handleMapPress = (e) => {
    const coords = e?.nativeEvent?.coordinate;
    if (coords && coords.latitude && coords.longitude) {
      setSelectedCoords(coords);
      setSelectedZoneId(null);
      updateAddressFromCoords(coords.latitude, coords.longitude);
    }
  };

  const handleMarkerDragEnd = (e) => {
    const coords = e?.nativeEvent?.coordinate;
    if (coords && coords.latitude && coords.longitude) {
      setSelectedCoords(coords);
      setSelectedZoneId(null);
      updateAddressFromCoords(coords.latitude, coords.longitude);
    }
  };

  const handleUseGps = async () => {
    setGpsLoading(true);
    try {
      const coords = await requestGpsLocation();
      setSelectedCoords(coords);
      setSelectedZoneId(null);
      if (mapRef.current) {
        mapRef.current.animateToRegion({
          latitude: coords.latitude,
          longitude: coords.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        });
      }
      await updateAddressFromCoords(coords.latitude, coords.longitude);
    } catch (err) {
      Alert.alert("GPS Error", err.message || "Could not retrieve your location.");
    } finally {
      setGpsLoading(false);
    }
  };

  const handleSelectZone = (zone) => {
    setSelectedZoneId(zone.id);
    const coords = { latitude: zone.latitude, longitude: zone.longitude };
    setSelectedCoords(coords);
    setResolvedAddress(`${zone.name}${zone.sub ? ` (${zone.sub})` : ""}`);
    if (mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: zone.latitude,
        longitude: zone.longitude,
        latitudeDelta: 0.012,
        longitudeDelta: 0.012,
      });
    }
  };

  const handleSearch = async (text) => {
    setSearchQuery(text);
    if (text.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const places = await searchPlaces(text);
      setSearchResults(places);
    } finally {
      setSearching(false);
    }
  };

  const handleSelectPlace = (place) => {
    const coords = {
      latitude: place.latitude,
      longitude: place.longitude,
    };
    setSelectedCoords(coords);
    setSelectedZoneId(null);
    setResolvedAddress(place.title);
    setSearchResults([]);
    setSearchQuery("");
    if (mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: coords.latitude,
        longitude: coords.longitude,
        latitudeDelta: 0.012,
        longitudeDelta: 0.012,
      });
    }
  };

  const handleConfirm = () => {
    const safeLat = isWithinEthiopia(selectedCoords.latitude, selectedCoords.longitude)
      ? selectedCoords.latitude
      : DEFAULT_COORDS.latitude;
    const safeLon = isWithinEthiopia(selectedCoords.latitude, selectedCoords.longitude)
      ? selectedCoords.longitude
      : DEFAULT_COORDS.longitude;
    const safeAddr =
      resolvedAddress && !resolvedAddress.includes("Montana") && !resolvedAddress.includes("Cascade")
        ? resolvedAddress
        : "My Location, Ethiopia";

    onConfirmLocation({
      address: safeAddr,
      latitude: safeLat,
      longitude: safeLon,
    });
    onClose();
  };

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
      statusBarTranslucent={true}
    >
      {/* Overlay — tapping backdrop dismisses keyboard only, not the modal */}
      <View style={s.modalOverlay}>
        {/* Bottom sheet — fixed height, keyboard does NOT push this up */}
        <KeyboardAvoidingView
          style={s.sheetOuter}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={0}
        >
          <View style={s.sheet}>
            {/* Header */}
            <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
              <View style={s.header}>
                <View>
                  <Text style={s.title}>Choose Delivery Location</Text>
                  <Text style={s.subtitle}>Tap map or drag pin to your exact spot</Text>
                </View>
                <TouchableOpacity onPress={onClose} style={s.closeBtn}>
                  <XMarkIcon size={22} color="#64748B" />
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>

            {/* Search section — stays visible above keyboard */}
            <View style={s.searchSection}>
              {/* Search bar */}
              <View style={s.searchWrap}>
                <MaterialCommunityIcons name="magnify" size={20} color={TEAL} style={s.searchIcon} />
                <TextInput
                  style={s.searchInput}
                  placeholder="Search city or area (e.g. Bole, Hawassa, Mekelle)..."
                  placeholderTextColor="#94A3B8"
                  value={searchQuery}
                  onChangeText={handleSearch}
                  returnKeyType="search"
                  autoCorrect={false}
                  autoCapitalize="none"
                  blurOnSubmit={false}
                  onSubmitEditing={() => {
                    if (searchQuery.trim().length >= 2) handleSearch(searchQuery);
                  }}
                />
                {searching ? (
                  <ActivityIndicator size="small" color={TEAL} style={{ marginRight: 8 }} />
                ) : searchQuery.length > 0 ? (
                  <TouchableOpacity
                    onPress={() => { setSearchQuery(""); setSearchResults([]); }}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <MaterialCommunityIcons name="close-circle" size={18} color="#94A3B8" />
                  </TouchableOpacity>
                ) : null}
              </View>

              {/* Search results dropdown — appears OVER the map, z-index above everything */}
              {searchResults.length > 0 && (
                <ScrollView
                  style={s.resultsList}
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled
                >
                  {searchResults.map((item) => (
                    <TouchableOpacity
                      key={item.id}
                      style={s.resultItem}
                      onPress={() => { Keyboard.dismiss(); handleSelectPlace(item); }}
                    >
                      <MaterialCommunityIcons name="map-marker-outline" size={18} color={TEAL} />
                      <View style={{ flex: 1, marginLeft: 8 }}>
                        <Text style={s.resultTitle}>{String(item.title || "")}</Text>
                        <Text style={s.resultSub} numberOfLines={2}>
                          {String(item.fullAddress || "")}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </View>

            {/* Quick Delivery Zone Pills */}
            <View style={s.zoneBar}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.zoneScroll} keyboardShouldPersistTaps="handled">
                {ADDIS_DELIVERY_ZONES.map((zone) => {
                  const active = selectedZoneId === zone.id;
                  return (
                    <TouchableOpacity
                      key={zone.id}
                      style={[s.zonePill, active && s.zonePillActive]}
                      onPress={() => { Keyboard.dismiss(); handleSelectZone(zone); }}
                      activeOpacity={0.75}
                    >
                      <MaterialCommunityIcons
                        name="map-marker"
                        size={13}
                        color={active ? "white" : TEAL}
                        style={{ marginRight: 4 }}
                      />
                      <Text style={[s.zonePillTxt, active && s.zonePillTxtActive]}>{String(zone.name || "")}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* Map view — flex: 1 so it shrinks on iOS when keyboard is open */}
            <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
              <View style={s.mapContainer}>
                <SharedMapView
                  ref={mapRef}
                  style={StyleSheet.absoluteFillObject}
                  initialRegion={{
                    latitude: selectedCoords.latitude || DEFAULT_COORDS.latitude,
                    longitude: selectedCoords.longitude || DEFAULT_COORDS.longitude,
                    latitudeDelta: 0.02,
                    longitudeDelta: 0.02,
                  }}
                  onLocationChange={(coords) => {
                    if (coords?.latitude && coords?.longitude) {
                      setSelectedCoords(coords);
                      setSelectedZoneId(null);
                      updateAddressFromCoords(coords.latitude, coords.longitude);
                    }
                  }}
                  onPress={handleMapPress}
                  onRecenter={handleUseGps}
                  recenterLoading={gpsLoading}
                />
              </View>
            </TouchableWithoutFeedback>

            {/* Footer — selected address card & confirm button */}
            <View style={s.footer}>
              <View style={s.addressRow}>
                <View style={s.addressIconWrap}>
                  <MaterialCommunityIcons name="map-marker-check" size={24} color={TEAL} />
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={s.addressLabel}>Selected Address</Text>
                  {geocoding ? (
                    <ActivityIndicator size="small" color={TEAL} style={{ alignSelf: "flex-start", marginTop: 2 }} />
                  ) : (
                    <Text style={s.addressText} numberOfLines={2}>
                      {String(resolvedAddress || "My Location, Ethiopia")}
                    </Text>
                  )}
                </View>
              </View>

              <TouchableOpacity
                style={s.confirmBtn}
                onPress={handleConfirm}
                activeOpacity={0.85}
              >
                <Text style={s.confirmBtnTxt}>Confirm Delivery Location</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheetOuter: {
    // On Android: KeyboardAvoidingView with behavior=undefined, sheet stays put
    // On iOS: behavior="padding" so footer lifts just enough
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "white",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: height * 0.88,
    overflow: "visible", // allow search results to float above map
    flexDirection: "column",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#EDF2F1",
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: DARK,
  },
  subtitle: {
    fontSize: 12,
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
  // Search section: contains both input and floating dropdown
  searchSection: {
    zIndex: 999,
    elevation: 999,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    marginHorizontal: 16,
    marginVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    zIndex: 999,
    elevation: 999,
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    height: 44,
    fontSize: 14,
    color: DARK,
    paddingVertical: 0,
  },
  // Results float above the map (absolute + zIndex)
  resultsList: {
    position: "absolute",
    top: 62, // height of searchWrap (44) + marginVertical (10+8)
    left: 16,
    right: 16,
    backgroundColor: "white",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    maxHeight: 220,
    zIndex: 1000,
    elevation: 1000,
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
  },
  resultItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  resultTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: DARK,
  },
  resultSub: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 1,
  },
  zoneBar: {
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
    zIndex: 1,
  },
  zoneScroll: {
    paddingHorizontal: 16,
  },
  zonePill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F0FDF9",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#CCFBF1",
    marginRight: 6,
  },
  zonePillActive: {
    backgroundColor: TEAL,
    borderColor: TEAL,
  },
  zonePillTxt: {
    fontSize: 12,
    fontWeight: "700",
    color: TEAL,
  },
  zonePillTxtActive: {
    color: "white",
  },
  mapContainer: {
    flex: 1,
    backgroundColor: "#E2E8F0",
    position: "relative",
    zIndex: 0,
  },
  pinWrapper: {
    alignItems: "center",
  },
  pinCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: ORANGE,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
  },
  pinStem: {
    width: 4,
    height: 6,
    backgroundColor: ORANGE,
  },
  gpsButton: {
    position: "absolute",
    right: 16,
    bottom: 20,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "white",
    alignItems: "center",
    justifyContent: "center",
    elevation: 5,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  footer: {
    backgroundColor: "white",
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: Platform.OS === "ios" ? 34 : 20,
    borderTopWidth: 1,
    borderTopColor: "#EDF2F1",
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
    backgroundColor: "#F5FAF9",
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E0EBE9",
  },
  addressIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#E6F4F1",
    alignItems: "center",
    justifyContent: "center",
  },
  addressLabel: {
    fontSize: 11,
    color: "#64748B",
    fontWeight: "600",
  },
  addressText: {
    fontSize: 14,
    fontWeight: "800",
    color: DARK,
    marginTop: 2,
  },
  confirmBtn: {
    backgroundColor: TEAL,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
  },
  confirmBtnTxt: {
    color: "white",
    fontWeight: "800",
    fontSize: 16,
  },
});
