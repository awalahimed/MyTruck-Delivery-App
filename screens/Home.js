import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigation } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { UserAuth } from "../contexts/AuthContext";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
  Image,
  Dimensions,
  TextInput,
  Animated,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChevronDownIcon, MagnifyingGlassIcon } from "react-native-heroicons/outline";
import { StarIcon } from "react-native-heroicons/solid";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { db } from "../firebase";
import { collection, getDocs, doc, getDoc, updateDoc } from "firebase/firestore";
import { useDispatch, useSelector } from "react-redux";
import { setUser, selectUser } from "../features/userSlice";
import { addToBasket } from "../features/basketSlice";
import { StatusBar } from "expo-status-bar";
import DeliveryLocationModal from "../components/DeliveryLocationModal";
import SearchCard from "../components/SearchCard";
import NotificationBell from "../components/ui/NotificationBell";
import { isWithinEthiopia, reverseGeocodeLocation } from "../utils/mapService";
import locationService from "../services/locationService";
import {
  getItemDiscountInfo,
  getCustomerPrice,
  calculateDistanceKm,
  calculateDeliveryQuote,
  FAR_DISTANCE_NOTICE,
  isFarDistance,
} from "../utils/pricing";

const { width } = Dimensions.get("window");
const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";

const formatPriceTier = (raw) => {
  if (!raw) return "Moderate · ETB";
  if (raw === "$") return "Affordable · ETB";
  if (raw === "$$") return "Moderate · ETB";
  if (raw === "$$$") return "Premium · ETB";
  return String(raw).replace(/\$/g, "");
};

// High fidelity cropped & transparent assets
const WELCOME_TRUCK_BG = require("../assets/cropped/welcome_truck_bg.png");
const TRANSPARENT_BURGER = require("../assets/transparent-burger-img.png");
const BURGER_ASSET = require("../assets/cropped/banner_burger.png");
const HABESHA_ASSET = require("../assets/cropped/habesha_kitchen.png");
const PIZZA_ASSET = require("../assets/cropped/pizza_house.png");

// Instant first-time launch baseline dataset (< 10ms zero-wait startup)
const INSTANT_BASELINE_RESTAURANTS = [
  {
    id: "res-habesha-default",
    name: "Habesha Kitchen",
    rating: 4.8,
    reviews: 142,
    genre: "Authentic Habesha Cuisine",
    address: "Bole Road, Addis Ababa",
    image: HABESHA_ASSET,
    priceTier: "$$",
    latitude: 8.995,
    longitude: 38.7885,
    status: "APPROVED",
  },
  {
    id: "res-pizza-default",
    name: "Pizza House",
    rating: 4.7,
    reviews: 98,
    genre: "Artisan Pizza & Fast Food",
    address: "Kazanchis, Addis Ababa",
    image: PIZZA_ASSET,
    priceTier: "$$",
    latitude: 9.018,
    longitude: 38.766,
    status: "APPROVED",
  },
];

// A dish is orderable only once approved and available (same rule as RestaurantDetails)
const isOrderableDish = (d) => {
  if (!d) return false;
  const status = String(d.status || "");
  if (["PENDING", "REJECTED"].includes(status.toUpperCase()) || d.isApproved === false) return false;
  if (d.isAvailable === false || d.inStock === false) return false;
  return d.isApproved === true || status === "APPROVED" || status === "Published" || !status;
};

