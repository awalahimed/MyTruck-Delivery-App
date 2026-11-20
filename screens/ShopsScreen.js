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
  Dimensions,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useNavigation } from "@react-navigation/native";
import { useDispatch, useSelector } from "react-redux";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { MagnifyingGlassIcon, PlusIcon, ShoppingBagIcon } from "react-native-heroicons/outline";
import { StarIcon } from "react-native-heroicons/solid";
import { db } from "../firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import { addToBasket, selectBasketItems } from "../features/basketSlice";
import { selectUser } from "../features/userSlice";
import BackButton from "../components/ui/BackButton";
import BasketIcon from "../components/BasketIcon";
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

const { width } = Dimensions.get("window");
const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";
const BG = "#F5FAF9";

const SHOP_CATEGORIES = [
  "All",
  "Supermarket",
  "Fresh Market",
  "Pharmacy",
  "Groceries",
  "Beverages",
  "Health & Care",
];

export default function ShopsScreen() {
  // Re-render with the Super Admin's live pricing
  const pricingConfig = usePricingConfig();
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const basketItems = useSelector(selectBasketItems);
  const reduxUser = useSelector(selectUser);

  const userCoords = useMemo(() => ({
    latitude: Number(reduxUser?.latitude) || 8.9806,
    longitude: Number(reduxUser?.longitude) || 38.7578,
  }), [reduxUser?.latitude, reduxUser?.longitude]);

  const [shops, setShops] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedShopId, setSelectedShopId] = useState(null);

  const loadShopsAndProducts = useCallback(async () => {
    try {
      const [shopSnap, prodSnap, dishSnap] = await Promise.all([
        getDocs(collection(db, "shops")),
        getDocs(collection(db, "products")),
        getDocs(collection(db, "dishes")),
      ]);

      const shopList = [];
      shopSnap.forEach((d) => {
        const data = d.data();
        if (String(data.status || data.approvalStatus || "").toUpperCase() === "APPROVED" && data.isVerified !== false && data.isActive !== false) {
          shopList.push({ id: d.id, ...data });
        }
      });

      const prodList = [];
      const seenIds = new Set();

      prodSnap.forEach((d) => {
        const data = d.data();
        const isApprovedItem =
          data.isApproved === true ||
          data.status === "APPROVED" ||
          data.status === "Published" ||
          data.isPublished === true;

        if (isApprovedItem && data.isActive !== false) {
          prodList.push({ id: d.id, ...data });
          seenIds.add(d.id);
        }
      });

      // Include approved shop items from dishes collection
      dishSnap.forEach((d) => {
        const data = d.data();
        const isShopItem =
          data.isShop === true ||
          data.sellerType === "shop" ||
          data.category === "Groceries" ||
          Boolean(data.shopId) ||
          (data.restaurantName && data.restaurantName.toLowerCase().includes("supermarket"));

        const isApprovedItem =
          data.isApproved === true ||
          data.status === "APPROVED" ||
          data.status === "Published" ||
          data.lifecycleStatus === "Published" || data.isPublished === true;

        if (isShopItem && isApprovedItem && data.isAvailable !== false) {
          const matchedShopId = data.shopId || data.restaurantId;
          if (!matchedShopId || !shopList.some((shop) => shop.id === matchedShopId)) return;
          const mappedId = `dish-${d.id}`;
          if (!seenIds.has(mappedId) && !seenIds.has(d.id)) {
            seenIds.add(mappedId);
            const origPrice = Number(data.originalPrice || data.price || 0);
            const discPrice = data.discountedPrice != null ? Number(data.discountedPrice) : Number(data.price || 0);
            const hasDisc = Boolean(data.hasDiscount && discPrice < origPrice);
            prodList.push({
              id: mappedId,
              dishId: d.id,
              name: data.name,
              price: data.price,
              originalPrice: origPrice,
              discountedPrice: discPrice,
              hasDiscount: hasDisc,
              discountPercent: data.discountPercent || (hasDisc && origPrice > 0 ? Math.round(((origPrice - discPrice) / origPrice) * 100) : 0),
              category: data.category || "Groceries",
              description: data.description || "",
              image: data.image,
              shopId: matchedShopId,
              inStock: data.isAvailable !== false,
              isActive: true,
            });
          }
        }
      });

      // Customer catalogue is populated only by approved Firestore records.
      setShops(shopList);
      setProducts(prodList);
    } catch (e) {
      console.warn("ShopsScreen: error loading data", e?.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadShopsAndProducts();
    const unsubscribe = navigation.addListener("focus", loadShopsAndProducts);
    return unsubscribe;
  }, [loadShopsAndProducts, navigation]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadShopsAndProducts();
    setRefreshing(false);
  }, [loadShopsAndProducts]);

  const handleAddToCart = (product) => {
    const parentShop = shops.find((s) => s.id === product.shopId);
    const sLat = Number(parentShop?.latitude ?? parentShop?.lat ?? parentShop?.storeLatitude);
    const sLng = Number(parentShop?.longitude ?? parentShop?.lng ?? parentShop?.storeLongitude);
    if (!Number.isFinite(sLat) || !Number.isFinite(sLng)) {
      Alert.alert("Notice", "This shop has no verified location pin.");
      return;
    }
    const shopCoords = { latitude: sLat, longitude: sLng };
    const maxRadius = Number(parentShop?.deliveryRadiusKm) || getMaxOrderDistanceKm("shop");
    if (isFarDistance(shopCoords, userCoords, maxRadius, "shop")) {
      Alert.alert("Outside Delivery Area", FAR_DISTANCE_NOTICE);
      return;
    }

    const info = getItemDiscountInfo(product);
    dispatch(
      addToBasket({
        id: product.id,
        dishId: product.dishId || product.id,
        name: product.name,
        price: info.customerSellingPrice,
        merchantBasePrice: info.rawSellingPrice,
        originalPrice: info.customerOriginalPrice,
        discountedPrice: info.customerSellingPrice,
        hasDiscount: info.hasDiscount,
        discountPercent: info.discountPercent,
        savingsAmount: info.savingsAmount,
        imgUrl: product.image,
        sellerType: "shop",
        shopId: product.shopId,
      })
    );
  };


  const visibleShops = useMemo(() => {
    const maxRadius = getMaxOrderDistanceKm("shop");
    const uAddress = String(reduxUser?.address || "").toLowerCase();
    return shops.filter((shop) => {
      const sLat = Number(shop.latitude ?? shop.lat ?? shop.storeLatitude);
      const sLng = Number(shop.longitude ?? shop.lng ?? shop.storeLongitude);
      if (shop.id === "shop-bambis-supermarket") return true;
      if (!Number.isFinite(sLat) || !Number.isFinite(sLng)) return false;

      const dist = calculateDistanceKm(userCoords.latitude, userCoords.longitude, sLat, sLng);
      const limit = Number(shop.deliveryRadiusKm) || maxRadius;
      if (dist > limit) return false;

      if (shop.city && uAddress) {
        const sCity = String(shop.city).toLowerCase();
        if (uAddress.includes("nekemte") && !sCity.includes("nekemte")) return false;
        if (uAddress.includes("addis") && !sCity.includes("addis")) return false;
      }
      return true;
    });
  }, [shops, userCoords, reduxUser?.address]);

  const filteredProducts = useMemo(() => {
    const deliverableShopIds = new Set(visibleShops.map((s) => s.id));
    let result = products.filter((p) => deliverableShopIds.has(p.shopId));

    if (selectedShopId) {
      result = result.filter((p) => p.shopId === selectedShopId);
    }

    if (selectedCategory !== "All") {
      result = result.filter(
        (p) =>
          (p.category && p.category.toLowerCase().includes(selectedCategory.toLowerCase())) ||
          (p.type && p.type.toLowerCase().includes(selectedCategory.toLowerCase()))
      );
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (p) =>
          (p.name && p.name.toLowerCase().includes(q)) ||
          (p.description && p.description.toLowerCase().includes(q))
      );
    }

    return result;
  }, [products, visibleShops, selectedShopId, selectedCategory, searchQuery]);

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <StatusBar style="dark" />
      <BasketIcon />

      {/* Header */}
      <View style={s.header}>
        <BackButton fallbackRoute="HomeTab" color="#FFFFFF" variant="transparent" />
        <View style={s.headerTextWrap}>
          <Text style={s.headerTitle}>Browse Retail & Shops</Text>
          <Text style={s.headerSubtitle}>Groceries, supermarkets & essentials</Text>
        </View>
        <TouchableOpacity
          style={s.cartShortcut}
          onPress={() => navigation.navigate("Basket")}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons name="cart-outline" size={22} color="#FFFFFF" />
          {basketItems.length > 0 && (
            <View style={s.badge}>
              <Text style={s.badgeTxt}>{basketItems.length}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={s.searchWrap}>
        <MagnifyingGlassIcon size={20} color="#94A3B8" style={{ marginRight: 8 }} />
        <TextInput
          style={s.searchInput}
          placeholder="Search products or groceries..."
          placeholderTextColor="#94A3B8"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery("")}>
            <MaterialCommunityIcons name="close-circle" size={18} color="#94A3B8" />
          </TouchableOpacity>
        )}
      </View>

      {/* Category Pills */}
      <View style={s.categoryBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16 }}
        >
          {SHOP_CATEGORIES.map((cat) => {
            const active = selectedCategory === cat;
            return (
              <TouchableOpacity
                key={cat}
                style={[s.categoryChip, active && s.categoryChipActive]}
                onPress={() => setSelectedCategory(cat)}
                activeOpacity={0.8}
              >
                <Text style={[s.categoryChipTxt, active && s.categoryChipTxtActive]}>
                  {cat}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={TEAL} />}
      >
        {/* Partner Shops Section */}
        <View style={s.shopsSection}>
          <View style={s.sectionHeaderRow}>
            <Text style={s.sectionHeading}>Verified Partner Stores</Text>
            {selectedShopId && (
              <TouchableOpacity onPress={() => setSelectedShopId(null)}>
                <Text style={s.clearFilterTxt}>Show All</Text>
              </TouchableOpacity>
            )}
          </View>

          {visibleShops.length === 0 ? (
            <View style={{ padding: 18, alignItems: "center" }}>
              <MaterialCommunityIcons name="store-remove-outline" size={32} color="#CBD5E1" />
              <Text style={{ color: "#64748B", fontSize: 13, fontWeight: "600", marginTop: 6 }}>
                No partner shops delivering to your area yet
              </Text>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.shopsScroll}>
              {visibleShops.map((shop) => {
              const isSelected = selectedShopId === shop.id;
              return (
                <TouchableOpacity
                  key={shop.id}
                  style={[s.shopCard, isSelected && s.shopCardActive]}
                  onPress={() => setSelectedShopId(isSelected ? null : shop.id)}
                  activeOpacity={0.85}
                >
                  <ResilientImage
                    source={shop.image || shop.imgUrl || shop.logoUrl}
                    fallbackCategory="none"
                    style={s.shopImg}
                    resizeMode="cover"
                  />
                  <View style={s.shopInfo}>
                    <Text style={s.shopName} numberOfLines={1}>{shop.name}</Text>
                    <Text style={s.shopType} numberOfLines={1}>{shop.category || "Retail"}</Text>
                    <View style={s.shopRatingRow}>
                      {shop.rating != null ? <><StarIcon size={12} color="#EAB308" /><Text style={s.shopRatingTxt}>{shop.rating}</Text></> : null}
                      {shop.deliveryTime ? <Text style={s.shopEta}> · {shop.deliveryTime}</Text> : null}
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
            </ScrollView>
          )}
        </View>

        {/* Products Grid */}
        <View style={s.productsSection}>
          <Text style={s.sectionHeading}>
            {selectedShopId
              ? `Products from ${shops.find((s) => s.id === selectedShopId)?.name || "Store"}`
              : "Available Items"}
          </Text>

          {loading ? (
            <View style={s.centerBox}>
              <ActivityIndicator size="large" color={TEAL} />
              <Text style={s.loadingTxt}>Loading store products...</Text>
            </View>
          ) : filteredProducts.length === 0 ? (
            <View style={s.emptyBox}>
              <MaterialCommunityIcons name="shopping-outline" size={48} color="#CBD5E1" />
              <Text style={s.emptyTitle}>No products found</Text>
              <Text style={s.emptySub}>Try searching for another item or clearing filters.</Text>
            </View>
          ) : (
            <View style={s.productsGrid}>
              {filteredProducts.map((p) => {
                const inCart = basketItems.some((b) => b.id === p.id);
                return (
                  <View key={p.id} style={s.productCard}>
                    <ResilientImage
                      source={p.image || p.imgUrl}
                      fallbackCategory="none"
                      style={s.productImg}
                      resizeMode="cover"
                    />
                    <View style={s.productBody}>
                      <Text style={s.productName} numberOfLines={2}>
                        {p.name}
                      </Text>
                      {Boolean(p.description) && (
                        <Text style={s.productDesc} numberOfLines={2}>
                          {p.description}
                        </Text>
                      )}
                      <View style={s.productFooter}>
                        {(() => {
                          const pInfo = getItemDiscountInfo(p);
                          return (
                            <View style={s.priceBox}>
                              <View style={s.sellingPriceRow}>
                                <Text style={s.productSellingPrice} numberOfLines={1}>
                                  {pInfo.formattedSelling}
                                </Text>
                                {pInfo.hasDiscount && (
                                  <View style={s.discountTag}>
                                    <Text style={s.discountTagTxt}>-{String(pInfo.discountPercent ?? 0)}%</Text>
                                  </View>
                                )}
                              </View>
                              {pInfo.hasDiscount ? (
                                <View style={s.savingsRow}>
                                  <Text style={s.productOriginalPrice} numberOfLines={1}>
                                    {pInfo.formattedOriginal}
                                  </Text>
                                </View>
                              ) : (
                                <Text style={s.inStockTxt} numberOfLines={1}>In Stock</Text>
                              )}
                            </View>
                          );
                        })()}

                        <TouchableOpacity
                          style={[s.addBtn, inCart && s.addBtnActive]}
                          onPress={() => handleAddToCart(p)}
                          activeOpacity={0.82}
                          accessibilityLabel={`Add ${p.name} to cart`}
                        >
                          <PlusIcon size={13} color="white" />
                          <Text style={s.addBtnTxt}>{inCart ? "Added" : "Add"}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "white",
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
  headerTextWrap: {
    flex: 1,
    marginLeft: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  headerSubtitle: {
    fontSize: 12,
    color: "#CCFBF1",
    marginTop: 1,
  },
  cartShortcut: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#F0FDF4",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  badge: {
    position: "absolute",
    top: -2,
    right: -2,
    backgroundColor: ORANGE,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeTxt: {
    color: "white",
    fontSize: 10,
    fontWeight: "800",
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: DARK,
  },
  categoryBar: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: "#F1F5F9",
    marginRight: 8,
  },
  categoryChipActive: {
    backgroundColor: TEAL,
  },
  categoryChipTxt: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748B",
  },
  categoryChipTxtActive: {
    color: "white",
    fontWeight: "700",
  },
  scrollContent: {
    paddingBottom: 90,
  },
  shopsSection: {
    paddingTop: 14,
    paddingBottom: 8,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: "800",
    color: DARK,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  clearFilterTxt: {
    fontSize: 13,
    fontWeight: "700",
    color: TEAL,
  },
  shopsScroll: {
    paddingHorizontal: 16,
  },
  shopCard: {
    width: 140,
    backgroundColor: "white",
    borderRadius: 14,
    marginRight: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  shopCardActive: {
    borderColor: TEAL,
    borderWidth: 2,
  },
  shopImg: {
    width: "100%",
    height: 75,
  },
  shopInfo: {
    padding: 8,
  },
  shopName: {
    fontSize: 13,
    fontWeight: "700",
    color: DARK,
  },
  shopType: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 1,
  },
  shopRatingRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  shopRatingTxt: {
    fontSize: 11,
    fontWeight: "700",
    color: DARK,
    marginLeft: 3,
  },
  shopEta: {
    fontSize: 10,
    color: "#94A3B8",
  },
  productsSection: {
    marginTop: 10,
  },
  productsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 10,
    justifyContent: "space-between",
  },
  productCard: {
    width: (width - 32) / 2,
    backgroundColor: "white",
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  productImg: {
    width: "100%",
    height: 110,
  },
  productBody: {
    padding: 10,
    flex: 1,
    justifyContent: "space-between",
  },
  productName: {
    fontSize: 13,
    fontWeight: "700",
    color: DARK,
    lineHeight: 17,
  },
  productDesc: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 3,
    lineHeight: 14,
  },
  productFooter: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  priceBox: {
    flex: 1,
    marginRight: 6,
    justifyContent: "center",
  },
  sellingPriceRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "nowrap",
  },
  productSellingPrice: {
    fontSize: 13,
    fontWeight: "900",
    color: "#E11D48",
    marginRight: 4,
  },
  discountTag: {
    backgroundColor: "#FEE2E2",
    paddingHorizontal: 3,
    paddingVertical: 1,
    borderRadius: 3,
  },
  discountTagTxt: {
    fontSize: 8.5,
    fontWeight: "800",
    color: "#E11D48",
  },
  savingsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  productOriginalPrice: {
    fontSize: 10,
    color: "#94A3B8",
    textDecorationLine: "line-through",
    fontWeight: "600",
  },
  inStockTxt: {
    fontSize: 9.5,
    color: "#16A34A",
    fontWeight: "700",
    marginTop: 2,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: TEAL,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
    minWidth: 54,
  },
  addBtnActive: {
    backgroundColor: ORANGE,
  },
  addBtnTxt: {
    color: "white",
    fontSize: 11,
    fontWeight: "800",
    marginLeft: 3,
  },
  centerBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  loadingTxt: {
    fontSize: 13,
    color: "#64748B",
    marginTop: 8,
  },
  emptyBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: DARK,
    marginTop: 8,
  },
  emptySub: {
    fontSize: 12,
    color: "#94A3B8",
    textAlign: "center",
    marginTop: 4,
  },
});

