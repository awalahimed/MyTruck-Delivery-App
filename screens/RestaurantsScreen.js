import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Image,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useNavigation } from "@react-navigation/native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { MagnifyingGlassIcon, XMarkIcon, AdjustmentsHorizontalIcon } from "react-native-heroicons/outline";
import { StarIcon, ClockIcon } from "react-native-heroicons/solid";
import { db } from "../firebase";
import { collection, getDocs } from "firebase/firestore";
import { useSelector } from "react-redux";
import { selectUser } from "../features/userSlice";
import { UserAuth } from "../contexts/AuthContext";
import BackButton from "../components/ui/BackButton";
import ResilientImage from "../components/ui/ResilientImage";
import { calculateDistanceKm } from "../utils/pricing";

const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";
const BG = "#F5FAF9";

const CUISINE_TAGS = [
  "All",
  "Ethiopian",
  "Pizza",
  "Burgers",
  "Fast Food",
  "Italian",
  "Cafe & Bakery",
  "Traditional",
];

const SORT_OPTIONS = [
  { id: "recommended", label: "Recommended" },
  { id: "nearby", label: "📍 Closest to Me" },
  { id: "rating", label: "Top Rated" },
  { id: "fastest", label: "Fastest Delivery" },
  { id: "price_low", label: "Price: Low to High" },
];

