import React, { useEffect, useLayoutEffect, useState, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Modal,
  StyleSheet,
  Alert,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { MapPinIcon, StarIcon } from "react-native-heroicons/solid";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { PlusIcon, MinusIcon, XMarkIcon } from "react-native-heroicons/outline";
import BasketIcon from "../components/BasketIcon";
import { useDispatch, useSelector } from "react-redux";
import { setRestaurant } from "../features/restaurantSlice";
import { addToBasket, selectBasketItemsWithId } from "../features/basketSlice";
import { selectUser } from "../features/userSlice";
import { db } from "../firebase";
import { collection, getDocs, query, where, getDoc, doc } from "firebase/firestore";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import BackButton from "../components/ui/BackButton";
import ResilientImage from "../components/ui/ResilientImage";
import {
  getCustomerPrice,
  getItemDiscountInfo,
  FAR_DISTANCE_NOTICE,
  isFarDistance,
  calculateDistanceKm,
  getMaxOrderDistanceKm,
} from "../utils/pricing";
import { usePricingConfig } from "../utils/usePricingConfig";

const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";

const formatETB = (amount) => {
  const num = Number(amount) || 0;
  return `ETB ${num.toFixed(2)}`;
};

export function parseTimeToMinutes(t) {
  if (!t) return null;
  const str = String(t).trim().toUpperCase();
  const match = str.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const ampm = match[3];
  if (ampm === "PM" && hours < 12) hours += 12;
  if (ampm === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

const isRestaurantOpen = (info) => {
  if (!info || info.isOpen === false || info.isAvailable === false || info.isTemporarilyClosed === true) return false;
  if (String(info.workingHours || "").toLowerCase().includes("24 hours")) return true;
  let opTime = info.openingTime;
  let clTime = info.closingTime;
  if ((!opTime || !clTime) && typeof info.workingHours === "string" && info.workingHours.includes("-")) {
    const parts = info.workingHours.split("-").map((s) => s.trim());
    if (parts.length === 2) {
      opTime = parts[0];
      clTime = parts[1];
    }
  }
  if (!opTime || !clTime) return info.isOpen === true;
  const now = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Addis_Ababa",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
  const current = parseTimeToMinutes(now);
  const opening = parseTimeToMinutes(opTime);
  const closing = parseTimeToMinutes(clTime);
  if (current == null || opening == null || closing == null) return false;
  if (opening === closing) return true;
  return opening <= closing
    ? current >= opening && current < closing
    : current >= opening || current < closing;
};

export default function RestaurantDetails() {
  // Re-render with the Super Admin's live pricing
  const pricingConfig = usePricingConfig();
  const navigation = useNavigation();
  // Full-bleed hero: float the back button and toast below the status bar / notch
  const insets = useSafeAreaInsets();
  const floatTop = Math.max(insets.top, 24) + 10;
  const dispatch = useDispatch();
  const route = useRoute();
  const restaurantUid = route?.params?.id || route?.params?.restaurantId || "";

  const [dishes, setDishes] = useState([]);
  const [restaurantInfo, setRestaurantInfo] = useState({
    name: route?.params?.title || route?.params?.name || "Restaurant",
    image: route?.params?.imgUrl || route?.params?.image || "",
    rating: route?.params?.rating,
    reviews: route?.params?.reviews,
    deliveryTime: route?.params?.deliveryTime,
    genre: route?.params?.genre || "",
    address: route?.params?.address || "",
    description: route?.params?.short_description || route?.params?.description || "",
    latitude: Number(route?.params?.lat || route?.params?.latitude || 8.992),
    longitude: Number(route?.params?.lng || route?.params?.longitude || 38.752),
  });
  const [loading, setLoading] = useState(true);
  const [menuSearch, setMenuSearch] = useState("");

  const reduxUser = useSelector(selectUser);
  const userCoords = useMemo(() => ({
    latitude: Number(reduxUser?.latitude) || 8.9806,
    longitude: Number(reduxUser?.longitude) || 38.7578,
  }), [reduxUser?.latitude, reduxUser?.longitude]);

  const restaurantCoords = useMemo(() => ({
    latitude: Number(restaurantInfo.latitude || route?.params?.lat || route?.params?.latitude || 8.992),
    longitude: Number(restaurantInfo.longitude || route?.params?.lng || route?.params?.longitude || 38.752),
  }), [restaurantInfo.latitude, restaurantInfo.longitude, route?.params?.lat, route?.params?.latitude, route?.params?.lng, route?.params?.longitude]);

  const isTooFar = useMemo(() => {
    const maxRadius = Number(restaurantInfo.deliveryRadiusKm) || getMaxOrderDistanceKm("restaurant");
    return isFarDistance(restaurantCoords, userCoords, maxRadius, "restaurant");
  }, [restaurantCoords, userCoords, restaurantInfo.deliveryRadiusKm]);

  const distanceKm = useMemo(() => {
    return calculateDistanceKm(restaurantCoords.latitude, restaurantCoords.longitude, userCoords.latitude, userCoords.longitude);
  }, [restaurantCoords, userCoords]);

  // Add to Cart Confirmation Modal state (Phase 6.2)
  const [selectedDish, setSelectedDish] = useState(null);
  const [modalQuantity, setModalQuantity] = useState(1);
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [toastMessage, setToastMessage] = useState("");

  const getImageSource = () => {
    const img = restaurantInfo.image || route?.params?.imgUrl || route?.params?.image;
    if (img && typeof img === "object") return img;
    return typeof img === "string" ? img : null;
  };

  useEffect(() => {
    let active = true;

    async function loadData() {
      setLoading(true);
      let rData = null;

      // 1. Fetch restaurant info
      try {
        if (restaurantUid) {
          const docSnap = await getDoc(doc(db, "restaurants", restaurantUid));
          if (docSnap.exists() && active) {
            rData = docSnap.data();
            setRestaurantInfo(rData);
            dispatch(
              setRestaurant({
                id: restaurantUid,
                name: rData.name,
                rating: rData.rating,
                address: rData.address,
                description: rData.description,
                image: rData.image,
                lat: rData.lat,
                lng: rData.lng,
                minDeliveryTime: rData.minDeliveryTime,
                maxDeliveryTime: rData.maxDeliveryTime,
              })
            );
          }
        }
      } catch (e) {
        console.warn("RestaurantDetails: could not load restaurant", e?.message);
      }

      // 2. Fetch only approved, available dishes from the restaurant menu
      try {
        let items = [];
        if (restaurantUid) {
          const dishRef = collection(db, "dishes");
          const q = query(dishRef, where("restaurantId", "==", restaurantUid));
          const snapshot = await getDocs(q);
          snapshot.forEach((d) => {
            const data = d.data();
            const status = String(data.status || data.lifecycleStatus || "").trim().toUpperCase();
            const approved = data.isApproved === true || data.isPublished === true || status === "APPROVED" || status === "PUBLISHED";
            if (approved && data.isAvailable !== false && data.isActive !== false) {
              items.push({ ...data, id: d.id });
            }
          });
        }

        if (active) setDishes(items);
      } catch (e) {
        console.warn("RestaurantDetails: error loading dishes", e?.message);
        if (active) setDishes([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadData();

    return () => {
      active = false;
    };
  }, [restaurantUid]);

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, []);

  const open = isRestaurantOpen(restaurantInfo);

  // Filter dishes by search query
  const filteredDishes = useMemo(() => {
    const q = menuSearch.trim().toLowerCase();
    if (!q) return dishes;
    return dishes.filter(
      (d) =>
        d.name?.toLowerCase().includes(q) ||
        d.description?.toLowerCase().includes(q)
    );
  }, [dishes, menuSearch]);

  const handleOpenDishModal = (dish) => {
    if (!open) {
      Alert.alert(
        "Restaurant Currently Closed",
        `"${restaurantInfo.name}" is currently closed and not taking orders.\n\nOpening hours: ${String(restaurantInfo.workingHours || "").toLowerCase().includes("24 hours") ? "Open 24 hours" : restaurantInfo.openingTime && restaurantInfo.closingTime ? `${restaurantInfo.openingTime} – ${restaurantInfo.closingTime}` : "Hours not set"}`
      );
      return;
    }
    if (isTooFar) {
      Alert.alert("Outside Delivery Area", FAR_DISTANCE_NOTICE);
      return;
    }
    setSelectedDish(dish);
    setModalQuantity(1);
    setSpecialInstructions("");
  };

  const handleConfirmAddToCart = () => {
    if (!selectedDish) return;
    if (!open) {
      Alert.alert(
        "Restaurant Currently Closed",
        `"${restaurantInfo.name}" is currently closed and not taking orders.`
      );
      return;
    }
    if (isTooFar) {
      Alert.alert("Outside Delivery Area", FAR_DISTANCE_NOTICE);
      return;
    }
    const info = getItemDiscountInfo(selectedDish);
    for (let i = 0; i < modalQuantity; i++) {
      dispatch(
        addToBasket({
          id: selectedDish.id,
          dishId: selectedDish.id,
          restaurantId: selectedDish.restaurantId || restaurantUid,
          restaurantName: restaurantInfo.name,
          name: selectedDish.name,
          description: selectedDish.description,
          price: info.customerSellingPrice,
          merchantBasePrice: info.rawSellingPrice,
          originalPrice: info.customerOriginalPrice,
          discountedPrice: info.customerSellingPrice,
          hasDiscount: info.hasDiscount,
          discountPercent: info.discountPercent,
          savingsAmount: info.savingsAmount,
          image: selectedDish.image,
          specialInstructions: specialInstructions.trim(),
        })
      );
    }

    const dishName = selectedDish.name;
    const qty = modalQuantity;
    setSelectedDish(null);

    // Show feedback toast
    setToastMessage(`Added ${qty}x ${dishName} to cart!`);
    setTimeout(() => setToastMessage(""), 3000);
  };


  return (
    <View style={s.container}>
      <StatusBar style="light" />
      <BasketIcon />

      {/* Confirmation Toast */}
      {toastMessage ? (
        <View style={[s.toast, { top: floatTop }]}>
          <MaterialCommunityIcons name="check-circle" size={18} color="white" />
          <Text style={s.toastTxt}>{toastMessage}</Text>
        </View>
      ) : null}

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Hero Image */}
        <View style={s.heroWrapper}>
          <ResilientImage
            source={getImageSource()}
            fallbackCategory="none"
            style={s.heroImg}
            resizeMode="cover"
          />
          <BackButton
            fallbackRoute="HomeTab"
            style={[s.backBtn, { top: floatTop }]}
          />
        </View>

        {/* Restaurant Header Information */}
        <View style={s.infoSection}>
          <Text style={s.restaurantName}>{restaurantInfo.name}</Text>
          <View
            style={[
              s.openPill,
              { backgroundColor: open ? "#E6F7F1" : "#FFF1E8" },
            ]}
          >
            <Text style={{ color: open ? "#087F5B" : "#B54708", fontWeight: "700", fontSize: 12 }}>
              {open
                ? (String(restaurantInfo.workingHours || "").toLowerCase().includes("24 hours")
                    ? "Open 24 hours"
                    : restaurantInfo.openingTime && restaurantInfo.closingTime
                    ? `Open now · ${restaurantInfo.openingTime}–${restaurantInfo.closingTime}`
                    : "Open now")
                : (restaurantInfo.openingTime && restaurantInfo.closingTime
                    ? `Closed now · Hours ${restaurantInfo.openingTime}–${restaurantInfo.closingTime}`
                    : "Closed · Hours not set")}
            </Text>
          </View>

          {(restaurantInfo.rating != null || restaurantInfo.deliveryTime) ? (
            <View style={s.metaRow}>
              {restaurantInfo.rating != null ? <>
                <StarIcon color="#10B981" size={18} />
                <Text style={s.metaRating}>{restaurantInfo.rating}</Text>
                {restaurantInfo.reviews != null ? <Text style={s.metaSub}>({restaurantInfo.reviews})</Text> : null}
              </> : null}
              {restaurantInfo.deliveryTime ? <>
                <Text style={s.metaDot}>·</Text>
                <MaterialCommunityIcons name="clock-outline" size={15} color="#64748B" />
                <Text style={s.metaSub}>{restaurantInfo.deliveryTime}</Text>
              </> : null}
            </View>
          ) : null}

          <View style={s.addressRow}>
            <MapPinIcon color="#94A3B8" size={17} />
            <Text style={s.addressTxt}>{restaurantInfo.address || "Address not provided"}</Text>
          </View>

          {isTooFar && (
            <View
              style={{
                backgroundColor: "#FEF2F2",
                borderColor: "#FECACA",
                borderWidth: 1,
                borderRadius: 10,
                padding: 10,
                marginTop: 10,
                flexDirection: "row",
                alignItems: "center",
              }}
            >
              <MaterialCommunityIcons name="alert-circle" size={18} color="#DC2626" />
              <Text style={{ fontSize: 12, color: "#991B1B", fontWeight: "600", marginLeft: 8, flex: 1, lineHeight: 16 }}>
                {FAR_DISTANCE_NOTICE} ({distanceKm} km away)
              </Text>
            </View>
          )}

          {Boolean(restaurantInfo.description) && (
            <Text style={s.descTxt}>{restaurantInfo.description}</Text>
          )}
        </View>

        {/* Menu Section with Search Input (Phase 6.2) */}
        <View style={s.menuSection}>
          <View style={s.menuHeaderRow}>
            <Text style={s.menuTitle}>Menu</Text>
            <Text style={s.menuCount}>{dishes.length} items</Text>
          </View>

          {/* Menu Search Bar */}
          <View style={s.menuSearchWrap}>
            <MaterialCommunityIcons name="magnify" size={18} color="#64748B" />
            <TextInput
              style={s.menuSearchInput}
              placeholder="Search dishes (e.g. burger, pizza, salad)..."
              placeholderTextColor="#94A3B8"
              value={menuSearch}
              onChangeText={setMenuSearch}
            />
            {menuSearch ? (
              <TouchableOpacity onPress={() => setMenuSearch("")}>
                <MaterialCommunityIcons name="close-circle" size={16} color="#94A3B8" />
              </TouchableOpacity>
            ) : null}
          </View>

          {loading ? (
            <ActivityIndicator size="large" color={TEAL} style={{ marginTop: 20 }} />
          ) : filteredDishes.length === 0 ? (
            <View style={s.emptyMenu}>
              <MaterialCommunityIcons name="silverware-fork-knife" size={42} color="#CBD5E1" />
              <Text style={s.emptyMenuTxt}>
                {menuSearch ? `No dishes match "${menuSearch}"` : "No menu items available yet."}
              </Text>
            </View>
          ) : (
            filteredDishes.map((dish) => {
              const info = getItemDiscountInfo(dish);
              return (
                <TouchableOpacity
                  key={dish.id}
                  style={s.dishCard}
                  activeOpacity={0.88}
                  onPress={() => handleOpenDishModal(dish)}
                >
                  <View style={s.dishContent}>
                    <Text style={s.dishName}>{dish.name}</Text>
                    {Boolean(dish.description) && (
                      <Text style={s.dishDesc} numberOfLines={2}>{dish.description}</Text>
                    )}
                    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 5, marginTop: 3 }}>
                      <Text style={[s.dishPrice, { color: info.hasDiscount ? "#E11D48" : DARK }]}>{info.formattedSelling}</Text>
                      {info.hasDiscount ? <>
                        <Text style={{ fontSize: 11.5, color: "#94A3B8", textDecorationLine: "line-through" }}>{info.formattedOriginal}</Text>
                        <View style={{ backgroundColor: "#FEE2E2", paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3 }}>
                          <Text style={{ fontSize: 9.5, fontWeight: "800", color: "#E11D48" }}>-{info.discountPercent}% OFF</Text>
                        </View>
                      </> : null}
                    </View>
                    {info.hasDiscount ? <Text style={{ fontSize: 10, color: "#16A34A", fontWeight: "700", marginTop: 2 }}>
                      Save ETB {(Number(info.savingsAmount) || 0).toFixed(0)}
                    </Text> : null}
                  </View>

                  <View style={s.dishRight}>
                    <ResilientImage
                      source={dish.image || dish.imgUrl}
                      fallbackCategory="none"
                      style={s.dishImg}
                      resizeMode="cover"
                    />
                    <TouchableOpacity
                      style={s.addBtn}
                      onPress={() => handleOpenDishModal(dish)}
                      activeOpacity={0.85}
                    >
                      <PlusIcon size={14} color="white" />
                      <Text style={s.addBtnTxt}>Add</Text>
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              );
            })
          )}

        </View>
      </ScrollView>

      {/* Add to Cart Confirmation Modal (Phase 6.2) */}
      <Modal
        visible={Boolean(selectedDish)}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedDish(null)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            {/* Modal Header */}
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Confirm Item</Text>
              <TouchableOpacity onPress={() => setSelectedDish(null)}>
                <XMarkIcon size={22} color="#64748B" />
              </TouchableOpacity>
            </View>

            {selectedDish && (
              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Dish image and details */}
                <ResilientImage
                  source={selectedDish.image || selectedDish.imgUrl}
                  fallbackCategory="none"
                  style={s.modalDishImg}
                  resizeMode="cover"
                />

                <View style={s.modalDetails}>
                  <Text style={s.modalDishName}>{selectedDish.name}</Text>
                  <Text style={s.modalRestaurantName}>From {restaurantInfo.name}</Text>
                  {(() => {
                    const modalInfo = getItemDiscountInfo(selectedDish);
                    return (
                      <View style={{ marginVertical: 4 }}>
                        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                          <Text style={[s.modalDishPrice, { color: modalInfo.hasDiscount ? "#E11D48" : DARK }]}>{modalInfo.formattedSelling} each</Text>
                          {modalInfo.hasDiscount ? <>
                            <Text style={{ fontSize: 12, color: "#94A3B8", textDecorationLine: "line-through" }}>{modalInfo.formattedOriginal}</Text>
                            <View style={{ backgroundColor: "#FEE2E2", paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 }}>
                              <Text style={{ fontSize: 10, fontWeight: "800", color: "#E11D48" }}>-{String(modalInfo.discountPercent)}% OFF</Text>
                            </View>
                          </> : null}
                        </View>
                        {modalInfo.hasDiscount ? <Text style={{ fontSize: 11, color: "#16A34A", fontWeight: "700", marginTop: 2 }}>
                          You save ETB {(Number(modalInfo.savingsAmount || 0) * modalQuantity).toFixed(2)} on this order!
                        </Text> : null}
                      </View>
                    );
                  })()}

                  {Boolean(selectedDish.description) && (
                    <Text style={s.modalDishDesc}>{selectedDish.description}</Text>
                  )}

                  {/* Quantity Selector */}
                  <View style={s.modalQtyRow}>
                    <Text style={s.modalQtyLabel}>Quantity</Text>
                    <View style={s.modalQtyPicker}>
                      <TouchableOpacity
                        style={s.modalQtyBtn}
                        onPress={() => setModalQuantity((q) => Math.max(1, q - 1))}
                      >
                        <MinusIcon size={16} color={TEAL} />
                      </TouchableOpacity>
                      <Text style={s.modalQtyVal}>{modalQuantity}</Text>
                      <TouchableOpacity
                        style={s.modalQtyBtn}
                        onPress={() => setModalQuantity((q) => q + 1)}
                      >
                        <PlusIcon size={16} color={TEAL} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* Special Instructions */}
                  <Text style={s.modalInstLabel}>Special Instructions</Text>
                  <TextInput
                    style={s.modalInstInput}
                    placeholder="e.g. Extra spicy, sauce on side, no onions"
                    placeholderTextColor="#94A3B8"
                    value={specialInstructions}
                    onChangeText={setSpecialInstructions}
                    multiline
                  />

                  {/* Total calculation */}
                  {(() => {
                    const modalInfo = getItemDiscountInfo(selectedDish);
                    return (
                      <>
                        <View style={s.modalTotalRow}>
                          <Text style={s.modalTotalLabel}>Item Subtotal</Text>
                          <Text style={s.modalTotalVal}>
                            {formatETB(modalInfo.customerSellingPrice * modalQuantity)}
                          </Text>
                        </View>

                        {/* Confirm CTA */}
                        <TouchableOpacity
                          style={s.confirmAddBtn}
                          onPress={handleConfirmAddToCart}
                          activeOpacity={0.88}
                        >
                          <MaterialCommunityIcons name="cart-plus" size={20} color="white" />
                          <Text style={s.confirmAddBtnTxt}>
                            Add to Cart · {formatETB(modalInfo.customerSellingPrice * modalQuantity)}
                          </Text>
                        </TouchableOpacity>
                      </>
                    );
                  })()}
                </View>

              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  toast: {
    position: "absolute",
    top: 50,
    alignSelf: "center",
    backgroundColor: DARK,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 24,
    flexDirection: "row",
    alignItems: "center",
    zIndex: 999,
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  toastTxt: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 13,
    marginLeft: 8,
  },
  heroWrapper: {
    position: "relative",
    width: "100%",
    height: 230,
    backgroundColor: "#E2E8F0",
  },
  heroImg: {
    width: "100%",
    height: "100%",
  },
  backBtn: {
    position: "absolute",
    top: 50,
    left: 16,
    zIndex: 10,
  },
  infoSection: {
    paddingHorizontal: 16,
    paddingTop: 16,
    backgroundColor: "#FFFFFF",
  },
  restaurantName: {
    fontSize: 24,
    fontWeight: "900",
    color: DARK,
  },
  openPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 6,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  metaRating: {
    fontSize: 13.5,
    fontWeight: "800",
    color: TEAL,
    marginLeft: 4,
  },
  metaSub: {
    fontSize: 12.5,
    color: "#64748B",
    marginLeft: 4,
  },
  metaDot: {
    fontSize: 14,
    color: "#94A3B8",
    marginHorizontal: 6,
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  addressTxt: {
    fontSize: 12.5,
    color: "#64748B",
    marginLeft: 4,
  },
  descTxt: {
    fontSize: 12.5,
    color: "#475569",
    marginTop: 8,
    lineHeight: 18,
  },
  menuSection: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 110,
    backgroundColor: "#F8FAFC",
    marginTop: 14,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  menuHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  menuTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: DARK,
  },
  menuCount: {
    fontSize: 12,
    color: "#64748B",
    fontWeight: "600",
  },
  menuSearchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  menuSearchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 13,
    color: DARK,
  },
  emptyMenu: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 30,
  },
  emptyMenuTxt: {
    fontSize: 13,
    color: "#94A3B8",
    marginTop: 8,
  },
  dishCard: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  dishContent: {
    flex: 1,
    paddingRight: 10,
    justifyContent: "center",
  },
  dishName: {
    fontSize: 15,
    fontWeight: "800",
    color: DARK,
  },
  dishDesc: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 3,
    lineHeight: 16,
  },
  dishPrice: {
    fontSize: 14,
    fontWeight: "800",
    color: TEAL,
    marginTop: 6,
  },
  dishRight: {
    alignItems: "center",
  },
  dishImg: {
    width: 80,
    height: 80,
    borderRadius: 12,
    backgroundColor: "#F1F5F9",
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: TEAL,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: -10,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  addBtnTxt: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "800",
    marginLeft: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "85%",
    paddingBottom: 30,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: DARK,
  },
  modalDishImg: {
    width: "100%",
    height: 160,
    backgroundColor: "#F1F5F9",
  },
  modalDetails: {
    padding: 16,
  },
  modalDishName: {
    fontSize: 18,
    fontWeight: "800",
    color: DARK,
  },
  modalRestaurantName: {
    fontSize: 12.5,
    color: "#64748B",
    marginTop: 2,
  },
  modalDishPrice: {
    fontSize: 15,
    fontWeight: "800",
    color: TEAL,
    marginTop: 4,
  },
  modalDishDesc: {
    fontSize: 12.5,
    color: "#64748B",
    marginTop: 6,
    lineHeight: 18,
  },
  modalQtyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#F1F5F9",
  },
  modalQtyLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: DARK,
  },
  modalQtyPicker: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    borderRadius: 10,
    padding: 4,
  },
  modalQtyBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  modalQtyVal: {
    fontSize: 14,
    fontWeight: "800",
    color: DARK,
    paddingHorizontal: 12,
  },
  modalInstLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: DARK,
    marginTop: 14,
    marginBottom: 6,
  },
  modalInstInput: {
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 10,
    fontSize: 12.5,
    color: DARK,
    minHeight: 50,
  },
  modalTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 14,
    marginBottom: 14,
  },
  modalTotalLabel: {
    fontSize: 14,
    color: "#64748B",
    fontWeight: "600",
  },
  modalTotalVal: {
    fontSize: 18,
    fontWeight: "900",
    color: TEAL,
  },
  confirmAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: TEAL,
    borderRadius: 14,
    paddingVertical: 14,
  },
  confirmAddBtnTxt: {
    color: "#FFFFFF",
    fontSize: 14.5,
    fontWeight: "800",
    marginLeft: 8,
  },
});