export default function Home() {
  const { user, dbUser } = UserAuth();
  const reduxUser = useSelector(selectUser);
  const dispatch = useDispatch();
  const navigation = useNavigation();

  // Instant render on cold launch with zero spinner freeze
  const [restaurants, setRestaurants] = useState([]);
  const [dishes, setDishes] = useState([]);
  const [deliveryModalVisible, setDeliveryModalVisible] = useState(false);
  const getSafeAddress = (raw) => {
    if (!raw || typeof raw !== "string" || raw.includes("Montana") || raw.includes("Cascade")) {
      return "My Location, Ethiopia";
    }
    return raw;
  };
  const getSafeCoords = (lat, lon) => {
    if (isWithinEthiopia(lat, lon)) {
      return { latitude: Number(lat), longitude: Number(lon) };
    }
    return { latitude: 8.9806, longitude: 38.7578 };
  };

  const [currentAddress, setCurrentAddress] = useState(
    getSafeAddress(reduxUser?.address || dbUser?.address)
  );
  const [currentCoords, setCurrentCoords] = useState(
    getSafeCoords(reduxUser?.latitude || dbUser?.latitude, reduxUser?.longitude || dbUser?.longitude)
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false); // Non-blocking: instantaneous visual display
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [showAllRestaurants, setShowAllRestaurants] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  const scrollViewRef = useRef(null);
  const restaurantSectionY = useRef(0);

  // Floating animation for transparent hero burger asset
  const burgerFloat = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(burgerFloat, { toValue: -8, duration: 1800, useNativeDriver: true }),
        Animated.timing(burgerFloat, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  // Sync user address when available
  useEffect(() => {
    if (dbUser?.address) {
      setCurrentAddress(getSafeAddress(dbUser.address));
    }
    if (dbUser?.latitude && dbUser?.longitude) {
      setCurrentCoords(getSafeCoords(dbUser.latitude, dbUser.longitude));
    }
  }, [dbUser]);

  // Automatic Real-Time Customer Location Detection & Continuous Tracking
  useEffect(() => {
    let active = true;

    const setupAutoLocation = async () => {
      // 1. Detect location automatically on startup without requiring manual button tap
      const res = await locationService.detectCurrentLocation();
      if (active && res.coords && isWithinEthiopia(res.coords.latitude, res.coords.longitude)) {
        setCurrentCoords(res.coords);
        reverseGeocodeLocation(res.coords.latitude, res.coords.longitude)
          .then((addr) => {
            if (active && addr) {
              setCurrentAddress(addr);
              dispatch(
                setUser({
                  ...(reduxUser || {}),
                  address: addr,
                  latitude: res.coords.latitude,
                  longitude: res.coords.longitude,
                })
              );
              if (user?.uid) {
                locationService.syncLocationToProfile(user.uid, res.coords, addr);
              }
            }
          })
          .catch(() => {});
      }

      // 2. Start continuous position tracking (updates on movement >= 15m)
      await locationService.startContinuousTracking(
        async (newCoords) => {
          if (!active) return;
          setCurrentCoords(newCoords);
          const addr = await reverseGeocodeLocation(newCoords.latitude, newCoords.longitude);
          if (active && addr) {
            setCurrentAddress(addr);
            dispatch(
              setUser({
                ...(reduxUser || {}),
                address: addr,
                latitude: newCoords.latitude,
                longitude: newCoords.longitude,
              })
            );
            if (user?.uid) {
              locationService.syncLocationToProfile(user.uid, newCoords, addr);
            }
          }
        },
        { userId: user?.uid }
      );
    };

    setupAutoLocation();

    return () => {
      active = false;
      locationService.stopContinuousTracking();
    };
  }, [user?.uid]);

  // Load Firestore data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [resSnap, dishSnap] = await Promise.all([
        getDocs(collection(db, "restaurants")),
        getDocs(collection(db, "dishes")),
      ]);

      const resList = [];
      resSnap.forEach((d) => {
        const data = d.data();
        if (data.status === "APPROVED" || !data.status) {
          resList.push({ id: d.id, ...data });
        }
      });

      // Prioritize authentic top restaurants matching attached reference designs
      resList.sort((a, b) => {
        const aName = (a.name || "").toLowerCase();
        const bName = (b.name || "").toLowerCase();
        if (aName.includes("habesha")) return -1;
        if (bName.includes("habesha")) return 1;
        if (aName.includes("pizza")) return -1;
        if (bName.includes("pizza")) return 1;
        return 0;
      });

      // Deduplicate restaurants by clean name and ID so no merchant renders twice
      const seenNames = new Set();
      const uniqueResList = [];
      for (const r of resList) {
        const cleanName = (r.name || "").trim().toLowerCase();
        if (cleanName && !seenNames.has(cleanName)) {
          seenNames.add(cleanName);
          uniqueResList.push(r);
        }
      }

      const visibleStoreIds = new Set(uniqueResList.map((r) => r.id));
      const dishList = [];
      dishSnap.forEach((d) => {
        const data = { id: d.id, ...d.data() };
        if (isOrderableDish(data) && visibleStoreIds.has(data.restaurantId)) dishList.push(data);
      });

      setRestaurants(uniqueResList);
      setDishes(dishList);
      AsyncStorage.setItem("@mytruck_cached_home_restaurants", JSON.stringify(uniqueResList)).catch(() => {});
      AsyncStorage.setItem("@mytruck_cached_home_dishes", JSON.stringify(dishList)).catch(() => {});
    } catch (e) {
      console.warn("Home: error loading data", e?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fast-path: instantly hydrate from local cache on mount
  useEffect(() => {
    (async () => {
      try {
        const [cachedRes, cachedDishes] = await Promise.all([
          AsyncStorage.getItem("@mytruck_cached_home_restaurants"),
          AsyncStorage.getItem("@mytruck_cached_home_dishes"),
        ]);
        if (cachedRes) setRestaurants(JSON.parse(cachedRes));
        if (cachedDishes) {
          setDishes((JSON.parse(cachedDishes) || []).filter(isOrderableDish));
          setLoading(false);
        }
      } catch (_) {}
      loadData();
    })();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const handleConfirmLocation = async (loc) => {
    setCurrentAddress(loc.address);
    setCurrentCoords({ latitude: loc.latitude, longitude: loc.longitude });

    dispatch(
      setUser({
        ...(reduxUser || {}),
        address: loc.address,
        latitude: loc.latitude,
        longitude: loc.longitude,
      })
    );

    if (user?.uid) {
      try {
        await updateDoc(doc(db, "user", user.uid), {
          address: loc.address,
          latitude: loc.latitude,
          longitude: loc.longitude,
        });
      } catch (e) {
        console.warn("Could not save location to user document:", e?.message);
      }
    }
  };

  const handleSearch = (text) => {
    setSearchQuery(text);
    if (!text.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const term = text.toLowerCase().trim();
    const matchedRestaurants = restaurants.filter(
      (r) =>
        (r.name && r.name.toLowerCase().includes(term)) ||
        (r.genre && r.genre.toLowerCase().includes(term)) ||
        (r.address && r.address.toLowerCase().includes(term))
    );

    const matchedDishes = dishes.filter(
      (d) =>
        (d.name && d.name.toLowerCase().includes(term)) ||
        (d.description && d.description.toLowerCase().includes(term))
    );

    setSearchResults([
      ...matchedRestaurants.map((r) => ({ ...r, searchType: "restaurant" })),
      ...matchedDishes.map((d) => ({ ...d, searchType: "dish" })),
    ]);
  };

  const scrollToRestaurants = () => {
    scrollViewRef.current?.scrollTo({
      y: restaurantSectionY.current > 0 ? restaurantSectionY.current : 300,
      animated: true,
    });
  };

  const handleCategoryClick = (catName) => {
    setSelectedCategory((prev) => (prev === catName ? "All" : catName));
    scrollToRestaurants();
  };

  const openRestaurantDetails = (res) => {
    if (!res) return;
    navigation.navigate("Restaurant", {
      id: res.id,
      title: res.name,
      imgUrl: res.image,
      rating: res.rating || 4.8,
      genre: res.genre || "Ethiopian",
      address: res.address || "Ethiopia",
      short_description: res.description,
      dishes: dishes.filter((d) => d.restaurantId === res.id),
    });
  };

  // Featured deals: real, orderable dishes from visible stores, biggest saving first.
  // (Hard-coded demo deals pointed at stores that don't exist, so orders went nowhere.)
  const featuredDeals = useMemo(() => {
    const storeById = new Map((restaurants || []).map((r) => [r.id, r]));
    return (dishes || [])
      .filter((d) => isOrderableDish(d) && storeById.has(d.restaurantId) && Number(d.price) > 0)
      .map((d) => {
        const store = storeById.get(d.restaurantId);
        return {
          id: d.id,
          restaurantId: d.restaurantId,
          restaurantName: store?.name || store?.businessName || d.restaurantName || "",
          name: d.name,
          price: Number(d.price),
          originalPrice: d.originalPrice,
          discountPercent: d.discountPercent,
          image: d.image || d.imgUrl || "",
          description: d.description || "",
          saving: Math.max(0, Number(d.originalPrice || 0) - Number(d.price || 0)),
        };
      })
      .sort((x, y) => y.saving - x.saving)
      .slice(0, 6);
  }, [dishes, restaurants]);

  const handleQuickAddDeal = (deal) => {
    const r = (restaurants || []).find((it) => it.id === deal.restaurantId);
    const rCoords = {
      latitude: Number(r?.latitude || r?.lat || 8.992),
      longitude: Number(r?.longitude || r?.lng || 38.752),
    };
    if (isFarDistance(rCoords, currentCoords)) {
      Alert.alert("Far Delivery Distance", FAR_DISTANCE_NOTICE);
      return;
    }

    const info = getItemDiscountInfo(deal);
    dispatch(
      addToBasket({
        id: deal.id,
        dishId: deal.id,
        restaurantId: deal.restaurantId,
        restaurantName: deal.restaurantName,
        name: deal.name,
        price: info.customerSellingPrice,
        merchantBasePrice: deal.price,
        originalPrice: info.customerOriginalPrice,
        discountedPrice: info.customerSellingPrice,
        hasDiscount: true,
        discountPercent: info.discountPercent,
        image: deal.image,
      })
    );
    setToastMessage(`Added "${deal.name}" to cart!`);
    setTimeout(() => setToastMessage(""), 2800);
  };


  const rawDisplayRestaurants = restaurants || [];

  // Deduplicate restaurants by name to ensure clean, unique top restaurant list
  const seenNames = new Set();
  const displayRestaurants = rawDisplayRestaurants.filter((r) => {
    const key = (r.name || "").trim().toLowerCase();
    if (!key || seenNames.has(key)) return false;
    seenNames.add(key);
    return true;
  });

  const filteredRestaurants = useMemo(() => {
    let list = displayRestaurants.map((r) => {
      const dist = calculateDistanceKm(
        currentCoords.latitude,
        currentCoords.longitude,
        r.latitude || r.lat || 8.992,
        r.longitude || r.lng || 38.752
      );
      const eta = Math.max(15, Math.round(15 + dist * 2.5));
      return { ...r, distanceKm: dist, etaMinutes: eta };
    });

    if (selectedCategory === "Nearby") {
      return [...list].sort((a, b) => a.distanceKm - b.distanceKm);
    }

    if (selectedCategory !== "All") {
      list = list.filter((r) =>
        String(r.genre || r.category || "")
          .toLowerCase()
          .includes(selectedCategory.toLowerCase())
      );
    }
    return list;
  }, [displayRestaurants, selectedCategory, currentCoords]);

  return (
    <View style={s.root}>
      <StatusBar style="light" backgroundColor={TEAL} />

      {/* Top Green Bar with Enhanced 32px Radius Clearly Visible Against #F5FAF9 */}
      <View style={s.headerOuter}>
        <SafeAreaView edges={["top"]} style={s.safeTop}>
          <View style={s.topGreenHeader}>
            {/* Delivering To pill row */}
            <View style={s.deliveryRow}>
              <View style={s.deliveryLeft}>
                <View style={s.pinCircle}>
                  <MaterialCommunityIcons name="map-marker" size={18} color="white" />
                </View>
                <View style={s.deliveryTextWrap}>
                  <Text style={s.deliveringToLabel}>Delivering to</Text>
                  <Text style={s.addressText} numberOfLines={1}>
                    {currentAddress}
                  </Text>
                </View>
              </View>

              {/* Chevron dropdown button & Notification Bell */}
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <TouchableOpacity
                  style={s.chevronBtn}
                  onPress={() => setDeliveryModalVisible(true)}
                  activeOpacity={0.8}
                  accessibilityLabel="Change delivery location"
                >
                  <ChevronDownIcon size={18} color={TEAL} />
                </TouchableOpacity>

                <NotificationBell
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: "white",
                    marginLeft: 8,
                  }}
                  iconColor={TEAL}
                  badgeColor={ORANGE}
                />
              </View>
            </View>

            {/* Search Bar matching Image 2 */}
            <View style={s.searchContainer}>
              <MagnifyingGlassIcon size={20} color="#94A3B8" style={{ marginRight: 8 }} />
              <TextInput
                style={s.searchInput}
                placeholder="Search for food, shops or anything..."
                placeholderTextColor="#94A3B8"
                value={searchQuery}
                onChangeText={handleSearch}
                returnKeyType="search"
              />
              {searchQuery ? (
                <TouchableOpacity onPress={() => handleSearch("")}>
                  <MaterialCommunityIcons name="close-circle" size={18} color="#94A3B8" />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </SafeAreaView>
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={s.scrollView}
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={TEAL} />
        }
      >
        {searchQuery && searchResults.length > 0 ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            <Text style={s.searchHeader}>
              Search Results ({searchResults.length})
            </Text>
            {searchResults.map((result, idx) => (
              <SearchCard key={result.id || idx} results={result} />
            ))}
          </View>
        ) : searchQuery && searchResults.length === 0 ? (
          <View style={s.emptySearch}>
            <MaterialCommunityIcons name="magnify-close" size={48} color="#CBD5E1" />
            <Text style={{ color: DARK, fontWeight: "700", marginTop: 8 }}>
              No matches found for "{searchQuery}"
            </Text>
            <Text style={{ color: "#94A3B8", fontSize: 12, marginTop: 4 }}>
              Try searching for "Ethiopian", "Pizza", or "Burger"
            </Text>
          </View>
        ) : (
          <>
            {/* Hero Promotional Banner with transparent burger asset (Left Text, Right Burger, No Slash) */}
            <TouchableOpacity
              style={s.heroBanner}
              activeOpacity={0.92}
              onPress={() => navigation.navigate("Restaurants")}
            >
              <View style={s.heroBannerContent}>
                {/* Left Side: Brand Information & Compact CTA */}
                <View style={s.heroLeftCol}>
                  <Text style={s.heroTitle}>Fresh Food{"\n"}Delivered Fast</Text>
                  <View style={s.heroAccentLine} />
                  <Text style={s.heroSubtitle} numberOfLines={2}>
                    Your favorite meals hot & fresh to your door
                  </Text>
                  <View style={s.heroCtaPill}>
                    <Text style={s.heroCtaTxt}>Order Now</Text>
                    <MaterialCommunityIcons name="arrow-right" size={11} color={TEAL} style={{ marginLeft: 3 }} />
                  </View>
                </View>

                {/* Right Side: Animated Floating Transparent Burger Asset */}
                <View style={s.heroRightCol}>
                  <Animated.Image
                    source={TRANSPARENT_BURGER}
                    style={[
                      s.heroBurgerAsset,
                      {
                        transform: [{ translateY: burgerFloat }],
                      },
                    ]}
                    resizeMode="contain"
                  />
                </View>
              </View>
            </TouchableOpacity>

            {/* 3 Quick Action Service Cards matching Image 2 */}
            <View style={s.quickActionsRow}>
              {/* Food Button */}
              <TouchableOpacity
                style={s.actionCard}
                activeOpacity={0.85}
                onPress={() => {
                  setSelectedCategory("All");
                  scrollToRestaurants();
                }}
              >
                <View style={s.actionIconWrap}>
                  <MaterialCommunityIcons
                    name="silverware-fork-knife"
                    size={28}
                    color={TEAL}
                  />
                </View>
                <Text style={s.actionLabel}>Food</Text>
              </TouchableOpacity>

              {/* Shops Button */}
              <TouchableOpacity
                style={s.actionCard}
                activeOpacity={0.85}
                onPress={() => navigation.navigate("Shops")}
              >
                <View style={s.actionIconWrap}>
                  <MaterialCommunityIcons
                    name="shopping-outline"
                    size={28}
                    color={TEAL}
                  />
                </View>
                <Text style={s.actionLabel}>Shops</Text>
              </TouchableOpacity>

              {/* Packages Button */}
              <TouchableOpacity
                style={s.actionCard}
                activeOpacity={0.85}
                onPress={() =>
                  navigation.navigate("ProductDelivery", { mode: "packages" })
                }
              >
                <View style={s.actionIconWrap}>
                  <MaterialCommunityIcons
                    name="package-variant-closed"
                    size={28}
                    color={TEAL}
                  />
                </View>
                <Text style={s.actionLabel}>Packages</Text>
              </TouchableOpacity>
            </View>

            {/* Category Filter Chips */}
            <View style={s.categoryChipsRow}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16 }}
              >
                {["All", "Nearby", "Ethiopian", "Pizza", "Burgers", "Fast Food", "Drinks", "Bakery"].map(
                  (cat) => (
                    <TouchableOpacity
                      key={cat}
                      onPress={() => handleCategoryClick(cat)}
                      style={[
                        s.categoryChip,
                        { marginRight: 8 },
                        selectedCategory === cat && s.categoryChipActive,
                      ]}
                      activeOpacity={0.75}
                    >
                      <Text
                        style={[
                          s.categoryChipTxt,
                          selectedCategory === cat && s.categoryChipTxtActive,
                        ]}
                      >
                        {cat}
                      </Text>
                    </TouchableOpacity>
                  )
                )}
              </ScrollView>
            </View>

            {/* Top Restaurants Section matching Image 2 */}
            <View
              style={s.sectionWrap}
              onLayout={(e) => {
                restaurantSectionY.current = e.nativeEvent.layout.y;
              }}
            >
              {/* Header row */}
              <View style={s.sectionHeaderRow}>
                <Text style={s.sectionTitle}>
                  {selectedCategory === "All" ? "Top Restaurants" : `${selectedCategory} Restaurants`}
                </Text>
                <TouchableOpacity
                  style={s.seeAllPill}
                  onPress={() => navigation.navigate("Restaurants")}
                  activeOpacity={0.8}
                >
                  <Text style={s.seeAllPillTxt}>See All</Text>
                  <MaterialCommunityIcons name="chevron-right" size={14} color={TEAL} />
                </TouchableOpacity>
              </View>

              {/* Horizontal / Grid Restaurant Cards */}
              <View style={s.restaurantsContainer}>
                {loading ? (
                  <ActivityIndicator size="large" color={TEAL} style={{ marginVertical: 20 }} />
                ) : filteredRestaurants.length === 0 ? (
                  <View style={s.emptyRestaurants}>
                    <MaterialCommunityIcons name="storefront-outline" size={36} color="#CBD5E1" />
                    <Text style={{ color: "#64748B", marginTop: 6, fontWeight: "600" }}>
                      No {selectedCategory} restaurants found
                    </Text>
                  </View>
                ) : (
                  <View style={s.gridRow}>
                    {(showAllRestaurants
                      ? filteredRestaurants
                      : filteredRestaurants.slice(0, 4)
                    ).map((res) => {
                      const name = String(res.name || "").toLowerCase();
                      const imageSource = name.includes("burger")
                        ? BURGER_ASSET
                        : name.includes("pizza")
                        ? PIZZA_ASSET
                        : name.includes("habesha") || name.includes("ethiopian")
                        ? HABESHA_ASSET
                        : res.imageAsset
                        ? res.imageAsset
                        : res.image && String(res.image).startsWith("http")
                        ? { uri: res.image, cache: "force-cache" }
                        : res.imgUrl && String(res.imgUrl).startsWith("http")
                        ? { uri: res.imgUrl, cache: "force-cache" }
                        : HABESHA_ASSET;

                      return (
                        <TouchableOpacity
                          key={res.id}
                          style={s.restaurantCard}
                          activeOpacity={0.88}
                          onPress={() => openRestaurantDetails(res)}
                        >
                          <View style={{ position: "relative" }}>
                            <Image
                              source={imageSource}
                              defaultSource={HABESHA_ASSET}
                              style={s.cardImage}
                              resizeMode="cover"
                            />
                            <View style={s.cardDealBadge}>
                              <Text style={s.cardDealBadgeTxt}>{res.deal || "25% OFF Deals"}</Text>
                            </View>
                          </View>
                          <View style={s.cardInfo}>
                            <Text style={s.cardTitle} numberOfLines={1}>
                              {res.name}
                            </Text>
                            <Text style={s.cardSubtitle}>
                              {res.genre || "Ethiopian"} • {formatPriceTier(res.priceRange || res.priceTier)}
                            </Text>
                            <View style={s.ratingRow}>
                              <StarIcon size={14} color="#FBBF24" />
                              <Text style={s.ratingText}>
                                {res.rating || "4.8"} • 📍 {res.distanceKm || "2.1"} km • ⏱️ {res.etaMinutes || "25"} min
                              </Text>
                            </View>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            </View>

            {/* Tasty Discounts Promo Section */}
            <View style={s.promosContainer}>
              <View style={s.sectionHeaderRow}>
                <TouchableOpacity
                  onPress={() => {
                    setSelectedCategory("Pizza");
                    scrollToRestaurants();
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={s.sectionTitle}>Tasty Discounts</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.seeAllPill}
                  onPress={() => {
                    setSelectedCategory(selectedCategory === "Pizza" ? "All" : "Pizza");
                    scrollToRestaurants();
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={s.seeAllPillTxt}>See All</Text>
                  <MaterialCommunityIcons name="chevron-right" size={14} color={TEAL} />
                </TouchableOpacity>
              </View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 4 }}
              >
                {featuredDeals.length === 0 ? (
                  <Text style={{ color: "#64748B", fontSize: 12.5, fontWeight: "600", paddingVertical: 12 }}>
                    {loading ? "Loading deals…" : "No deals right now — check back soon."}
                  </Text>
                ) : null}
                {featuredDeals.map((deal) => {
                  const info = getItemDiscountInfo(deal);
                  return (
                    <TouchableOpacity
                      key={deal.id}
                      style={s.dishDealCard}
                      activeOpacity={0.88}
                      onPress={() => {
                        const targetRes = displayRestaurants.find((r) => r.id === deal.restaurantId);
                        if (targetRes) openRestaurantDetails(targetRes);
                      }}
                    >
                      <View style={s.dishDealImgWrap}>
                        <Image
                          source={
                            deal.imageAsset ||
                            (typeof deal.image === "number"
                              ? deal.image
                              : deal.image && String(deal.image).startsWith("http")
                              ? { uri: deal.image }
                              : HABESHA_ASSET)
                          }
                          defaultSource={HABESHA_ASSET}
                          style={s.dishDealImg}
                          resizeMode="cover"
                        />
                        <View style={s.dishDealBadge}>
                          <Text style={s.dishDealBadgeTxt}>-{String(info.discountPercent ?? 0)}% OFF</Text>
                        </View>
                      </View>
                      <View style={s.dishDealContent}>
                        <Text style={s.dishDealTitle} numberOfLines={1}>
                          {deal.name}
                        </Text>
                        <Text style={s.dishDealStore} numberOfLines={1}>
                          {deal.restaurantName}
                        </Text>
                        <View style={s.dishDealPriceRow}>
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 5 }}>
                              <Text style={s.dishDealPrice}>{info.formattedSelling}</Text>
                              <Text style={s.dishDealOldPrice}>{info.formattedOriginal}</Text>
                            </View>
                            <Text style={s.dishDealSavings}>Save ETB {(Number(info.savingsAmount) || 0).toFixed(0)}</Text>
                          </View>
                          <TouchableOpacity
                            style={s.dishDealAddBtn}
                            onPress={() => handleQuickAddDeal(deal)}
                            activeOpacity={0.8}
                            accessibilityLabel={`Add ${deal.name} to cart`}
                          >
                            <MaterialCommunityIcons name="plus" size={16} color="white" />
                          </TouchableOpacity>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

            </View>

            {/* Offers Near You Section */}
            <View style={[s.promosContainer, { marginTop: 16 }]}>
              <View style={s.sectionHeaderRow}>
                <TouchableOpacity onPress={() => setDeliveryModalVisible(true)} activeOpacity={0.8}>
                  <Text style={s.sectionTitle}>Offers Near You</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.changeLocationPill}
                  onPress={() => setDeliveryModalVisible(true)}
                  activeOpacity={0.8}
                >
                  <MaterialCommunityIcons name="map-marker-radius-outline" size={13} color={ORANGE} style={{ marginRight: 3 }} />
                  <Text style={s.changeLocationPillTxt}>Change Location</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={s.offersBanner}
                activeOpacity={0.85}
                onPress={() => setDeliveryModalVisible(true)}
              >
                <MaterialCommunityIcons name="map-marker-radius" size={28} color={TEAL} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={s.offersTitle}>Serving {currentAddress}</Text>
                  <Text style={s.offersSub}>
                    Tap to update address or select delivery zone on map
                  </Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={TEAL} />
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>

      {/* Delivery location picker (Google Maps) */}
      {deliveryModalVisible ? (
        <DeliveryLocationModal
          visible={deliveryModalVisible}
          onClose={() => setDeliveryModalVisible(false)}
          initialLocation={{
            address: currentAddress,
            latitude: currentCoords.latitude,
            longitude: currentCoords.longitude,
          }}
          onConfirmLocation={handleConfirmLocation}
        />
      ) : null}

      {/* Confirmation Toast */}
      {toastMessage ? (
        <View style={s.toastContainer}>
          <MaterialCommunityIcons name="check-circle" size={18} color="#10B981" style={{ marginRight: 6 }} />
          <Text style={s.toastText}>{toastMessage}</Text>
        </View>
      ) : null}
    </View>
  );
}


const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#F5FAF9",
  },
  headerOuter: {
    backgroundColor: "#F5FAF9",
  },
  safeTop: {
    backgroundColor: TEAL,
    borderBottomLeftRadius: 38,
    borderBottomRightRadius: 38,
    shadowColor: "#0B2A26",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.24,
    shadowRadius: 10,
    elevation: 8,
  },
  topGreenHeader: {
    backgroundColor: TEAL,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 20,
    borderBottomLeftRadius: 38,
    borderBottomRightRadius: 38,
  },
  deliveryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  deliveryLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  pinCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  deliveryTextWrap: {
    marginLeft: 8,
    flex: 1,
  },
  deliveringToLabel: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 11,
    fontWeight: "600",
  },
  addressText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
    marginTop: 1,
  },
  chevronBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 48,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: DARK,
  },
  scrollView: {
    flex: 1,
    backgroundColor: "#F5FAF9",
  },
  searchHeader: {
    fontSize: 16,
    fontWeight: "800",
    color: DARK,
    marginBottom: 10,
  },
  emptySearch: {
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  // Hero Banner matching Exact Spec (Compact, Left Burger, Slash Divider, Compact Right Text)
  heroBanner: {
    backgroundColor: TEAL,
    marginHorizontal: 16,
    marginTop: 6,
    borderRadius: 20,
    overflow: "hidden",
    height: 142,
    elevation: 5,
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 8,
  },
  heroBannerContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  heroLeftCol: {
    flex: 1.25,
    justifyContent: "center",
    paddingRight: 6,
  },
  heroRightCol: {
    width: 130,
    height: 130,
    justifyContent: "center",
    alignItems: "center",
  },
  heroBurgerAsset: {
    width: 126,
    height: 126,
  },
  heroTitle: {
    fontSize: 15.5,
    fontWeight: "900",
    color: "#FFFFFF",
    lineHeight: 19,
    letterSpacing: -0.2,
  },
  heroAccentLine: {
    width: 30,
    height: 2.5,
    backgroundColor: ORANGE,
    borderRadius: 2,
    marginTop: 4,
    marginBottom: 4,
  },
  heroSubtitle: {
    fontSize: 10,
    color: "rgba(255, 255, 255, 0.92)",
    lineHeight: 13.5,
    fontWeight: "500",
    marginBottom: 4,
  },
  heroCtaPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4.5,
    borderRadius: 12,
    marginTop: 2,
    elevation: 2,
  },
  heroCtaTxt: {
    fontSize: 10.5,
    fontWeight: "800",
    color: TEAL,
  },

  seeAllPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E6F7F1",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#CCECE5",
  },
  seeAllPillTxt: {
    fontSize: 12,
    fontWeight: "700",
    color: TEAL,
    marginRight: 2,
  },
  changeLocationPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF7ED",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#FED7AA",
  },
  changeLocationPillTxt: {
    fontSize: 11.5,
    fontWeight: "800",
    color: ORANGE,
  },
  // Quick Actions matching Image 2
  quickActionsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginHorizontal: 16,
    marginTop: 14,
  },
  actionCard: {
    flex: 1,
    marginHorizontal: 4,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E6ECEB",
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  actionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#E6F4F1",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  actionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: DARK,
  },
  categoryChipsRow: {
    marginTop: 14,
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  categoryChipActive: {
    backgroundColor: TEAL,
    borderColor: TEAL,
  },
  categoryChipTxt: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
  },
  categoryChipTxtActive: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
  sectionWrap: {
    marginTop: 18,
    paddingHorizontal: 16,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: DARK,
  },
  seeAllLink: {
    fontSize: 13,
    fontWeight: "800",
    color: TEAL,
  },
  restaurantsContainer: {
    minHeight: 100,
  },
  emptyRestaurants: {
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
  },
  gridRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  restaurantCard: {
    width: (width - 44) / 2,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E6ECEB",
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    marginBottom: 12,
  },
  cardImage: {
    width: "100%",
    height: 100,
  },
  cardDealBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: "rgba(23, 155, 131, 0.94)",
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  cardDealBadgeTxt: {
    fontSize: 9.5,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },
  cardInfo: {
    padding: 10,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: DARK,
  },
  cardSubtitle: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
  },
  ratingText: {
    fontSize: 10,
    fontWeight: "700",
    color: DARK,
  },
  promosContainer: {
    marginTop: 18,
    paddingHorizontal: 16,
  },
  discountCard: {
    width: 220,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    elevation: 1,
  },
  discountBadge: {
    backgroundColor: ORANGE,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: 8,
  },
  discountBadgeTxt: {
    color: "white",
    fontSize: 10,
    fontWeight: "800",
  },
  discountTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: DARK,
  },
  discountSub: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 4,
    lineHeight: 15,
  },
  // Featured Deal Dish Card with Strikethrough Old Price and Discounted Selling Price
  dishDealCard: {
    width: 200,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E6ECEB",
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    marginRight: 12,
  },
  dishDealImgWrap: {
    position: "relative",
    width: "100%",
    height: 110,
  },
  dishDealImg: {
    width: "100%",
    height: "100%",
  },
  dishDealBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    backgroundColor: "#E11D48",
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
  dishDealBadgeTxt: {
    fontSize: 9.5,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },
  dishDealContent: {
    padding: 10,
  },
  dishDealTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: DARK,
  },
  dishDealStore: {
    fontSize: 10.5,
    color: "#64748B",
    marginTop: 2,
  },
  dishDealPriceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  dishDealPrice: {
    fontSize: 13,
    fontWeight: "900",
    color: "#E11D48",
  },
  dishDealOldPrice: {
    fontSize: 10.5,
    color: "#94A3B8",
    textDecorationLine: "line-through",
  },
  dishDealSavings: {
    fontSize: 9.5,
    fontWeight: "700",
    color: "#16A34A",
    marginTop: 1,
  },
  dishDealAddBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: TEAL,
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
  },
  toastContainer: {
    position: "absolute",
    bottom: 24,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0B2A26",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  toastText: {
    color: "#FFFFFF",
    fontSize: 12.5,
    fontWeight: "700",
  },

  offersBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E6ECEB",
    elevation: 1,
  },
  offersTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: DARK,
  },
  offersSub: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
});