const parseClockMinutes = (value) => {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  if (match[3]?.toUpperCase() === "PM" && hours < 12) hours += 12;
  if (match[3]?.toUpperCase() === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
};

export default function RestaurantsScreen() {
  const navigation = useNavigation();
  const { dbUser } = UserAuth();
  const reduxUser = useSelector(selectUser);

  const userCoords = useMemo(() => ({
    latitude: Number(reduxUser?.latitude || dbUser?.latitude || 8.9806),
    longitude: Number(reduxUser?.longitude || dbUser?.longitude || 38.7578),
  }), [reduxUser?.latitude, reduxUser?.longitude, dbUser?.latitude, dbUser?.longitude]);

  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCuisine, setSelectedCuisine] = useState("All");
  const [sortBy, setSortBy] = useState("recommended");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [minRating, setMinRating] = useState(0); // 0, 4.0, 4.5
  const [showFiltersModal, setShowFiltersModal] = useState(false);

  const getRestaurantImage = (item) => {
    const image = item?.image || item?.imgUrl || item?.logoUrl || item?.profileImage;
    return image || null;
  };

  const fetchRestaurants = useCallback(async () => {
    setLoadError("");
    try {
      const snap = await getDocs(collection(db, "restaurants"));
      const seenIds = new Set();
      const list = [];
      snap.forEach((doc) => {
        const d = doc.data();
        const status = String(d.status || d.approvalStatus || "").trim().toUpperCase();
        if (status === "APPROVED" && !seenIds.has(doc.id)) {
          seenIds.add(doc.id);
          list.push({ id: doc.id, ...d });
        }
      });
      list.sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0));
      setRestaurants(list);
    } catch (e) {
      console.warn("Could not load restaurants:", e?.message);
      setLoadError("We couldn't load restaurants. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRestaurants();
    const unsubscribe = navigation.addListener("focus", fetchRestaurants);
    return unsubscribe;
  }, [fetchRestaurants, navigation]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchRestaurants();
    setRefreshing(false);
  }, [fetchRestaurants]);

  const isStoreOpen = (res) => {
    if (!res) return false;
    if (res.isOpen === false || res.isAvailable === false || res.isTemporarilyClosed === true) return false;
    if (String(res.workingHours || "").toLowerCase().includes("24 hours")) return true;
    let openingTime = res.openingTime;
    let closingTime = res.closingTime;
    if ((!openingTime || !closingTime) && typeof res.workingHours === "string" && res.workingHours.includes("-")) {
      [openingTime, closingTime] = res.workingHours.split("-").map((part) => part.trim());
    }
    if (!openingTime || !closingTime) return res.isOpen === true;
    const now = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Addis_Ababa",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date());
    const current = parseClockMinutes(now);
    const opening = parseClockMinutes(openingTime);
    const closing = parseClockMinutes(closingTime);
    if (current == null || opening == null || closing == null) return false;
    if (opening === closing) return true;
    return opening <= closing
      ? current >= opening && current < closing
      : current >= opening || current < closing;
  };

  // Filtered & Sorted list with live distance and ETA calculations
  const filteredRestaurants = useMemo(() => {
    let result = [];

    for (const r of restaurants) {
      const rLat = Number(r.latitude ?? r.lat ?? r.storeLatitude ?? r.location?.latitude ?? r.location?.lat);
      const rLng = Number(r.longitude ?? r.lng ?? r.storeLongitude ?? r.location?.longitude ?? r.location?.lng);
      const hasCoords = Number.isFinite(rLat) && Number.isFinite(rLng) && rLat !== 0 && rLng !== 0;
      const dist = hasCoords
        ? calculateDistanceKm(userCoords.latitude, userCoords.longitude, rLat, rLng)
        : null;

      // The All Restaurants page is a catalogue. Keep approved stores visible
      // even when an older record has no pin or is outside the local radius.
      result.push({
        ...r,
        ...(hasCoords ? { latitude: rLat, longitude: rLng } : {}),
        distanceKm: dist,
        etaMinutes: Number.isFinite(dist) ? Math.max(15, Math.round(15 + dist * 2.5)) : null,
      });
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (r) =>
          (r.name && r.name.toLowerCase().includes(q)) ||
          (r.genre && r.genre.toLowerCase().includes(q)) ||
          (r.cuisine && r.cuisine.toLowerCase().includes(q)) ||
          (r.description && r.description.toLowerCase().includes(q)) ||
          (r.address && r.address.toLowerCase().includes(q))
      );
    }

    // Cuisine filter
    if (selectedCuisine !== "All") {
      const tag = selectedCuisine.toLowerCase();
      result = result.filter((r) => {
        const c = (r.genre || r.cuisine || "").toLowerCase();
        return c.includes(tag);
      });
    }

    // Open now filter
    if (onlyOpen) {
      result = result.filter(isStoreOpen);
    }

    // Rating filter
    if (minRating > 0) {
      result = result.filter((r) => parseFloat(r.rating || 0) >= minRating);
    }

    // Sort
    if (sortBy === "nearby") {
      result.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    } else if (sortBy === "rating") {
      result.sort((a, b) => parseFloat(b.rating || 0) - parseFloat(a.rating || 0));
    } else if (sortBy === "fastest") {
      result.sort((a, b) => a.etaMinutes - b.etaMinutes);
    } else if (sortBy === "price_low") {
      const getPriceRank = (p) => (p === "$" ? 1 : p === "$$" ? 2 : 3);
      result.sort((a, b) => getPriceRank(a.priceTier) - getPriceRank(b.priceTier));
    }

    return result;
  }, [restaurants, searchQuery, selectedCuisine, onlyOpen, minRating, sortBy, userCoords]);

  const renderRestaurantCard = ({ item }) => {
    const open = isStoreOpen(item);
    const rating = Number.isFinite(Number(item.rating)) ? Number(item.rating).toFixed(1) : null;
    const reviews = item.reviewsCount ?? item.reviews;
    const distanceLabel = Number.isFinite(item.distanceKm)
      ? `${item.distanceKm} km · ${item.etaMinutes} min`
      : "Distance unavailable";
    const price =
      item.priceTier === "$"
        ? "Affordable · ETB"
        : item.priceTier === "$$$"
        ? "Premium · ETB"
        : "Moderate · ETB";
    const cuisine = item.genre || item.cuisine || "";

    return (
      <TouchableOpacity
        style={s.card}
        activeOpacity={0.88}
        onPress={() => navigation.navigate("RestaurantDetails", { id: item.id })}
      >
        <View style={s.cardImgWrapper}>
          {getRestaurantImage(item) ? (
            <ResilientImage source={getRestaurantImage(item)} fallbackCategory="none" style={s.cardImg} resizeMode="cover" />
          ) : (
            <View style={[s.cardImg, { alignItems: "center", justifyContent: "center", backgroundColor: "#E8F1EF" }]}>
              <MaterialCommunityIcons name="storefront-outline" size={36} color="#8AA9A2" />
            </View>
          )}
          <View style={[s.openBadge, { backgroundColor: open ? "rgba(22, 101, 52, 0.9)" : "rgba(185, 28, 28, 0.9)" }]}>
            <Text style={s.openBadgeTxt}>{open ? "OPEN NOW" : "CLOSED"}</Text>
          </View>
          <View style={s.deliveryTimeBadge}>
            <ClockIcon size={12} color="#FFFFFF" style={{ marginRight: 4 }} />
            <Text style={s.deliveryTimeTxt}>{distanceLabel}</Text>
          </View>
        </View>

        <View style={s.cardBody}>
          <View style={s.cardRowTop}>
            <Text style={s.cardTitle} numberOfLines={1}>
              {item.name}
            </Text>
            {rating ? (
              <View style={s.ratingBadge}>
                <StarIcon size={14} color="#EAB308" />
                <Text style={s.ratingTxt}>{rating}</Text>
                {reviews != null ? <Text style={s.reviewsTxt}>({reviews})</Text> : null}
              </View>
            ) : null}
          </View>

          <Text style={s.cardSub} numberOfLines={1}>
            {[cuisine, item.priceTier ? price : "", item.city, item.address].filter(Boolean).join(" · ")}
          </Text>

          {item.description ? (
            <Text style={s.cardDesc} numberOfLines={2}>
              {item.description}
            </Text>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <StatusBar style="dark" />

      {/* Top Header */}
      <View style={s.header}>
        <BackButton fallbackRoute="HomeTab" color="#FFFFFF" variant="transparent" />
        <Text style={s.headerTitle}>All Restaurants</Text>
        <TouchableOpacity
          style={[s.filterToggleBtn, (onlyOpen || minRating > 0 || sortBy !== "recommended") && s.filterToggleBtnActive]}
          onPress={() => setShowFiltersModal(!showFiltersModal)}
          activeOpacity={0.8}
        >
          <AdjustmentsHorizontalIcon size={20} color={(onlyOpen || minRating > 0 || sortBy !== "recommended") ? TEAL : "#FFFFFF"} />
        </TouchableOpacity>
      </View>

      {/* Search Input Bar */}
      <View style={s.searchWrap}>
        <MagnifyingGlassIcon size={20} color="#94A3B8" style={{ marginRight: 8 }} />
        <TextInput
          style={s.searchInput}
          placeholder="Search restaurants, cuisines, dishes..."
          placeholderTextColor="#94A3B8"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery ? (
          <TouchableOpacity onPress={() => setSearchQuery("")} style={s.clearBtn}>
            <XMarkIcon size={16} color="#64748B" />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Cuisine Filter Pills */}
      <View style={s.cuisinesWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.cuisinesScroll}>
          {CUISINE_TAGS.map((tag) => {
            const active = selectedCuisine === tag;
            return (
              <TouchableOpacity
                key={tag}
                style={[s.cuisinePill, active && s.cuisinePillActive]}
                onPress={() => setSelectedCuisine(tag)}
                activeOpacity={0.8}
              >
                <Text style={[s.cuisinePillTxt, active && s.cuisinePillTxtActive]}>{tag}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Filter drawer bar when active */}
      {showFiltersModal && (
        <View style={s.filtersDrawer}>
          <View style={s.filtersDrawerHeader}>
            <Text style={s.filterDrawerTitle}>Filter & Sort</Text>
            <TouchableOpacity onPress={() => {
              setSortBy("recommended");
              setOnlyOpen(false);
              setMinRating(0);
            }}>
              <Text style={s.resetTxt}>Reset All</Text>
            </TouchableOpacity>
          </View>

          {/* Sort row */}
          <Text style={s.filterSecLabel}>Sort By</Text>
          <View style={s.filterRowWrap}>
            {SORT_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.id}
                style={[s.filterChip, sortBy === opt.id && s.filterChipActive]}
                onPress={() => setSortBy(opt.id)}
              >
                <Text style={[s.filterChipTxt, sortBy === opt.id && s.filterChipTxtActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Quick toggles */}
          <View style={{ flexDirection: "row", marginTop: 10 }}>
            <TouchableOpacity
              style={[s.filterChip, onlyOpen && s.filterChipActive]}
              onPress={() => setOnlyOpen(!onlyOpen)}
            >
              <Text style={[s.filterChipTxt, onlyOpen && s.filterChipTxtActive]}>Open Now Only</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.filterChip, minRating === 4.5 && s.filterChipActive, { marginLeft: 8 }]}
              onPress={() => setMinRating(minRating === 4.5 ? 0 : 4.5)}
            >
              <Text style={[s.filterChipTxt, minRating === 4.5 && s.filterChipTxtActive]}>⭐ 4.5+ Rating</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Main List */}
      {loading ? (
        <View style={s.centerBox}>
          <ActivityIndicator size="large" color={TEAL} />
          <Text style={s.loadingTxt}>Loading top restaurants...</Text>
        </View>
      ) : loadError ? (
        <View style={s.centerBox}>
          <MaterialCommunityIcons name="wifi-alert" size={48} color="#94A3B8" />
          <Text style={s.emptyTitle}>Restaurants unavailable</Text>
          <Text style={s.emptySub}>{loadError}</Text>
          <TouchableOpacity style={s.resetBtn} onPress={onRefresh}>
            <Text style={s.resetBtnTxt}>Try Again</Text>
          </TouchableOpacity>
        </View>
      ) : filteredRestaurants.length === 0 ? (
        <View style={s.centerBox}>
          <MaterialCommunityIcons name="silverware-fork-knife" size={54} color="#CBD5E1" />
          <Text style={s.emptyTitle}>No restaurants found</Text>
          <Text style={s.emptySub}>
            {searchQuery
              ? `No matches found for "${searchQuery}". Try a different keyword.`
              : restaurants.length === 0
                ? "No approved restaurants are available yet. Please check again soon."
                : "No restaurants matched your filters."}
          </Text>
          <TouchableOpacity
            style={s.resetBtn}
            onPress={() => {
              setSearchQuery("");
              setSelectedCuisine("All");
              setOnlyOpen(false);
              setMinRating(0);
              setSortBy("recommended");
            }}
          >
            <Text style={s.resetBtnTxt}>Clear All Filters</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filteredRestaurants}
          keyExtractor={(item) => item.id}
          renderItem={renderRestaurantCard}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={TEAL} />}
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
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: TEAL,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  filterToggleBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#F0FDF9",
    borderWidth: 1,
    borderColor: "#CCFBF1",
    alignItems: "center",
    justifyContent: "center",
  },
  filterToggleBtnActive: {
    backgroundColor: TEAL,
    borderColor: TEAL,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 14,
    borderRadius: 14,
    height: 44,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: DARK,
  },
  clearBtn: {
    padding: 4,
  },
  cuisinesWrap: {
    paddingBottom: 8,
  },
  cuisinesScroll: {
    paddingHorizontal: 16,
  },
  cuisinePill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginRight: 8,
  },
  cuisinePillActive: {
    backgroundColor: TEAL,
    borderColor: TEAL,
  },
  cuisinePillTxt: {
    fontSize: 12,
    fontWeight: "700",
    color: "#475569",
  },
  cuisinePillTxtActive: {
    color: "#FFFFFF",
  },
  filtersDrawer: {
    backgroundColor: "#FFFFFF",
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  filtersDrawerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  filterDrawerTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: DARK,
  },
  resetTxt: {
    fontSize: 12,
    fontWeight: "700",
    color: ORANGE,
  },
  filterSecLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748B",
    marginBottom: 6,
  },
  filterRowWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: "#F1F5F9",
    marginRight: 6,
    marginBottom: 6,
  },
  filterChipActive: {
    backgroundColor: TEAL,
  },
  filterChipTxt: {
    fontSize: 11,
    fontWeight: "700",
    color: "#475569",
  },
  filterChipTxtActive: {
    color: "#FFFFFF",
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    marginBottom: 16,
    overflow: "hidden",
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    borderWidth: 1,
    borderColor: "#F1F5F9",
  },
  cardImgWrapper: {
    height: 150,
    width: "100%",
    position: "relative",
  },
  cardImg: {
    width: "100%",
    height: "100%",
  },
  openBadge: {
    position: "absolute",
    top: 10,
    left: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  openBadgeTxt: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  dealBadge: {
    position: "absolute",
    bottom: 10,
    left: 10,
    backgroundColor: "rgba(225, 29, 72, 0.92)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  dealBadgeTxt: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "800",
  },
  deliveryTimeBadge: {
    position: "absolute",
    bottom: 10,
    right: 10,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(11, 42, 38, 0.85)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  deliveryTimeTxt: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  cardBody: {
    padding: 14,
  },
  cardRowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  cardTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "800",
    color: DARK,
    marginRight: 8,
  },
  ratingBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEFCE8",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
  },
  ratingTxt: {
    fontSize: 12,
    fontWeight: "800",
    color: DARK,
    marginLeft: 3,
  },
  reviewsTxt: {
    fontSize: 11,
    color: "#64748B",
    marginLeft: 2,
  },
  cardSub: {
    fontSize: 12,
    color: "#64748B",
    marginBottom: 4,
  },
  cardDesc: {
    fontSize: 11,
    color: "#94A3B8",
    lineHeight: 15,
  },
  centerBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 30,
  },
  loadingTxt: {
    color: "#64748B",
    marginTop: 10,
    fontSize: 13,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: DARK,
    marginTop: 14,
  },
  emptySub: {
    fontSize: 12,
    color: "#64748B",
    textAlign: "center",
    marginTop: 6,
    lineHeight: 18,
  },
  resetBtn: {
    marginTop: 16,
    backgroundColor: TEAL,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
  },
  resetBtnTxt: {
    color: "white",
    fontWeight: "700",
    fontSize: 13,
  },
});

