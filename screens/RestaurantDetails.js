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
} from "../utils/pricing";

const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";

const HABESHA_ASSET = require("../assets/cropped/habesha_kitchen.png");
const PIZZA_ASSET = require("../assets/cropped/pizza_house.png");
const BURGER_ASSET = require("../assets/cropped/banner_burger.png");

const formatETB = (amount) => {
  const num = Number(amount) || 0;
  return `ETB ${num.toFixed(2)}`;
};

const isRestaurantOpen = (info) => {
  if (!info || info.isTemporarilyClosed === true) return false;
  if (!info.openingTime || !info.closingTime) return true;
  const now = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Addis_Ababa",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
  const toMinutes = (t) => {
    const [h, m] = String(t).split(":").map(Number);
    return h * 60 + m;
  };
  const current = toMinutes(now);
  const opening = toMinutes(info.openingTime);
  const closing = toMinutes(info.closingTime);
  return opening <= closing
    ? current >= opening && current < closing
    : current >= opening || current < closing;
};

export default function RestaurantDetails() {
  const navigation = useNavigation();
  // Full-bleed hero: float the back button and toast below the status bar / notch
  const insets = useSafeAreaInsets();
  const floatTop = Math.max(insets.top, 24) + 10;
  const dispatch = useDispatch();
  const route = useRoute();
  const restaurantUid = route?.params?.id || route?.params?.restaurantId || "";

  const [dishes, setDishes] = useState(route?.params?.dishes || []);
  const [restaurantInfo, setRestaurantInfo] = useState({
    name: route?.params?.title || route?.params?.name || "Restaurant",
    image: route?.params?.imgUrl || route?.params?.image || "",
    rating: route?.params?.rating || 4.8,
    reviews: route?.params?.reviews || "1.2k+",
    deliveryTime: route?.params?.deliveryTime || "25 min",
    genre: route?.params?.genre || "Ethiopian",
    address: route?.params?.address || "Ethiopia",
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
    return isFarDistance(restaurantCoords, userCoords);
  }, [restaurantCoords, userCoords]);

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
    if (typeof img === "string" && img.startsWith("http")) return { uri: img };
    const name = String(restaurantInfo.name || route?.params?.title || "").toLowerCase();
    if (name.includes("habesha") || name.includes("kategna") || name.includes("ethiopian")) return HABESHA_ASSET;
    if (name.includes("pizza") || name.includes("italian")) return PIZZA_ASSET;
    if (name.includes("burger") || name.includes("grill") || name.includes("fast")) return BURGER_ASSET;
    return HABESHA_ASSET;
  };

  // Generate signature dishes with attractive seeded discounts so no merchant ever renders empty
  const getSignatureDishes = (rId, name, genre) => {
    const rName = String(name || "").toLowerCase();
    const rGenre = String(genre || "").toLowerCase();
    const displayName = name || "Restaurant";

    if (rName.includes("burger") || rGenre.includes("burger") || rGenre.includes("fast")) {
      return [
        {
          id: `${rId || "res"}-burger-1`,
          restaurantId: rId || "res-burger",
          restaurantName: displayName,
          name: "Classic Cheeseburger Deluxe",
          price: 320,
          originalPrice: 420,
          discountPercent: 24,
          hasDiscount: true,
          description: "Handcrafted grilled beef patty with melted cheddar, crisp lettuce, red onion, pickles, and signature house sauce on a toasted brioche bun.",
          image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400",
        },
        {
          id: `${rId || "res"}-burger-2`,
          restaurantId: rId || "res-burger",
          restaurantName: displayName,
          name: "Double Bacon Monster Burger",
          price: 420,
          originalPrice: 560,
          discountPercent: 25,
          hasDiscount: true,
          description: "Double seasoned beef patties, smoked crispy bacon, caramelized onions, double cheddar, and smoky BBQ drizzle.",
          image: "https://images.unsplash.com/photo-1586190848861-99aa4a171e90?w=400",
        },
        {
          id: `${rId || "res"}-burger-3`,
          restaurantId: rId || "res-burger",
          restaurantName: displayName,
          name: "Crispy Spicy Chicken Burger",
          price: 290,
          originalPrice: 380,
          discountPercent: 24,
          hasDiscount: true,
          description: "Crispy buttermilk fried chicken breast tossed in Ethiopian hot spice blend with tangy creamy coleslaw.",
          image: "https://images.unsplash.com/photo-1625813506062-0aeb1d7a094b?w=400",
        },
        {
          id: `${rId || "res"}-burger-4`,
          restaurantId: rId || "res-burger",
          restaurantName: displayName,
          name: "Loaded Cheesy Truffle Fries",
          price: 180,
          originalPrice: 240,
          discountPercent: 25,
          hasDiscount: true,
          description: "Golden hand-cut fries smothered in warm cheddar cheese sauce, white truffle oil, and fresh jalapeños.",
          image: "https://images.unsplash.com/photo-1576107232684-1279f3908594?w=400",
        },
      ];
    }

    if (rName.includes("pizza") || rGenre.includes("pizza") || rGenre.includes("italian")) {
      return [
        {
          id: `${rId || "res"}-pizza-1`,
          restaurantId: rId || "res-pizza",
          restaurantName: displayName,
          name: "Signature Pepperoni Pizza",
          price: 450,
          originalPrice: 600,
          discountPercent: 25,
          hasDiscount: true,
          description: "Authentic wood-fired crust with rich tomato sauce, melted mozzarella, and generous premium halal pepperoni slices.",
          image: "https://images.unsplash.com/photo-1534308983496-4fabb1a015ee?w=400",
        },
        {
          id: `${rId || "res"}-pizza-2`,
          restaurantId: rId || "res-pizza",
          restaurantName: displayName,
          name: "Classic Margherita",
          price: 360,
          originalPrice: 480,
          discountPercent: 25,
          hasDiscount: true,
          description: "San Marzano marinara, fresh Fior di Latte mozzarella, virgin olive oil, and aromatic garden basil.",
          image: "https://images.unsplash.com/photo-1604382355076-af4b0eb60143?w=400",
        },
        {
          id: `${rId || "res"}-pizza-3`,
          restaurantId: rId || "res-pizza",
          restaurantName: displayName,
          name: "Four Seasons Special Pizza",
          price: 490,
          originalPrice: 650,
          discountPercent: 25,
          hasDiscount: true,
          description: "Artisanal crust divided with mushrooms, smoked ham, black olives, artichoke hearts, and fresh oregano.",
          image: "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=400",
        },
      ];
    }

    // Authentic Ethiopian fallback with seeded deals
    return [
      {
        id: `${rId || "res"}-ethio-1`,
        restaurantId: rId || "res-habesha",
        restaurantName: displayName,
        name: "Special Doro Wot",
        price: 420,
        originalPrice: 560,
        discountPercent: 25,
        hasDiscount: true,
        description: "Authentic slow-simmered chicken stew with berbere, hard-boiled egg, and freshly baked teff injera.",
        image: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400",
      },
      {
        id: `${rId || "res"}-ethio-2`,
        restaurantId: rId || "res-habesha",
        restaurantName: displayName,
        name: "Sizzling Shekla Tibs",
        price: 390,
        originalPrice: 520,
        discountPercent: 25,
        hasDiscount: true,
        description: "Tender beef cubes sautéed on clay pot with rosemary, garlic, sliced green peppers, and awaze.",
        image: "https://images.unsplash.com/photo-1544025162-d76694265947?w=400",
      },
      {
        id: `${rId || "res"}-ethio-3`,
        restaurantId: rId || "res-habesha",
        restaurantName: displayName,
        name: "Gurage Special Kitfo",
        price: 450,
        originalPrice: 600,
        discountPercent: 25,
        hasDiscount: true,
        description: "Finely minced prime beef seasoned with spiced clarified butter (niter kibbeh) and mitmita, served with ayib and kocho.",
        image: "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=400",
      },
      {
        id: `${rId || "res"}-ethio-4`,
        restaurantId: rId || "res-habesha",
        restaurantName: displayName,
        name: "Shiro Tegamino",
        price: 210,
        originalPrice: 280,
        discountPercent: 25,
        hasDiscount: true,
        description: "Simmering clay bowl of ground seasoned chickpeas with garlic, diced tomatoes, and green chili peppers.",
        image: "https://images.unsplash.com/photo-1540420773420-3366772f4999?w=400",
      },
    ];
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

      // 2. Fetch dishes — always guarantee fallback so menu never shows empty
      try {
        let items = [];
        if (restaurantUid) {
          const dishRef = collection(db, "dishes");
          const q = query(dishRef, where("restaurantId", "==", restaurantUid));
          const snapshot = await getDocs(q);
          snapshot.forEach((d) => {
            const data = d.data();
            const isApproved =
              data.isApproved === true ||
              data.status === "APPROVED" ||
              data.status === "Published" ||
              (!data.status && data.isAvailable !== false);
            const isPendingOrRejected =
              data.status === "PENDING" ||
              data.status === "REJECTED" ||
              data.lifecycleStatus === "Pending" ||
              data.lifecycleStatus === "Rejected";
            if (isApproved && !isPendingOrRejected) {
              items.push({ ...data, id: d.id });
            }
          });
        }

        // If no real dishes in Firestore, apply curated signature fallback
        if (items.length === 0) {
          const rName = rData?.name || restaurantInfo.name || route?.params?.title || route?.params?.name || "";
          const rGenre = rData?.genre || restaurantInfo.genre || route?.params?.genre || "";
          items = getSignatureDishes(restaurantUid || "default", rName, rGenre);
        }

        if (active) setDishes(items);
      } catch (e) {
        console.warn("RestaurantDetails: error loading dishes, using fallback", e?.message);
        if (active) {
          const rName = rData?.name || restaurantInfo.name || route?.params?.title || route?.params?.name || "";
          const rGenre = rData?.genre || restaurantInfo.genre || route?.params?.genre || "";
          setDishes(getSignatureDishes(restaurantUid || "default", rName, rGenre));
        }
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
    if (isTooFar) {
      Alert.alert("Far Delivery Distance", FAR_DISTANCE_NOTICE);
      return;
    }
    setSelectedDish(dish);
    setModalQuantity(1);
    setSpecialInstructions("");
  };

  const handleConfirmAddToCart = () => {
    if (!selectedDish) return;
    if (isTooFar) {
      Alert.alert("Far Delivery Distance", FAR_DISTANCE_NOTICE);
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
          hasDiscount: true,
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
            fallbackCategory={restaurantInfo.genre || "burger"}
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
                ? "Open now · 9:00 AM – 10:00 PM"
                : `Closed now · Hours ${restaurantInfo.openingTime || "9:00 AM"}–${restaurantInfo.closingTime || "10:00 PM"}`}
            </Text>
          </View>

          <View style={s.metaRow}>
            <StarIcon color="#10B981" size={18} />
            <Text style={s.metaRating}>{restaurantInfo.rating || 4.8}</Text>
            <Text style={s.metaSub}>({restaurantInfo.reviews || "1.2k+"})</Text>
            <Text style={s.metaDot}>·</Text>
            <MaterialCommunityIcons name="clock-outline" size={15} color="#64748B" />
            <Text style={s.metaSub}>{restaurantInfo.deliveryTime || "25–35 mins"}</Text>
          </View>

          <View style={s.addressRow}>
            <MapPinIcon color="#94A3B8" size={17} />
            <Text style={s.addressTxt}>{restaurantInfo.address || "Ethiopia"}</Text>
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
                      <Text style={[s.dishPrice, { color: "#E11D48" }]}>{info.formattedSelling}</Text>
                      <Text style={{ fontSize: 11.5, color: "#94A3B8", textDecorationLine: "line-through" }}>
                        {info.formattedOriginal}
                      </Text>
                      <View style={{ backgroundColor: "#FEE2E2", paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3 }}>
                        <Text style={{ fontSize: 9.5, fontWeight: "800", color: "#E11D48" }}>
                          -{info.discountPercent}% OFF
                        </Text>
                      </View>
                    </View>
                    <Text style={{ fontSize: 10, color: "#16A34A", fontWeight: "700", marginTop: 2 }}>
                      Save ETB {(Number(info.savingsAmount) || 0).toFixed(0)}
                    </Text>
                  </View>

                  <View style={s.dishRight}>
                    <ResilientImage
                      source={dish.image}
                      fallbackCategory={restaurantInfo.genre || "burger"}
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
                  source={selectedDish.image}
                  fallbackCategory={restaurantInfo.genre || "burger"}
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
                          <Text style={[s.modalDishPrice, { color: "#E11D48" }]}>{modalInfo.formattedSelling} each</Text>
                          <Text style={{ fontSize: 12, color: "#94A3B8", textDecorationLine: "line-through" }}>
                            {modalInfo.formattedOriginal}
                          </Text>
                          <View style={{ backgroundColor: "#FEE2E2", paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 }}>
                            <Text style={{ fontSize: 10, fontWeight: "800", color: "#E11D48" }}>
                              -{String(modalInfo.discountPercent ?? 0)}% OFF
                            </Text>
                          </View>
                        </View>
                        <Text style={{ fontSize: 11, color: "#16A34A", fontWeight: "700", marginTop: 2 }}>
                          You save ETB {(Number(modalInfo.savingsAmount || 0) * modalQuantity).toFixed(2)} on this order!
                        </Text>
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
