import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useDispatch, useSelector } from "react-redux";
import { useNavigation, useRoute } from "@react-navigation/native";
import { PlusIcon } from "react-native-heroicons/solid";
import {
  MagnifyingGlassIcon,
  ShoppingBagIcon,
  XMarkIcon,
  ShoppingCartIcon,
} from "react-native-heroicons/outline";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { db } from "../firebase";
import { addToBasket } from "../features/basketSlice";
import { UserAuth } from "../contexts/AuthContext";
import ScreenHeader, { IconButton } from "../components/ui/ScreenHeader";
import Input from "../components/ui/Input";
import Chip from "../components/ui/Chip";
import Button from "../components/ui/Button";
import Txt from "../components/ui/Txt";
import SmartImage from "../components/ui/SmartImage";
import PressableScale from "../components/ui/PressableScale";
import BottomSheet from "../components/ui/BottomSheet";
import Toast from "../components/ui/Toast";
import { ProductGridSkeleton } from "../components/ui/Skeleton";
import { EmptyState, ErrorState } from "../components/ui/States";
import { brand, useTheme } from "../theme/theme";
import { money } from "../utils/format";

const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";

export default function ProductDeliveryScreen() {
  const { c, radius, shadow, dark } = useTheme();
  const route = useRoute();
  const initialMode = route.params?.mode || "shops"; // "shops" | "packages"
  const [activeTab, setActiveTab] = useState(initialMode);

  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState({ message: "", nonce: 0 });
  const dispatch = useDispatch();
  const navigation = useNavigation();
  const { user, dbUser } = UserAuth();
  const basketItems = useSelector((state) => state.basket.items);

  // Package delivery form state
  const [packageType, setPackageType] = useState("Documents / Envelope");
  const [pickupAddress, setPickupAddress] = useState(dbUser?.address || "My Location, Ethiopia");
  const [dropoffAddress, setDropoffAddress] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [packageNotes, setPackageNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [productSnap, shopSnap] = await Promise.all([
        getDocs(query(collection(db, "products"), where("isActive", "==", true))),
        getDocs(query(collection(db, "shops"), where("status", "==", "APPROVED"))),
      ]);
      const shopMap = {};
      shopSnap.forEach((d) => {
        shopMap[d.id] = { id: d.id, ...d.data() };
      });
      const rows = [];
      productSnap.forEach((d) => {
        const data = d.data();
        const shop = shopMap[data.shopId];
        if (shop && shop.status === "APPROVED" && data.isActive !== false) {
          rows.push({
            id: d.id,
            ...data,
            shopName: shop.name || shop.businessName || "Shop",
            shopImage: shop.image || "",
          });
        }
      });
      setProducts(rows);
    } catch (e) {
      console.warn("Could not load shop products", e);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const categories = useMemo(
    () => [
      "All",
      ...Array.from(new Set(products.map((p) => p.category).filter(Boolean))),
    ],
    [products]
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((p) => {
      if (category !== "All" && p.category !== category) return false;
      if (!term) return true;
      return [
        p.name,
        p.description,
        p.category,
        p.shopName,
        ...(Array.isArray(p.tags) ? p.tags : []),
      ].some((v) => String(v || "").toLowerCase().includes(term));
    });
  }, [products, search, category]);

  const addProduct = (product) => {
    if (!user?.uid) {
      Alert.alert("Sign in required", "Please sign in to order products.");
      return;
    }
    if (!product.shopId) {
      Alert.alert("Unavailable", "This product is missing its shop information.");
      return;
    }
    const currentSeller = basketItems[0]?.restaurantId;
    if (currentSeller && currentSeller !== product.shopId) {
      Alert.alert(
        "One shop per order",
        "Please finish or clear your current basket before ordering from another shop."
      );
      return;
    }
    dispatch(
      addToBasket({
        id: product.id,
        name: product.name || "Product",
        price: Number(product.price || 0),
        restaurantId: product.shopId,
        restaurantName: product.shopName,
        restaurantImage: product.shopImage,
        shopId: product.shopId,
        sellerType: "shop",
        productType: "PRODUCT_DELIVERY",
        image: product.image || "",
      })
    );
    setToast({ message: `${product.name || "Product"} added to cart`, nonce: Date.now() });
  };

  const handleCreatePackageOrder = () => {
    if (!dropoffAddress.trim()) {
      Alert.alert("Missing dropoff", "Please enter the package delivery destination.");
      return;
    }
    if (!recipientPhone.trim() || recipientPhone.length < 9) {
      Alert.alert("Missing phone", "Please enter a valid recipient phone number.");
      return;
    }

    Alert.alert(
      "Courier Request Received",
      `Package: ${packageType}\nFrom: ${pickupAddress}\nTo: ${dropoffAddress}\nEstimated Delivery Fee: ETB 120\n\nA driver will be dispatched to pick up your package.`,
      [
        {
          text: "Confirm Order",
          onPress: () => {
            Alert.alert("Success!", "Package courier request submitted successfully!");
            navigation.navigate("OrdersTab");
          },
        },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };

  const basketTotal = basketItems.reduce((s, i) => s + Number(i.price || 0), 0);

  const renderItem = ({ item }) => (
    <PressableScale
      onPress={() => setSelected(item)}
      containerStyle={{ width: "48.4%" }}
      style={[
        {
          backgroundColor: c.surface,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: c.border,
          overflow: "hidden",
        },
        shadow.card,
      ]}
    >
      <SmartImage uri={item.image} style={{ height: 112, width: "100%" }} />
      <View style={{ padding: 10 }}>
        <Txt v="heading" numberOfLines={2} style={{ minHeight: 40, fontWeight: "700" }}>
          {item.name || "Product"}
        </Txt>
        <Txt v="caption" tone="muted" numberOfLines={1}>
          {item.shopName}
        </Txt>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 8,
          }}
        >
          <Txt v="heading" tone="primary" style={{ fontWeight: "800", color: TEAL }}>
            {money(item.price)}
          </Txt>
          <PressableScale
            onPress={() => addProduct(item)}
            hitSlop={8}
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              backgroundColor: TEAL,
              alignItems: "center",
              justifyContent: "center",
            }}
            accessibilityLabel={`Add ${item.name} to basket`}
          >
            <PlusIcon size={18} color="#FFFFFF" />
          </PressableScale>
        </View>
      </View>
    </PressableScale>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#F5FAF9" }}>
      <ScreenHeader
        title={activeTab === "packages" ? "Package Courier" : "Shop Delivery"}
        subtitle={activeTab === "packages" ? "Send parcels & documents" : "Items from local verified shops"}
        fallbackRoute="HomeTab"
        right={
          activeTab === "shops" ? (
            <IconButton
              icon={ShoppingBagIcon}
              label="Open basket"
              badge={basketItems.length || null}
              onPress={() => navigation.navigate("Basket")}
            />
          ) : null
        }
      />

      {/* Mode Switcher Tabs */}
      <View style={s.tabBar}>
        <TouchableOpacity
          onPress={() => setActiveTab("shops")}
          style={[s.tabItem, activeTab === "shops" && s.tabItemActive]}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons
            name="shopping-outline"
            size={18}
            color={activeTab === "shops" ? TEAL : "#64748B"}
          />
          <Text style={[s.tabTxt, activeTab === "shops" && s.tabTxtActive]}>
            Local Shops
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setActiveTab("packages")}
          style={[s.tabItem, activeTab === "packages" && s.tabItemActive]}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons
            name="package-variant-closed"
            size={18}
            color={activeTab === "packages" ? TEAL : "#64748B"}
          />
          <Text style={[s.tabTxt, activeTab === "packages" && s.tabTxtActive]}>
            Package Delivery
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === "packages" ? (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 60 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={s.packageCard}>
            <Text style={s.packageCardTitle}>Send a Package</Text>
            <Text style={s.packageCardSub}>
              Express door-to-door courier service across Addis Ababa
            </Text>

            <Text style={s.fieldLabel}>Package Type</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 12 }}>
              {[
                "Documents / Envelope",
                "Small Box (< 3kg)",
                "Medium Box (3-10kg)",
                "Fragile Item",
              ].map((t) => (
                <TouchableOpacity
                  key={t}
                  onPress={() => setPackageType(t)}
                  style={[s.typeChip, { marginRight: 8, marginBottom: 8 }, packageType === t && s.typeChipActive]}
                >
                  <Text style={[s.typeChipTxt, packageType === t && s.typeChipTxtActive]}>
                    {t}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={s.fieldLabel}>Pickup Location</Text>
            <TextInput
              style={s.textInput}
              value={pickupAddress}
              onChangeText={setPickupAddress}
              placeholder="e.g. Bole, Medhanialem"
            />

            <Text style={s.fieldLabel}>Delivery Destination</Text>
            <TextInput
              style={s.textInput}
              value={dropoffAddress}
              onChangeText={setDropoffAddress}
              placeholder="e.g. Kazanchis, Behind UNECA"
            />

            <Text style={s.fieldLabel}>Recipient Phone (+251)</Text>
            <TextInput
              style={s.textInput}
              value={recipientPhone}
              onChangeText={setRecipientPhone}
              keyboardType="phone-pad"
              placeholder="09XXXXXXXX"
            />

            <Text style={s.fieldLabel}>Special Notes (Optional)</Text>
            <TextInput
              style={[s.textInput, { height: 60, textAlignVertical: "top" }]}
              value={packageNotes}
              onChangeText={setPackageNotes}
              multiline
              placeholder="Building name, floor, or delivery instructions"
            />

            <View style={s.fareBox}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: "#64748B", fontSize: 13 }}>Estimated Fee</Text>
                <Text style={{ fontWeight: "800", color: TEAL, fontSize: 16 }}>ETB 120.00</Text>
              </View>
              <Text style={{ color: "#94A3B8", fontSize: 11, marginTop: 4 }}>
                Real-time GPS tracking included
              </Text>
            </View>

            <Button
              title="Request Package Pickup"
              onPress={handleCreatePackageOrder}
              style={{ marginTop: 16 }}
            />
          </View>
        </ScrollView>
      ) : (
        <>
          <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
            <Input
              icon={MagnifyingGlassIcon}
              value={search}
              onChangeText={setSearch}
              placeholder="Search products, categories or shops"
              returnKeyType="search"
              style={{ marginBottom: 8 }}
              right={
                search ? (
                  <PressableScale onPress={() => setSearch("")} hitSlop={10}>
                    <XMarkIcon size={18} color="#94A3B8" />
                  </PressableScale>
                ) : null
              }
            />
          </View>
          {categories.length > 2 ? (
            <View style={{ height: 44 }}>
              <FlatList
                horizontal
                data={categories}
                keyExtractor={(i) => i}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{
                  paddingHorizontal: 16,
                  alignItems: "center",
                }}
                renderItem={({ item }) => (
                  <View style={{ marginRight: 8 }}>
                    <Chip
                      label={item}
                      selected={category === item}
                      onPress={() => setCategory(item)}
                    />
                  </View>
                )}
              />
            </View>
          ) : null}

          {loading ? (
            <View style={{ marginTop: 8 }}>
              <ProductGridSkeleton />
            </View>
          ) : error ? (
            <ErrorState
              title="Products unavailable"
              subtitle="Check your connection and try again."
              onRetry={load}
            />
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(i) => i.id}
              numColumns={2}
              renderItem={renderItem}
              columnWrapperStyle={{ justifyContent: "space-between" }}
              contentContainerStyle={{
                padding: 16,
                paddingTop: 8,
                paddingBottom: basketItems.length ? 96 : 32,
                flexGrow: 1,
              }}
              showsVerticalScrollIndicator={false}
              ListHeaderComponent={
                filtered.length ? (
                  <Txt v="caption" tone="muted" style={{ marginBottom: 2 }}>
                    {filtered.length} products available
                  </Txt>
                ) : null
              }
              ListEmptyComponent={
                <EmptyState
                  icon="shopping-outline"
                  title={search || category !== "All" ? "No matches found" : "Nothing here yet"}
                  subtitle={
                    search || category !== "All"
                      ? "Try another search term or category."
                      : "No approved shop products are listed yet. Check back soon!"
                  }
                  action={search || category !== "All" ? "Clear filters" : undefined}
                  onAction={() => {
                    setSearch("");
                    setCategory("All");
                  }}
                />
              }
            />
          )}

          {basketItems.length > 0 ? (
            <PressableScale
              onPress={() => navigation.navigate("Basket")}
              containerStyle={{
                position: "absolute",
                left: 16,
                right: 16,
                bottom: 16,
              }}
              style={[
                {
                  height: 52,
                  borderRadius: radius.lg,
                  backgroundColor: DARK,
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 16,
                },
                shadow.float,
              ]}
            >
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  backgroundColor: ORANGE,
                  alignItems: "center",
                  justifyContent: "center",
                  marginRight: 10,
                }}
              >
                <Txt v="caption" tone="inverse" style={{ fontWeight: "800" }}>
                  {basketItems.length}
                </Txt>
              </View>
              <Txt v="heading" tone="inverse" style={{ flex: 1, fontWeight: "700" }}>
                View Cart
              </Txt>
              <Txt v="heading" tone="inverse" style={{ fontWeight: "800" }}>
                {money(basketTotal)}
              </Txt>
            </PressableScale>
          ) : null}

          <Toast
            message={toast.message}
            nonce={toast.nonce}
            bottom={basketItems.length ? 80 : 24}
          />

          <BottomSheet visible={!!selected} onClose={() => setSelected(null)}>
            {selected ? (
              <View>
                <SmartImage
                  uri={selected.image}
                  style={{ height: 170, borderRadius: radius.lg, marginBottom: 12 }}
                />
                <Txt v="title" style={{ fontWeight: "800", color: DARK }}>
                  {selected.name || "Product"}
                </Txt>
                <Txt v="caption" tone="muted" style={{ marginTop: 2 }}>
                  {selected.shopName}
                  {selected.category ? ` · ${selected.category}` : ""}
                </Txt>
                {selected.description ? (
                  <Txt v="body" tone="muted" style={{ marginTop: 8 }}>
                    {selected.description}
                  </Txt>
                ) : null}
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    marginTop: 14,
                  }}
                >
                  <Txt v="title" tone="primary" style={{ fontWeight: "800", color: TEAL, marginRight: 14 }}>
                    {money(selected.price)}
                  </Txt>
                  <Button
                    title="Add to Cart"
                    style={{ flex: 1 }}
                    onPress={() => {
                      addProduct(selected);
                      setSelected(null);
                    }}
                  />
                </View>
              </View>
            ) : null}
          </BottomSheet>
        </>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  tabBar: {
    flexDirection: "row",
    backgroundColor: "white",
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  tabItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: 8,
  },
  tabItemActive: {
    backgroundColor: "#E6F4F1",
  },
  tabTxt: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748B",
  },
  tabTxtActive: {
    color: TEAL,
    fontWeight: "800",
  },
  packageCard: {
    backgroundColor: "white",
    borderRadius: 16,
    padding: 16,
    elevation: 2,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  packageCardTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: DARK,
  },
  packageCardSub: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: DARK,
    marginBottom: 6,
  },
  typeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    backgroundColor: "#F8FAFC",
  },
  typeChipActive: {
    borderColor: TEAL,
    backgroundColor: "#E6F4F1",
  },
  typeChipTxt: {
    fontSize: 12,
    color: "#475569",
    fontWeight: "600",
  },
  typeChipTxtActive: {
    color: TEAL,
    fontWeight: "800",
  },
  textInput: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: DARK,
    marginBottom: 12,
  },
  fareBox: {
    backgroundColor: "#F0FDF4",
    borderWidth: 1,
    borderColor: "#BBF7D0",
    borderRadius: 12,
    padding: 12,
    marginTop: 6,
  },
});
