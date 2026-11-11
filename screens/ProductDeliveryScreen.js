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
import { collection, doc, setDoc, getDocs, onSnapshot, query, where, serverTimestamp } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
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
import { app, db } from "../firebase";
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
import {
  getItemDiscountInfo,
  calculatePackageQuote,
  PACKAGE_TYPES,
  MAX_CUSTOMER_ORDER_DISTANCE_KM,
} from "../utils/pricing";
import DeliveryLocationModal from "../components/DeliveryLocationModal";
import { isWithinEthiopia } from "../utils/mapService";
import { selectUser } from "../features/userSlice";
import { usePricingConfig } from "../utils/usePricingConfig";
import { startChapaCheckout, hasAppChapaKey, serverIsKnownMissing } from "../services/chapaClient";
import { presentLocalNotification } from "../services/notificationService";

const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";

export default function ProductDeliveryScreen() {
  // Re-render with the Super Admin's live pricing
  const pricingConfig = usePricingConfig();
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
  const reduxUser = useSelector(selectUser);
  const [packageType, setPackageType] = useState(PACKAGE_TYPES[0]);
  const [pickup, setPickup] = useState(() => {
    const src = [reduxUser, dbUser].find(
      (u) => u?.latitude && u?.longitude && isWithinEthiopia(Number(u.latitude), Number(u.longitude))
    );
    return src
      ? { address: src.address || "My Location", latitude: Number(src.latitude), longitude: Number(src.longitude) }
      : null;
  });
  const [dropoff, setDropoff] = useState(null);
  const [pickerFor, setPickerFor] = useState(null); // "pickup" | "dropoff" | null
  const [pickupDetails, setPickupDetails] = useState("");
  const [dropoffDetails, setDropoffDetails] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [packageNotes, setPackageNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CHAPA"); // "COD" | "CHAPA"
  const [submittingPackage, setSubmittingPackage] = useState(false);

  // Payment options from Super Admin Settings (same rules as the basket checkout)
  const [paymentConfig, setPaymentConfig] = useState({ chapaEnabled: true, codEnabled: false });
  useEffect(() => {
    if (!user?.uid) return undefined;
    return onSnapshot(
      doc(db, "platformSettings", "config"),
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        setPaymentConfig({ chapaEnabled: d.chapaEnabled !== false, codEnabled: d.codEnabled === true });
      },
      (e) => console.warn("Payment settings unavailable:", e?.code, e?.message)
    );
  }, [user?.uid]);

  // null = checking, true = Chapa server functions reachable, false = not deployed
  const [chapaLive, setChapaLive] = useState(null);
  useEffect(() => {
    if (!paymentConfig.chapaEnabled || !user?.uid) return undefined;
    if (serverIsKnownMissing()) {
      setChapaLive(false);
      return undefined;
    }
    let alive = true;
    httpsCallable(getFunctions(app), "createChapaCheckout")({ probe: true })
      .then(() => alive && setChapaLive(true))
      .catch((e) => {
        if (!alive) return;
        const code = String(e?.code || "");
        setChapaLive(!(code.includes("not-found") || code.includes("unimplemented") || code.includes("internal")));
      });
    return () => {
      alive = false;
    };
  }, [paymentConfig.chapaEnabled, user?.uid]);
  const chapaAvailable = paymentConfig.chapaEnabled && (chapaLive !== false || hasAppChapaKey());
  const codAvailable = paymentConfig.codEnabled;
  const noPaymentMethod = !chapaAvailable && !codAvailable;
  useEffect(() => {
    if (paymentMethod === "CHAPA" && !chapaAvailable && codAvailable) setPaymentMethod("COD");
    if (paymentMethod === "COD" && !codAvailable && chapaAvailable) setPaymentMethod("CHAPA");
  }, [chapaAvailable, codAvailable, paymentMethod]);

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
    // Same customer pricing as every other storefront (merchant price + platform markup)
    const info = getItemDiscountInfo(product);
    dispatch(
      addToBasket({
        id: product.id,
        dishId: product.id,
        name: product.name || "Product",
        price: info.customerSellingPrice,
        merchantBasePrice: info.rawSellingPrice,
        originalPrice: info.customerOriginalPrice,
        discountedPrice: info.customerSellingPrice,
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

  // Live package price from the Super Admin's package pricing (re-computed when it changes)
  const packageQuote = useMemo(
    () => calculatePackageQuote(pickup, dropoff, packageType),
    [pickup, dropoff, packageType, pricingConfig]
  );
  const packageTooFar =
    packageQuote.hasDistance && packageQuote.distanceKm > MAX_CUSTOMER_ORDER_DISTANCE_KM;

  const handleCreatePackageOrder = () => {
    if (!user?.uid) {
      Alert.alert("Sign in required", "Please sign in to send a package.");
      return;
    }
    if (!pickup) {
      Alert.alert("Missing pickup", "Choose where the driver should pick up the package.");
      return;
    }
    if (!dropoff) {
      Alert.alert("Missing destination", "Choose where the package should be delivered.");
      return;
    }
    if (packageQuote.hasDistance && packageQuote.distanceKm < 0.05) {
      Alert.alert("Same location", "Pickup and destination are the same place. Please check both locations.");
      return;
    }
    if (packageTooFar) {
      Alert.alert(
        "Too far",
        `Package delivery is available up to ${MAX_CUSTOMER_ORDER_DISTANCE_KM} km. This trip is ${packageQuote.distanceKm} km.`
      );
      return;
    }
    if (!recipientName.trim()) {
      Alert.alert("Missing recipient", "Please enter the recipient's name.");
      return;
    }
    const phoneDigits = recipientPhone.replace(/\D/g, "");
    const localPhone = phoneDigits.startsWith("251") ? "0" + phoneDigits.slice(3) : phoneDigits;
    if (!/^0[79]\d{8}$/.test(localPhone)) {
      Alert.alert("Invalid phone", "Enter the recipient's Ethiopian mobile number, e.g. 0911234567.");
      return;
    }

    if (noPaymentMethod) {
      Alert.alert("Checkout Unavailable", "Online payment and Cash on Delivery are both turned off right now. Please try again later.");
      return;
    }
    if (paymentMethod === "CHAPA" ? !chapaAvailable : !codAvailable) {
      Alert.alert("Payment method unavailable", "Please choose another payment method.");
      return;
    }
    if (submittingPackage) return;

    Alert.alert(
      "Confirm Package Pickup",
      `${packageType}\n${pickup.address} → ${dropoff.address}\n\nTotal: ETB ${packageQuote.total.toFixed(2)} · ${
        paymentMethod === "CHAPA" ? "Pay online (Chapa)" : "Cash on delivery"
      }`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Confirm", onPress: () => submitPackageOrder(localPhone) },
      ]
    );
  };

  const submitPackageOrder = async (recipientLocalPhone) => {
    setSubmittingPackage(true);
    try {
      // Re-price at submit time so the order always uses the admin's current package pricing
      const quote = calculatePackageQuote(pickup, dropoff, packageType);
      const fin = quote.financials;
      const custFullName = String(dbUser?.fullName || user?.displayName || "Customer").trim() || "Customer";
      const custPhone = String(dbUser?.phoneNumber || user?.phoneNumber || "").trim();
      const nameParts = custFullName.split(" ");

      // ── Chapa: start the checkout BEFORE writing the order (no order without a payment link) ──
      let chapa = null;
      if (paymentMethod === "CHAPA") {
        const rawPhone = custPhone.replace(/\D/g, "");
        const phone10 = rawPhone.startsWith("251") ? "0" + rawPhone.slice(3) : rawPhone.startsWith("0") ? rawPhone : "0" + rawPhone;
        let email = String(user?.email || dbUser?.email || "").trim().toLowerCase();
        if (!email.includes("@") || email.endsWith(".local") || email.endsWith(".et")) {
          email = phone10.length >= 9 ? `customer${phone10}@gmail.com` : "customer@gmail.com";
        }
        let failReason = "";
        try {
          const started = await startChapaCheckout({
            amount: quote.total,
            email,
            firstName: nameParts[0] || "Customer",
            lastName: nameParts.slice(1).join(" ") || "Client",
            phone: phone10,
            description: "MyTruck package delivery",
          });
          if (started?.checkoutUrl) chapa = { txRef: started.txRef, checkoutUrl: started.checkoutUrl };
        } catch (initErr) {
          console.warn("Chapa package checkout error:", initErr?.code, initErr?.message);
          failReason = String(initErr?.message || "");
          const code = String(initErr?.code || "");
          if (code.includes("not-found") || code.includes("unimplemented") || code === "chapa/unavailable") setChapaLive(false);
        }
        if (!chapa) {
          Alert.alert(
            "Payment Unavailable",
            `Online payment could not be started.${failReason ? `\n\nReason: ${failReason.slice(0, 200)}` : ""}\n\nPlease try again${
              codAvailable ? ", or choose Cash on Delivery" : ""
            }.`
          );
          return;
        }
      }

      const orderRef = doc(collection(db, "orders"));
      const orderId = orderRef.id;
      const pickupCoords = { latitude: Number(pickup.latitude), longitude: Number(pickup.longitude) };
      const dropCoords = { latitude: Number(dropoff.latitude), longitude: Number(dropoff.longitude) };
      const pickupFullAddress = [pickup.address, pickupDetails.trim()].filter(Boolean).join(" · ");
      const dropoffFullAddress = [dropoff.address, dropoffDetails.trim()].filter(Boolean).join(" · ");

      const order = {
        orderId,
        orderType: "PACKAGE",
        sellerType: "package",
        userId: user.uid,
        customerName: custFullName,
        customerPhone: custPhone,
        userPhoneNumber: custPhone,
        phone: custPhone,
        userFirstName: nameParts[0] || "Customer",
        userLastName: nameParts.slice(1).join(" ") || "",
        customerEmail: user.email || dbUser?.email || "",
        // Packages have no store: a private placeholder id that no seller account owns
        restaurantId: `package_${orderId}`,
        merchantId: null,
        merchantOwnerUid: null,
        restaurantName: `Package · ${packageType}`,
        restaurantImage: null,
        restaurantAddress: pickupFullAddress,
        restaurantPhone: custPhone, // the sender hands the package over
        restaurantLat: pickupCoords.latitude,
        restaurantLng: pickupCoords.longitude,
        pickupAddress: pickupFullAddress,
        pickupCoords,
        pickupLocationVerified: true,
        userAddress: dropoffFullAddress,
        deliveryAddress: dropoffFullAddress,
        dropoffAddress: dropoffFullAddress,
        deliveryCoords: dropCoords,
        dropoffCoords: dropCoords,
        deliveryLat: dropCoords.latitude,
        deliveryLng: dropCoords.longitude,
        deliveryDistanceKm: quote.distanceKm,
        deliveryEtaMinutes: quote.etaMinutes,
        isIntercity: false,
        // Package details
        packageType,
        packageNotes: packageNotes.trim(),
        senderName: custFullName,
        senderPhone: custPhone,
        recipientName: recipientName.trim(),
        recipientPhone: recipientLocalPhone,
        // No store step: cash orders go straight to drivers (READY); Chapa orders wait for payment
        status: chapa ? "AWAITING_PAYMENT" : "READY",
        ...(chapa ? {} : { readyAt: serverTimestamp(), dispatchStartedAt: serverTimestamp() }),
        paymentMethod,
        paymentStatus: chapa ? "UNPAID" : "PENDING",
        ...(chapa
          ? {
              paymentInitiatedAt: serverTimestamp(),
              chapaMerchantReference: chapa.txRef,
              chapaCheckoutUrl: chapa.checkoutUrl,
            }
          : {}),
        // Money — from the admin's package pricing
        subtotal: 0,
        originalSubtotal: 0,
        discountedSubtotal: 0,
        merchantBaseSubtotal: 0,
        platformItemMarkup: 0,
        promoDiscount: 0,
        packageBaseFee: quote.baseFee,
        packageDistanceCharge: quote.distanceCharge,
        packageTypeSurcharge: quote.typeSurcharge,
        deliveryFee: fin.deliveryFee,
        serviceFee: fin.serviceFee,
        total: fin.total,
        currency: "ETB",
        restaurantEarnings: 0,
        deliveryCommissionPercent: fin.deliveryCommissionPercent,
        deliveryCommission: fin.deliveryCommission,
        driverEarnings: fin.driverEarnings,
        companyProfit: fin.companyProfit,
        totalOwedOut: fin.totalOwedOut,
        deliveryOtp: String(Math.floor(1000 + Math.random() * 9000)),
        itemsCount: 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(orderRef, order);

      if (chapa) {
        navigation.replace("PreparingOrderScreen", {
          orderId,
          orderIds: [orderId],
          paymentPending: true,
          autoLaunchChapa: true,
          initialCheckoutUrl: chapa.checkoutUrl,
          txRef: chapa.txRef,
        });
      } else {
        presentLocalNotification({
          title: "Package Request Sent 📦",
          body: `#${orderId.slice(0, 8).toUpperCase()} · finding the nearest driver · ETB ${fin.total.toFixed(2)} cash on delivery`,
          data: { orderId, targetRoute: "TrackOrder" },
          category: "orders",
        }).catch(() => {});
        navigation.replace("PreparingOrderScreen", { orderId, orderIds: [orderId] });
      }
    } catch (err) {
      console.error("Package order failed:", err);
      Alert.alert("Could Not Send Package", err?.message || "Please check your connection and try again.");
    } finally {
      setSubmittingPackage(false);
    }
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
            {money(getItemDiscountInfo(item).customerSellingPrice)}
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
              {PACKAGE_TYPES.map((t) => {
                const extra = Number(pricingConfig.packageTypeSurcharges?.[t] || 0);
                return (
                  <TouchableOpacity
                    key={t}
                    onPress={() => setPackageType(t)}
                    style={[s.typeChip, { marginRight: 8, marginBottom: 8 }, packageType === t && s.typeChipActive]}
                  >
                    <Text style={[s.typeChipTxt, packageType === t && s.typeChipTxtActive]}>
                      {t}
                      {extra > 0 ? ` · +${extra}` : ""}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={s.fieldLabel}>Pickup Location</Text>
            <TouchableOpacity style={s.locationPicker} onPress={() => setPickerFor("pickup")} activeOpacity={0.85}>
              <MaterialCommunityIcons name="map-marker-up" size={20} color={TEAL} />
              <Text style={[s.locationPickerTxt, !pickup && { color: "#94A3B8" }]} numberOfLines={2}>
                {pickup ? pickup.address : "Choose pickup on map"}
              </Text>
              <MaterialCommunityIcons name="chevron-right" size={20} color="#94A3B8" />
            </TouchableOpacity>
            <TextInput
              style={s.textInput}
              value={pickupDetails}
              onChangeText={setPickupDetails}
              placeholder="Pickup details: building, floor, contact (optional)"
              placeholderTextColor="#94A3B8"
            />

            <Text style={s.fieldLabel}>Delivery Destination</Text>
            <TouchableOpacity style={s.locationPicker} onPress={() => setPickerFor("dropoff")} activeOpacity={0.85}>
              <MaterialCommunityIcons name="map-marker-down" size={20} color={ORANGE} />
              <Text style={[s.locationPickerTxt, !dropoff && { color: "#94A3B8" }]} numberOfLines={2}>
                {dropoff ? dropoff.address : "Choose destination on map"}
              </Text>
              <MaterialCommunityIcons name="chevron-right" size={20} color="#94A3B8" />
            </TouchableOpacity>
            <TextInput
              style={s.textInput}
              value={dropoffDetails}
              onChangeText={setDropoffDetails}
              placeholder="Destination details: building, floor (optional)"
              placeholderTextColor="#94A3B8"
            />

            <Text style={s.fieldLabel}>Recipient Name</Text>
            <TextInput
              style={s.textInput}
              value={recipientName}
              onChangeText={setRecipientName}
              placeholder="Full name"
              placeholderTextColor="#94A3B8"
              maxLength={60}
            />

            <Text style={s.fieldLabel}>Recipient Phone (+251)</Text>
            <TextInput
              style={s.textInput}
              value={recipientPhone}
              onChangeText={setRecipientPhone}
              keyboardType="phone-pad"
              placeholder="09XXXXXXXX"
              placeholderTextColor="#94A3B8"
              maxLength={13}
            />

            <Text style={s.fieldLabel}>Special Notes (Optional)</Text>
            <TextInput
              style={[s.textInput, { height: 60, textAlignVertical: "top" }]}
              value={packageNotes}
              onChangeText={setPackageNotes}
              multiline
              maxLength={300}
              placeholder="What's inside, handling or delivery instructions"
              placeholderTextColor="#94A3B8"
            />

            <View style={s.fareBox}>
              <View style={s.fareRow}>
                <Text style={s.fareLabel}>Base pickup fee</Text>
                <Text style={s.fareVal}>ETB {packageQuote.baseFee}</Text>
              </View>
              <View style={s.fareRow}>
                <Text style={s.fareLabel}>
                  Distance{packageQuote.hasDistance ? ` (${packageQuote.distanceKm} km × ${packageQuote.ratePerKm})` : ""}
                </Text>
                <Text style={s.fareVal}>
                  {packageQuote.hasDistance ? `ETB ${packageQuote.distanceCharge}` : "Choose both locations"}
                </Text>
              </View>
              {packageQuote.typeSurcharge > 0 ? (
                <View style={s.fareRow}>
                  <Text style={s.fareLabel}>{packageType}</Text>
                  <Text style={s.fareVal}>ETB {packageQuote.typeSurcharge}</Text>
                </View>
              ) : null}
              {packageQuote.baseFee + packageQuote.distanceCharge < packageQuote.minimumFee ? (
                <Text style={s.fareNote}>* Minimum package fee applies (ETB {packageQuote.minimumFee})</Text>
              ) : null}
              <View style={s.fareRow}>
                <Text style={s.fareLabel}>Delivery fee</Text>
                <Text style={s.fareVal}>ETB {packageQuote.deliveryFee}</Text>
              </View>
              <View style={s.fareRow}>
                <Text style={s.fareLabel}>Service fee</Text>
                <Text style={s.fareVal}>ETB {packageQuote.serviceFee}</Text>
              </View>
              <View style={[s.fareRow, { borderTopWidth: 1, borderTopColor: "#BBF7D0", paddingTop: 8, marginTop: 4 }]}>
                <Text style={{ color: DARK, fontSize: 14, fontWeight: "800" }}>
                  {packageQuote.hasDistance ? "Total" : "Starting from"}
                </Text>
                <Text style={{ fontWeight: "900", color: TEAL, fontSize: 18 }}>
                  ETB {packageQuote.total.toFixed(2)}
                </Text>
              </View>
              {packageQuote.etaMinutes ? (
                <Text style={{ color: "#64748B", fontSize: 11, marginTop: 4 }}>
                  Estimated delivery time: ~{packageQuote.etaMinutes} min · Real-time GPS tracking included
                </Text>
              ) : null}
              {packageTooFar ? (
                <Text style={{ color: "#DC2626", fontSize: 12, marginTop: 6, fontWeight: "700" }}>
                  Package delivery is available up to {MAX_CUSTOMER_ORDER_DISTANCE_KM} km.
                </Text>
              ) : null}
            </View>

            {/* Payment Method Selector */}
            <Text style={[s.fieldLabel, { marginTop: 14 }]}>Payment Method</Text>
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 8 }}>
              <TouchableOpacity
                onPress={() => codAvailable && setPaymentMethod("COD")}
                disabled={!codAvailable}
                style={[
                  s.payMethodCard,
                  paymentMethod === "COD" && s.payMethodCardActive,
                  !codAvailable && { opacity: 0.45 },
                ]}
              >
                <MaterialCommunityIcons
                  name="cash-multiple"
                  size={20}
                  color={paymentMethod === "COD" ? TEAL : "#64748B"}
                />
                <Text
                  style={[
                    s.payMethodTxt,
                    paymentMethod === "COD" && s.payMethodTxtActive,
                  ]}
                >
                  {codAvailable ? "Cash on Delivery" : "Cash · unavailable"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => chapaAvailable && setPaymentMethod("CHAPA")}
                disabled={!chapaAvailable}
                style={[
                  s.payMethodCard,
                  paymentMethod === "CHAPA" && s.payMethodCardActive,
                  !chapaAvailable && { opacity: 0.45 },
                ]}
              >
                <MaterialCommunityIcons
                  name="credit-card-outline"
                  size={20}
                  color={paymentMethod === "CHAPA" ? TEAL : "#64748B"}
                />
                <Text
                  style={[
                    s.payMethodTxt,
                    paymentMethod === "CHAPA" && s.payMethodTxtActive,
                  ]}
                >
                  {chapaAvailable ? "Pay Online (Chapa)" : "Online · unavailable"}
                </Text>
              </TouchableOpacity>
            </View>

            <Button
              title={
                submittingPackage
                  ? "Sending request…"
                  : packageQuote.hasDistance
                  ? `Request Pickup · ETB ${packageQuote.total.toFixed(2)}`
                  : "Request Package Pickup"
              }
              onPress={handleCreatePackageOrder}
              disabled={packageTooFar || submittingPackage || noPaymentMethod}
              loading={submittingPackage}
              style={{ marginTop: 16 }}
            />
          </View>
          <DeliveryLocationModal
            visible={pickerFor != null}
            onClose={() => setPickerFor(null)}
            initialLocation={(pickerFor === "dropoff" ? dropoff || pickup : pickup || dropoff) || undefined}
            onConfirmLocation={(loc) => {
              if (pickerFor === "pickup") setPickup(loc);
              else if (pickerFor === "dropoff") setDropoff(loc);
            }}
          />
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
                    {money(getItemDiscountInfo(selected).customerSellingPrice)}
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
  locationPicker: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
  },
  locationPickerTxt: {
    flex: 1,
    marginHorizontal: 8,
    fontSize: 14,
    color: DARK,
  },
  fareRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  fareLabel: { color: "#64748B", fontSize: 13, flex: 1, marginRight: 8 },
  fareVal: { color: DARK, fontSize: 13, fontWeight: "700" },
  fareNote: { color: "#64748B", fontSize: 11, marginBottom: 4 },
  fareBox: {
    backgroundColor: "#F0FDF4",
    borderWidth: 1,
    borderColor: "#BBF7D0",
    borderRadius: 12,
    padding: 12,
    marginTop: 6,
  },
  payMethodCard: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FAFC",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    gap: 6,
  },
  payMethodCardActive: {
    backgroundColor: "#F0FDFA",
    borderColor: TEAL,
  },
  payMethodTxt: {
    fontSize: 12,
    fontWeight: "700",
    color: "#475569",
  },
  payMethodTxtActive: {
    color: TEAL,
    fontWeight: "800",
  },
});
