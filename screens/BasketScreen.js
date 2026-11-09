import React, { useMemo, useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  ScrollView,
  Alert,
  TextInput,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useNavigation } from "@react-navigation/native";
import { useSelector, useDispatch } from "react-redux";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import {
  PlusIcon,
  MinusIcon,
  TrashIcon,
  MapPinIcon,
  TagIcon,
  ChevronRightIcon,
  MagnifyingGlassIcon,
} from "react-native-heroicons/outline";
import {
  addToBasket,
  removeFromBasket,
  removeMerchantFromBasket,
  clearBasket,
  selectBasketItems,
  selectBasketTotal,
  selectBasketByMerchant,
} from "../features/basketSlice";
import { selectUser, setUser } from "../features/userSlice";
import { UserAuth } from "../contexts/AuthContext";
import { app, db } from "../firebase";
import { getFunctions, httpsCallable } from "firebase/functions";
import { presentLocalNotification } from "../services/notificationService";
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
  onSnapshot,
  updateDoc,
} from "firebase/firestore";
import { notifyMerchant } from "../services/orderNotifications";
import DeliveryLocationModal from "../components/DeliveryLocationModal";
import BackButton from "../components/ui/BackButton";
import { isWithinEthiopia } from "../utils/mapService";
import {
  getItemDiscountInfo,
  calculateDeliveryQuote,
  calculateOrderFinancials,
  FAR_DISTANCE_NOTICE,
  isFarDistance,
} from "../utils/pricing";

const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";
const BG = "#F5FAF9";

const formatETB = (amount) => {
  const num = Number(amount) || 0;
  return `ETB ${num.toFixed(2)}`;
};

// Image component with error fallback — handles Firebase Storage, CDN, and missing URLs
function CartItemImage({ uri, style }) {
  const [errored, setErrored] = useState(false);
  const FALLBACK = "https://placehold.co/100x100/179B83/FFFFFF?text=🍔";
  const src = !errored && uri && uri.startsWith("http") ? uri : FALLBACK;
  return (
    <Image
      source={{ uri: src }}
      style={style}
      resizeMode="cover"
      onError={() => setErrored(true)}
    />
  );
}

export default function BasketScreen() {
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const items = useSelector(selectBasketItems) || [];
  const rawMerchantGroups = useSelector(selectBasketByMerchant) || [];
  const reduxUser = useSelector(selectUser);
  const { user, dbUser } = UserAuth();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [paymentInitializing, setPaymentInitializing] = useState(false); // prevents empty-cart flash
  const [paymentMethod, setPaymentMethod] = useState("CHAPA");
  const [promoCode, setPromoCode] = useState("");
  const [appliedPromo, setAppliedPromo] = useState(null);
  const [promoError, setPromoError] = useState("");
  const [deliveryModalVisible, setDeliveryModalVisible] = useState(false);
  const [cartSearch, setCartSearch] = useState("");
  const [selectedMerchantIds, setSelectedMerchantIds] = useState([]);

  // Payment configuration from Super Admin Settings
  const [paymentConfig, setPaymentConfig] = useState({
    chapaEnabled: true,
    telebirrEnabled: false,
    cbeBirrEnabled: false,
    codEnabled: false,
  });

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "platformSettings", "config"), (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        setPaymentConfig({
          chapaEnabled: d.chapaEnabled !== false,
          telebirrEnabled: d.telebirrEnabled === true,
          cbeBirrEnabled: d.cbeBirrEnabled === true,
          codEnabled: d.codEnabled === true,
        });
      }
    });
    return unsub;
  }, []);

  // Keep the chosen payment method valid when the admin turns a method on/off
  useEffect(() => {
    if (paymentMethod === "CHAPA" && !paymentConfig.chapaEnabled && paymentConfig.codEnabled) setPaymentMethod("COD");
    if (paymentMethod === "COD" && !paymentConfig.codEnabled && paymentConfig.chapaEnabled) setPaymentMethod("CHAPA");
  }, [paymentConfig.chapaEnabled, paymentConfig.codEnabled, paymentMethod]);
  const noPaymentMethod = !paymentConfig.chapaEnabled && !paymentConfig.codEnabled;

  // Initialize selected merchants with all present in cart
  useEffect(() => {
    if (rawMerchantGroups.length > 0) {
      setSelectedMerchantIds((prev) => {
        const currentIds = rawMerchantGroups.map((g) => g.merchantId);
        // Retain previous choices if still valid, or default to select all
        if (prev.length === 0) return currentIds;
        const valid = prev.filter((id) => currentIds.includes(id));
        return valid.length > 0 ? valid : currentIds;
      });
    } else {
      setSelectedMerchantIds([]);
    }
  }, [rawMerchantGroups.length]);

  // ── Authoritative store details ───────────────────────────────────────
  // Basket items only carry the store id; name, address, phone, owner and
  // map location come from the store's own record so the order, delivery fee
  // and driver pickup point are correct.
  const [merchantInfo, setMerchantInfo] = useState({});
  const merchantKey = rawMerchantGroups.map((g) => `${g.sellerType}:${g.merchantId}`).join("|");
  useEffect(() => {
    let alive = true;
    const missing = rawMerchantGroups.filter((g) => !merchantInfo[g.merchantId]);
    if (missing.length === 0) return undefined;
    (async () => {
      const found = {};
      await Promise.all(
        missing.map(async (g) => {
          const lookIn = g.sellerType === "shop" ? ["shops", "restaurants"] : ["restaurants", "shops"];
          for (const col of lookIn) {
            try {
              const snap = await getDoc(doc(db, col, String(g.merchantId)));
              if (snap.exists()) {
                found[g.merchantId] = { ...snap.data(), _collection: col };
                return;
              }
            } catch (_) {}
          }
          found[g.merchantId] = { _missing: true };
        })
      );
      if (alive) setMerchantInfo((prev) => ({ ...prev, ...found }));
    })();
    return () => {
      alive = false;
    };
  }, [merchantKey]);

  const resolveGroup = (g) => {
    const m = merchantInfo[g.merchantId];
    if (!m || m._missing) return { ...g, hasStoreLocation: false };
    const lat = Number(m.latitude ?? m.lat ?? m.location?.latitude);
    const lng = Number(m.longitude ?? m.lng ?? m.location?.longitude);
    const hasStoreLocation = Number.isFinite(lat) && Number.isFinite(lng) && isWithinEthiopia(lat, lng);
    return {
      ...g,
      merchantName: m.name || m.businessName || g.merchantName,
      merchantAddress: m.address || g.merchantAddress,
      merchantPhone: m.phone || m.phoneNumber || g.merchantPhone,
      merchantCity: m.city || g.merchantCity,
      merchantLat: hasStoreLocation ? lat : g.merchantLat,
      merchantLng: hasStoreLocation ? lng : g.merchantLng,
      merchantOwnerUid: m.ownerUid || null,
      merchantImage: m.image || m.logoUrl || null,
      sellerType: m._collection === "shops" ? "shop" : g.sellerType,
      hasStoreLocation,
    };
  };
  const resolvedMerchantGroups = useMemo(
    () => rawMerchantGroups.map(resolveGroup),
    [rawMerchantGroups, merchantInfo]
  );

  // Address
  const currentAddress =
    reduxUser?.address || dbUser?.address || "My Location, Ethiopia";
  const currentCoords = {
    latitude:
      reduxUser?.latitude && isWithinEthiopia(reduxUser.latitude, reduxUser.longitude)
        ? reduxUser.latitude
        : dbUser?.latitude && isWithinEthiopia(dbUser.latitude, dbUser.longitude)
        ? dbUser.latitude
        : 8.9806,
    longitude:
      reduxUser?.longitude && isWithinEthiopia(reduxUser.latitude, reduxUser.longitude)
        ? reduxUser.longitude
        : dbUser?.longitude && isWithinEthiopia(dbUser.latitude, dbUser.longitude)
        ? dbUser.longitude
        : 38.7578,
  };

  // A real delivery location must be chosen; the fallback above is only for display
  // New accounts are saved with a default Bole point (8.9806, 38.7578); that isn't a real choice.
  const isRealPoint = (lat, lng) =>
    Boolean(lat) && isWithinEthiopia(lat, lng) && !(Number(lat) === 8.9806 && Number(lng) === 38.7578);
  const hasDeliveryLocation =
    isRealPoint(reduxUser?.latitude, reduxUser?.longitude) || isRealPoint(dbUser?.latitude, dbUser?.longitude);

  // Filter merchant groups and items by search query
  const merchantGroups = useMemo(() => {
    const q = cartSearch.trim().toLowerCase();
    if (!q) return resolvedMerchantGroups;
    return resolvedMerchantGroups
      .map((group) => {
        const matchesMerchant = group.merchantName.toLowerCase().includes(q);
        const matchedItems = group.items.filter((it) =>
          it.name?.toLowerCase().includes(q)
        );
        if (matchesMerchant) return group;
        if (matchedItems.length > 0) {
          const subtotal = matchedItems.reduce(
            (sum, it) => sum + Number(it.price || 0),
            0
          );
          return { ...group, items: matchedItems, subtotal };
        }
        return null;
      })
      .filter(Boolean);
  }, [resolvedMerchantGroups, cartSearch]);

  // Selected groups calculation
  const selectedGroups = useMemo(() => {
    return resolvedMerchantGroups.filter((g) =>
      selectedMerchantIds.includes(g.merchantId)
    );
  }, [resolvedMerchantGroups, selectedMerchantIds]);

  const selectedSubtotal = useMemo(() => {
    return selectedGroups.reduce((sum, g) => sum + g.subtotal, 0);
  }, [selectedGroups]);

  // Authoritative delivery and service fees — 25 ETB/km, minimum 50 ETB
  const deliveryQuotes = selectedGroups.map((g) =>
    calculateDeliveryQuote(
      { latitude: g.merchantLat, longitude: g.merchantLng, city: g.merchantCity },
      { latitude: currentCoords?.latitude, longitude: currentCoords?.longitude }
    )
  );

  const deliveryFee = deliveryQuotes.reduce((acc, q) => acc + (q.deliveryFee || 50), 0) || (selectedGroups.length * 50);
  const totalDistanceKm = deliveryQuotes.reduce((acc, q) => acc + (q.distanceKm || 2), 0);

  // Each store becomes its own order, and each order carries the 15 ETB service fee
  const serviceFee = 15 * selectedGroups.length;

  const discountAmount = useMemo(() => {
    if (!appliedPromo) return 0;
    if (appliedPromo.type === "percent") {
      return (selectedSubtotal * appliedPromo.value) / 100;
    }
    if (appliedPromo.type === "fixed") {
      return Math.min(selectedSubtotal, appliedPromo.value);
    }
    return 0;
  }, [appliedPromo, selectedSubtotal]);

  const merchantDiscountSavings = useMemo(() => {
    let savings = 0;
    for (const g of selectedGroups) {
      for (const it of (g.items || [])) {
        // Basket items already hold customer prices — don't run them through the markup again
        const sell = Number(it.price || 0);
        savings += Math.max(0, Number(it.originalPrice || sell) - sell);
      }
    }
    return Number(savings.toFixed(2));
  }, [selectedGroups]);


  const finalPayable = Math.max(
    0,
    selectedSubtotal + deliveryFee + serviceFee - discountAmount
  );

  const toggleMerchantSelection = (merchantId) => {
    setSelectedMerchantIds((prev) =>
      prev.includes(merchantId)
        ? prev.filter((id) => id !== merchantId)
        : [...prev, merchantId]
    );
  };

  const handleSelectAll = () => {
    setSelectedMerchantIds(rawMerchantGroups.map((g) => g.merchantId));
  };

  const handleDeselectAll = () => {
    setSelectedMerchantIds([]);
  };

  const handleApplyPromo = () => {
    setPromoError("");
    const clean = promoCode.trim().toUpperCase();
    if (!clean) return;

    if (clean === "MYTRUCK20") {
      setAppliedPromo({ code: "MYTRUCK20", type: "percent", value: 20 });
    } else if (clean === "WELCOME" || clean === "WELCOME50") {
      setAppliedPromo({ code: clean, type: "fixed", value: 50 });
    } else if (clean === "FREESHIP") {
      setAppliedPromo({ code: "FREESHIP", type: "fixed", value: deliveryFee });
    } else {
      setPromoError("Invalid promo code. Try 'MYTRUCK20' or 'WELCOME'");
    }
  };

  const handleClearBasketConfirm = () => {
    Alert.alert(
      "Clear Cart",
      "Are you sure you want to remove all items from your cart?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear Cart",
          style: "destructive",
          onPress: () => {
            dispatch(clearBasket());
            setAppliedPromo(null);
          },
        },
      ]
    );
  };

  const handleConfirmLocation = (loc) => {
    dispatch(
      setUser({
        ...(reduxUser || {}),
        address: loc.address,
        latitude: loc.latitude,
        longitude: loc.longitude,
      })
    );
  };

  // Group items inside a single merchant
  const groupItemsInMerchant = (itemsList) => {
    const map = {};
    for (const item of (itemsList || [])) {
      if (!item || !item.id) continue;
      if (!map[item.id]) {
        map[item.id] = { item, quantity: 0, totalPrice: 0 };
      }
      map[item.id].quantity += 1;
      map[item.id].totalPrice += Number(item.price || 0);
    }
    return map ? Object.values(map) : [];
  };

  // Price each store's order. Basket prices are already customer prices
  // (merchant price + platform markup), so nothing is marked up again here.
  const buildOrderPlans = () => {
    const groups = selectedGroups.map((group) => {
      const dishes = groupItemsInMerchant(group.items);
      let origSubtotal = 0;
      let sellSubtotal = 0;
      let baseSubtotal = 0;
      let merchantDiscount = 0;
      for (const gd of dishes) {
        const sell = Number(gd.item.price || gd.item.discountedPrice || 0);
        const orig = Math.max(sell, Number(gd.item.originalPrice || sell));
        const base = Number(gd.item.merchantBasePrice != null ? gd.item.merchantBasePrice : sell);
        origSubtotal += orig * gd.quantity;
        sellSubtotal += sell * gd.quantity;
        baseSubtotal += base * gd.quantity;
        merchantDiscount += (orig - sell) * gd.quantity;
      }
      const quote = calculateDeliveryQuote(
        { latitude: group.merchantLat, longitude: group.merchantLng, city: group.merchantCity },
        { latitude: currentCoords?.latitude, longitude: currentCoords?.longitude }
      );
      return { group, dishes, quote, origSubtotal, sellSubtotal, baseSubtotal, merchantDiscount };
    });

    // Spread the promo discount across the store orders (FREESHIP by delivery fee, others by items)
    const promoTotal = Number((discountAmount || 0).toFixed(2));
    const weightOf = (g) => (appliedPromo?.code === "FREESHIP" ? g.quote.deliveryFee || 50 : g.sellSubtotal);
    const weightSum = groups.reduce((sum, g) => sum + weightOf(g), 0) || 1;
    let allocated = 0;
    return groups.map((g, i) => {
      const share =
        i === groups.length - 1
          ? Number((promoTotal - allocated).toFixed(2))
          : Number(((promoTotal * weightOf(g)) / weightSum).toFixed(2));
      allocated += share;
      const fin = calculateOrderFinancials({
        subtotal: Number(g.sellSubtotal.toFixed(2)),
        deliveryFee: g.quote.deliveryFee || 50,
        serviceFee: 15,
        deliveryCommissionPercent: 20,
        merchantBaseSubtotal: Number(g.baseSubtotal.toFixed(2)),
        promoDiscount: share,
      });
      return { ...g, fin };
    });
  };

  const writeOrders = async (plans, chapa) => {
    const batch = writeBatch(db);
    const created = [];
    const custFullName = String(dbUser?.fullName || user.displayName || "Customer").trim();
    const custPhone = String(dbUser?.phoneNumber || user.phoneNumber || "").trim();
    const nameParts = custFullName.split(" ");

    for (const pl of plans) {
      const { group, fin, quote } = pl;
      const orderRef = doc(collection(db, "orders"));
      const orderId = orderRef.id;
      const pickup = {
        latitude: Number(group.merchantLat || 8.992),
        longitude: Number(group.merchantLng || 38.752),
      };
      const pickupAddress = group.merchantAddress || group.merchantName || "Ethiopia";

      const order = {
        orderId,
        userId: user.uid,
        customerName: custFullName,
        customerPhone: custPhone,
        userPhoneNumber: custPhone,
        phone: custPhone,
        userFirstName: nameParts[0] || "Customer",
        userLastName: nameParts.slice(1).join(" ") || "",
        userAddress: currentAddress,
        customerEmail: user.email || dbUser?.email || "",
        restaurantId: group.merchantId,
        merchantId: group.merchantId,
        ...(group.sellerType === "shop" ? { shopId: group.merchantId } : {}),
        merchantOwnerUid: group.merchantOwnerUid || null,
        restaurantName: group.merchantName,
        restaurantImage: group.merchantImage || null,
        restaurantAddress: pickupAddress,
        restaurantPhone: group.merchantPhone || "",
        restaurantLat: pickup.latitude,
        restaurantLng: pickup.longitude,
        pickupAddress,
        pickupCoords: pickup,
        pickupLocationVerified: Boolean(group.hasStoreLocation),
        sellerType: group.sellerType || "restaurant",
        deliveryAddress: currentAddress,
        dropoffAddress: currentAddress,
        deliveryCoords: currentCoords,
        dropoffCoords: currentCoords,
        deliveryLat: Number(currentCoords.latitude),
        deliveryLng: Number(currentCoords.longitude),
        deliveryDistanceKm: quote.distanceKm,
        deliveryEtaMinutes: quote.etaMinutes,
        isIntercity: quote.isIntercity,
        // AWAITING_PAYMENT orders are not forwarded to the store until Chapa confirms payment
        status: chapa ? "AWAITING_PAYMENT" : "PENDING",
        paymentMethod,
        paymentStatus: chapa ? "UNPAID" : "PENDING",
        ...(chapa
          ? {
              paymentInitiatedAt: serverTimestamp(),
              chapaMerchantReference: chapa.txRef,
              chapaCheckoutUrl: chapa.checkoutUrl,
            }
          : {}),
        subtotal: fin.subtotal,
        originalSubtotal: Number(pl.origSubtotal.toFixed(2)),
        discountedSubtotal: fin.subtotal,
        merchantBaseSubtotal: Number(pl.baseSubtotal.toFixed(2)),
        platformItemMarkup: fin.platformItemMarkup,
        totalDiscountAmount: Number(pl.merchantDiscount.toFixed(2)),
        hasMerchantDiscount: pl.merchantDiscount > 0,
        promoCode: fin.promoDiscount > 0 ? appliedPromo?.code || null : null,
        promoDiscount: fin.promoDiscount,
        customerSavings: Number((pl.merchantDiscount + fin.promoDiscount).toFixed(2)),
        deliveryFee: fin.deliveryFee,
        serviceFee: fin.serviceFee,
        total: fin.total,
        currency: "ETB",
        restaurantEarnings: fin.restaurantEarnings,
        deliveryCommissionPercent: fin.deliveryCommissionPercent,
        deliveryCommission: fin.deliveryCommission,
        companyProfit: fin.companyProfit,
        driverEarnings: fin.driverEarnings,
        totalOwedOut: fin.totalOwedOut,
        deliveryOtp: String(Math.floor(1000 + Math.random() * 9000)),
        itemsCount: group.items.length,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      batch.set(orderRef, order);

      for (const gd of pl.dishes) {
        const sell = Number(gd.item.price || gd.item.discountedPrice || 0);
        const orig = Math.max(sell, Number(gd.item.originalPrice || sell));
        const base = Number(gd.item.merchantBasePrice != null ? gd.item.merchantBasePrice : sell);
        batch.set(doc(collection(db, "orderDishes")), {
          orderId,
          restaurantId: group.merchantId,
          dishId: gd.item.dishId || gd.item.id,
          name: gd.item.name || "Item",
          price: sell,
          merchantBasePrice: base,
          originalPrice: orig,
          discountedPrice: sell,
          hasDiscount: orig > sell,
          discountPercent: orig > 0 ? Math.round(((orig - sell) / orig) * 100) : 0,
          unitDiscount: Number((orig - sell).toFixed(2)),
          quantity: gd.quantity,
          totalPrice: Number((sell * gd.quantity).toFixed(2)),
          totalOriginalPrice: Number((orig * gd.quantity).toFixed(2)),
          specialInstructions: gd.item.specialInstructions || "",
          image: gd.item.image || gd.item.imgUrl || gd.item.photo || "",
          createdAt: serverTimestamp(),
        });
      }
      created.push({ id: orderId, ...order });
    }

    await batch.commit();
    return created;
  };

  // Multi-merchant Grouped Checkout
  const handlePlaceOrder = async () => {
    if (!user?.uid) {
      Alert.alert(
        "Sign In Required",
        "Please sign in or create an account to place your order."
      );
      return;
    }
    if (selectedGroups.length === 0) {
      Alert.alert(
        "No Orders Selected",
        "Please select at least one restaurant or shop order to purchase."
      );
      return;
    }
    if (isSubmitting || paymentInitializing) return;
    if (noPaymentMethod) {
      Alert.alert("Checkout Unavailable", "Online payment and Cash on Delivery are both turned off right now. Please try again later.");
      return;
    }

    if (!hasDeliveryLocation) {
      Alert.alert(
        "Set Delivery Location",
        "Choose where we should deliver your order before checking out.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Set Location", onPress: () => setDeliveryModalVisible(true) },
        ]
      );
      return;
    }

    // ─── STEP 0: Enforce maximum delivery distance ─────────────────────────
    for (const group of selectedGroups) {
      const quote = calculateDeliveryQuote(
        { latitude: group.merchantLat, longitude: group.merchantLng, city: group.merchantCity },
        { latitude: currentCoords?.latitude, longitude: currentCoords?.longitude }
      );
      if (quote.distanceKm > 15) {
        Alert.alert("Far Delivery Distance", FAR_DISTANCE_NOTICE);
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const plans = buildOrderPlans();
      const grandTotal = Number(plans.reduce((sum, pl) => sum + pl.fin.total, 0).toFixed(2));
      let chapa = null;

      // ─── STEP 1: For CHAPA – initialize payment FIRST (before creating orders) ──
      if (paymentMethod === "CHAPA") {
        setPaymentInitializing(true); // blocks empty-cart flash

        const txRef = `MT${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
        const rawPhone = String(dbUser?.phoneNumber || user?.phoneNumber || "").replace(/\D/g, "");
        const cleanPhone10 = rawPhone.startsWith("251")
          ? "0" + rawPhone.slice(3)
          : rawPhone.startsWith("0") ? rawPhone : "0" + rawPhone;
        let chapaEmail = String(user?.email || dbUser?.email || "").trim().toLowerCase();
        if (!chapaEmail || !chapaEmail.includes("@") || chapaEmail.endsWith(".local") || chapaEmail.endsWith(".et")) {
          chapaEmail = cleanPhone10.length >= 9 ? `customer${cleanPhone10}@gmail.com` : "customer@gmail.com";
        }

        let checkoutUrl = null;
        try {
          // Chapa is initialized server-side (functions/index.js) so the secret key never ships in the app.
          const startCheckout = httpsCallable(getFunctions(app), "createChapaCheckout");
          const fullName = String(dbUser?.fullName || user?.displayName || "Customer User");
          const res = await startCheckout({
            amount: grandTotal,
            txRef,
            email: chapaEmail,
            firstName: fullName.split(" ")[0] || "Customer",
            lastName: fullName.split(" ").slice(1).join(" ") || "Client",
            phone: cleanPhone10,
            description: `Payment for ${plans.map((pl) => pl.group.merchantName).join(", ")}`,
            returnUrl: "https://checkout.chapa.co/checkout/payment-receipt",
          });
          checkoutUrl = res?.data?.checkoutUrl;
        } catch (initErr) {
          console.warn("Chapa init error:", initErr?.message);
        }

        if (!checkoutUrl) {
          setPaymentInitializing(false);
          setIsSubmitting(false);
          Alert.alert(
            "Payment Unavailable",
            "Online payment could not be started. Please try again, or choose Cash on Delivery if it is available.",
            [{ text: "Retry", onPress: handlePlaceOrder }, { text: "Cancel", style: "cancel" }]
          );
          return;
        }
        chapa = { txRef, checkoutUrl };
      }

      // ─── STEP 2: Create one order per store (AWAITING_PAYMENT for Chapa, PENDING for COD) ──
      const created = await writeOrders(plans, chapa);
      const createdOrderIds = created.map((o) => o.id);

      if (chapa) {
        navigation.replace("PreparingOrderScreen", {
          orderId: createdOrderIds[0],
          orderIds: createdOrderIds,
          paymentPending: true,
          autoLaunchChapa: true,
          initialCheckoutUrl: chapa.checkoutUrl,
          txRef: chapa.txRef,
        });
      } else {
        // COD orders go to the store immediately
        created.forEach((o) =>
          notifyMerchant(o, "New Order 🛎️", `${o.itemsCount} item(s) · ETB ${Number(o.total).toFixed(2)} · Cash on Delivery`)
        );
        presentLocalNotification({
          title: "Order Placed! 🍔",
          body: `Order #${String(createdOrderIds[0]).slice(0, 8).toUpperCase()} submitted – Cash on Delivery.`,
          data: { orderId: createdOrderIds[0], targetRoute: "TrackOrder" },
          category: "orders",
        }).catch(() => {});
        navigation.replace("PreparingOrderScreen", {
          orderId: createdOrderIds[0],
          orderIds: createdOrderIds,
        });
      }

      // ─── STEP 3: Clear basket AFTER navigation to prevent empty-cart flash ──
      setTimeout(() => {
        for (const group of selectedGroups) {
          dispatch(removeMerchantFromBasket(group.merchantId));
        }
      }, 800);
      setPaymentInitializing(false);
    } catch (error) {
      console.error("Order submission failure:", error);
      setPaymentInitializing(false);
      Alert.alert(
        "Could Not Place Order",
        error.message || "Please check your network connection and try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const allSelected =
    rawMerchantGroups.length > 0 &&
    selectedMerchantIds.length === rawMerchantGroups.length;

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <StatusBar style="light" backgroundColor={TEAL} />

      {/* Header */}
      <View style={s.header}>
        <BackButton fallbackRoute="HomeTab" iconColor="white" />
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>Shopping Cart</Text>
          <Text style={s.headerSub}>
            {rawMerchantGroups.length > 1
              ? `${rawMerchantGroups.length} Merchant Orders`
              : rawMerchantGroups[0]?.merchantName || "MyTruck Delivery"}
          </Text>
        </View>
        {items.length > 0 ? (
          <TouchableOpacity
            onPress={handleClearBasketConfirm}
            style={s.clearBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.8}
            accessibilityLabel="Clear cart"
          >
            <MaterialCommunityIcons name="trash-can-outline" size={15} color="white" style={{ marginRight: 4 }} />
            <Text style={s.clearBtnTxt}>Clear</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      {items.length === 0 ? (
        /* Empty Cart State — only show if not in payment-init flow */
        paymentInitializing ? (
          <View style={s.emptyContainer}>
            <ActivityIndicator size="large" color={TEAL} />
            <Text style={[s.emptyTitle, { marginTop: 20, fontSize: 16 }]}>Preparing your secure payment...</Text>
            <Text style={s.emptySub}>Please wait while we initialize your checkout session.</Text>
          </View>
        ) : (
        <View style={s.emptyContainer}>
          <View style={s.emptyIconCircle}>
            <MaterialCommunityIcons name="cart-outline" size={60} color="#94A3B8" />
          </View>
          <Text style={s.emptyTitle}>Your cart is empty</Text>
          <Text style={s.emptySub}>
            Discover delicious meals, fresh groceries, and fast deliveries around you.
          </Text>
          <TouchableOpacity
            style={s.browseBtn}
            activeOpacity={0.88}
            onPress={() => navigation.navigate("Restaurants")}
          >
            <Text style={s.browseBtnTxt}>Explore Restaurants</Text>
          </TouchableOpacity>
        </View>
        )
      ) : (
        /* Active Cart Content */
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Cart Item Search */}
          <View style={s.searchWrap}>
            <MagnifyingGlassIcon size={18} color="#64748B" />
            <TextInput
              style={s.searchInput}
              placeholder="Search items or stores in your cart..."
              placeholderTextColor="#94A3B8"
              value={cartSearch}
              onChangeText={setCartSearch}
            />
            {cartSearch ? (
              <TouchableOpacity onPress={() => setCartSearch("")}>
                <MaterialCommunityIcons name="close-circle" size={16} color="#94A3B8" />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Selection Controls (Phase 8.3) */}
          {rawMerchantGroups.length > 1 && (
            <View style={s.selectionBar}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={s.selectionLabel}>
                  {selectedMerchantIds.length} of {rawMerchantGroups.length} orders selected
                </Text>
              </View>
              <TouchableOpacity
                onPress={allSelected ? handleDeselectAll : handleSelectAll}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Text style={s.toggleAllTxt}>
                  {allSelected ? "Deselect All" : "Select All"}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Multi-Restaurant Groups List (Phase 7 & 8) */}
          {merchantGroups.map((group) => {
            const isSelected = selectedMerchantIds.includes(group.merchantId);
            const dishesInGroup = groupItemsInMerchant(group.items);

            return (
              <View
                key={group.merchantId}
                style={[
                  s.merchantCard,
                  isSelected ? s.merchantCardSelected : s.merchantCardUnselected,
                ]}
              >
                {/* Merchant Card Header */}
                <View style={s.merchantHeader}>
                  <TouchableOpacity
                    style={s.checkboxRow}
                    activeOpacity={0.8}
                    onPress={() => toggleMerchantSelection(group.merchantId)}
                  >
                    <MaterialCommunityIcons
                      name={isSelected ? "checkbox-marked" : "checkbox-blank-outline"}
                      size={22}
                      color={isSelected ? TEAL : "#94A3B8"}
                    />
                    <View style={{ marginLeft: 8 }}>
                      <Text style={s.merchantTitle} numberOfLines={1}>
                        {group.merchantName}
                      </Text>
                      <Text style={s.merchantSub}>
                        {group.sellerType === "shop" ? "Supermarket & Shop" : "Restaurant"} · {group.items.length} items
                      </Text>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => dispatch(removeMerchantFromBasket(group.merchantId))}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <TrashIcon size={16} color="#94A3B8" />
                  </TouchableOpacity>
                </View>

                {(() => {
                  const gQuote = calculateDeliveryQuote(
                    { latitude: group.merchantLat, longitude: group.merchantLng },
                    { latitude: currentCoords?.latitude, longitude: currentCoords?.longitude }
                  );
                  if (gQuote.distanceKm > 15) {
                    return (
                      <View
                        style={{
                          backgroundColor: "#FEF2F2",
                          borderColor: "#FECACA",
                          borderWidth: 1,
                          borderRadius: 8,
                          padding: 8,
                          marginHorizontal: 12,
                          marginBottom: 10,
                          flexDirection: "row",
                          alignItems: "center",
                        }}
                      >
                        <MaterialCommunityIcons name="alert-circle-outline" size={18} color="#DC2626" />
                        <Text style={{ fontSize: 11.5, color: "#991B1B", fontWeight: "600", marginLeft: 6, flex: 1 }}>
                          {FAR_DISTANCE_NOTICE} ({gQuote.distanceKm} km)
                        </Text>
                      </View>
                    );
                  }
                  return null;
                })()}

                {/* Items in this merchant */}
                <View style={s.itemsContainer}>
                  {dishesInGroup.map((gd, idx) => (
                    <View
                      key={gd.item.id || idx}
                      style={[
                        s.itemRow,
                        idx !== dishesInGroup.length - 1 && s.itemDivider,
                      ]}
                    >
                      <CartItemImage
                        uri={gd.item.image || gd.item.imgUrl || gd.item.photo || gd.item.imageUrl || ""}
                        style={s.itemImg}
                      />
                      <View style={s.itemInfo}>
                        <Text style={s.itemName} numberOfLines={1}>
                          {gd.item.name}
                        </Text>
                        {(() => {
                          const sell = Number(gd.item.price || 0);
                          const orig = Math.max(sell, Number(gd.item.originalPrice || sell));
                          const info = {
                            customerSellingPrice: sell,
                            customerOriginalPrice: orig,
                            discountPercent: orig > 0 ? Math.round(((orig - sell) / orig) * 100) : 0,
                          };
                          if (orig <= sell) {
                            return <Text style={s.itemUnitPrice}>{formatETB(sell)}</Text>;
                          }
                          return (
                            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
                              <Text style={[s.itemUnitPrice, { color: "#E11D48", fontWeight: "700" }]}>
                                {formatETB(info.customerSellingPrice)}
                              </Text>
                              <Text style={{ fontSize: 11, color: "#94A3B8", textDecorationLine: "line-through" }}>
                                {formatETB(info.customerOriginalPrice)}
                              </Text>
                              <View style={{ backgroundColor: "#FEE2E2", paddingHorizontal: 3, paddingVertical: 1, borderRadius: 2 }}>
                                <Text style={{ fontSize: 9, fontWeight: "800", color: "#E11D48" }}>
                                  -{String(info.discountPercent ?? 0)}%
                                </Text>
                              </View>
                            </View>
                          );
                        })()}
                        <Text style={s.itemTotalPrice}>
                          {formatETB(gd.totalPrice)}
                        </Text>

                      </View>

                      {/* Quantity manipulation */}
                      <View style={s.qtyControls}>
                        <TouchableOpacity
                          style={s.qtyBtn}
                          onPress={() => dispatch(removeFromBasket({ id: gd.item.id }))}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <MinusIcon size={13} color={TEAL} />
                        </TouchableOpacity>

                        <Text style={s.qtyTxt}>{gd.quantity}</Text>

                        <TouchableOpacity
                          style={s.qtyBtn}
                          onPress={() => dispatch(addToBasket(gd.item))}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <PlusIcon size={13} color={TEAL} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                </View>

                {/* Group Subtotal & Estimated Delivery Fee */}
                <View style={s.groupFooter}>
                  <View style={s.groupFooterRow}>
                    <Text style={s.groupFooterLabel}>Order Subtotal</Text>
                    <Text style={s.groupFooterVal}>{formatETB(group.subtotal)}</Text>
                  </View>
                  <View style={s.groupFooterRow}>
                    <Text style={s.groupFooterLabel}>Delivery Fee</Text>
                    <Text style={s.groupFooterVal}>ETB 50.00</Text>
                  </View>
                </View>
              </View>
            );
          })}

          {/* Delivery Address Card */}
          <View style={s.sectionCard}>
            <View style={s.cardHeaderRow}>
              <Text style={s.sectionHeading}>Deliver To</Text>
              <TouchableOpacity
                onPress={() => setDeliveryModalVisible(true)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Text style={s.changeLink}>Change</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={s.addressRow}
              activeOpacity={0.8}
              onPress={() => setDeliveryModalVisible(true)}
            >
              <View style={s.addressIconWrap}>
                <MapPinIcon size={20} color={TEAL} />
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={s.addressTitle}>{currentAddress}</Text>
                <Text style={s.addressSub}>Tap to change or adjust pin on map</Text>
              </View>
              <ChevronRightIcon size={18} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {/* Promo Code Card */}
          <View style={s.sectionCard}>
            <Text style={s.sectionHeading}>Promotions & Coupons</Text>
            {appliedPromo ? (
              <View style={s.appliedPromoCard}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <TagIcon size={18} color="#166534" />
                  <Text style={s.appliedPromoTxt}>Code "{appliedPromo.code}" applied</Text>
                </View>
                <TouchableOpacity onPress={() => setAppliedPromo(null)}>
                  <Text style={s.removePromoTxt}>Remove</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={s.promoInputRow}>
                <TextInput
                  style={s.promoInput}
                  placeholder="Enter code (e.g. MYTRUCK20)"
                  placeholderTextColor="#94A3B8"
                  value={promoCode}
                  onChangeText={(t) => { setPromoCode(t); setPromoError(""); }}
                  autoCapitalize="characters"
                />
                <TouchableOpacity
                  style={[s.promoApplyBtn, !promoCode.trim() && { opacity: 0.5 }]}
                  onPress={handleApplyPromo}
                  disabled={!promoCode.trim()}
                >
                  <Text style={s.promoApplyBtnTxt}>Apply</Text>
                </TouchableOpacity>
              </View>
            )}
            {promoError ? <Text style={s.promoErrorTxt}>{promoError}</Text> : null}
          </View>

          {/* Payment Method Selector — options follow the admin's platform settings */}
          <View style={s.sectionCard}>
            <Text style={s.sectionHeading}>Payment Method</Text>

            {paymentConfig.chapaEnabled && (
              <TouchableOpacity
                style={[s.paymentOption, paymentMethod === "CHAPA" && s.paymentOptionActive]}
                onPress={() => setPaymentMethod("CHAPA")}
                activeOpacity={0.85}
                accessibilityRole="radio"
                accessibilityState={{ checked: paymentMethod === "CHAPA" }}
              >
                <MaterialCommunityIcons
                  name={paymentMethod === "CHAPA" ? "radiobox-marked" : "radiobox-blank"}
                  size={22}
                  color={paymentMethod === "CHAPA" ? TEAL : "#94A3B8"}
                />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={s.paymentTitle}>Pay Online with Chapa</Text>
                  <Text style={s.paymentSub}>Telebirr, CBE Birr, Debit / Credit Card</Text>
                </View>
                {paymentMethod === "CHAPA" && (
                  <View style={s.paymentPill}>
                    <Text style={s.paymentPillTxt}>SELECTED</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}

            {paymentConfig.codEnabled && (
              <TouchableOpacity
                style={[s.paymentOption, paymentMethod === "COD" && s.paymentOptionActive, paymentConfig.chapaEnabled && { marginTop: 10 }]}
                onPress={() => setPaymentMethod("COD")}
                activeOpacity={0.85}
                accessibilityRole="radio"
                accessibilityState={{ checked: paymentMethod === "COD" }}
              >
                <MaterialCommunityIcons
                  name={paymentMethod === "COD" ? "radiobox-marked" : "radiobox-blank"}
                  size={22}
                  color={paymentMethod === "COD" ? TEAL : "#94A3B8"}
                />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={s.paymentTitle}>Cash on Delivery</Text>
                  <Text style={s.paymentSub}>Pay the driver in cash when your order arrives</Text>
                </View>
                {paymentMethod === "COD" && (
                  <View style={s.paymentPill}>
                    <Text style={s.paymentPillTxt}>SELECTED</Text>
                  </View>
                )}
              </TouchableOpacity>
            )}

            {noPaymentMethod && (
              <Text style={s.paymentSub}>No payment method is available right now. Please check back shortly.</Text>
            )}
          </View>

          {/* Checkout Summary */}
          <View style={s.sectionCard}>
            <Text style={s.sectionHeading}>Checkout Summary</Text>
            <View style={s.billRow}>
              <Text style={s.billLabel}>Selected Merchants</Text>
              <Text style={s.billVal}>{selectedGroups.length} store(s)</Text>
            </View>
            <View style={s.billRow}>
              <Text style={s.billLabel}>Items Subtotal</Text>
              <Text style={s.billVal}>{formatETB(selectedSubtotal)}</Text>
            </View>

            {/* Transparent distance-based delivery pricing */}
            <View style={s.deliveryBreakdownCard}>
              <View style={s.deliveryBreakdownRow}>
                <MaterialCommunityIcons name="map-marker-distance" size={15} color="#179B83" />
                <Text style={s.deliveryBreakdownLabel}>Delivery Distance</Text>
                <Text style={s.deliveryBreakdownVal}>{totalDistanceKm.toFixed(1)} km</Text>
              </View>
              <View style={s.deliveryBreakdownRow}>
                <MaterialCommunityIcons name="speedometer" size={15} color="#179B83" />
                <Text style={s.deliveryBreakdownLabel}>Rate</Text>
                <Text style={s.deliveryBreakdownVal}>25 ETB / km</Text>
              </View>
              <View style={[s.deliveryBreakdownRow, { borderTopWidth: 0.5, borderTopColor: "#CBD5E1", marginTop: 4, paddingTop: 6 }]}>
                <MaterialCommunityIcons name="truck-fast" size={15} color="#0B2A26" />
                <Text style={[s.deliveryBreakdownLabel, { fontWeight: "700", color: "#0B2A26" }]}>Delivery Fee</Text>
                <Text style={[s.deliveryBreakdownVal, { fontWeight: "700", color: "#0B2A26" }]}>{formatETB(deliveryFee)}</Text>
              </View>
              {totalDistanceKm < 2 && (
                <Text style={s.deliveryMinNote}>* Minimum delivery fee applies (50 ETB)</Text>
              )}
            </View>

            <View style={s.billRow}>
              <Text style={s.billLabel}>Platform Service Fee</Text>
              <Text style={s.billVal}>{formatETB(serviceFee)}</Text>
            </View>
            {discountAmount > 0 ? (
              <View style={s.billRow}>
                <Text style={[s.billLabel, { color: "#166534" }]}>Discount Applied</Text>
                <Text style={[s.billVal, { color: "#166534" }]}>-{formatETB(discountAmount)}</Text>
              </View>
            ) : null}
            {merchantDiscountSavings > 0 ? (
              <View style={s.billRow}>
                <Text style={[s.billLabel, { color: "#E11D48", fontWeight: "600" }]}>Merchant Deals Savings</Text>
                <Text style={[s.billVal, { color: "#E11D48", fontWeight: "700" }]}>-{formatETB(merchantDiscountSavings)}</Text>
              </View>
            ) : null}

            <View style={s.billDivider} />

            <View style={s.billRowTotal}>
              <Text style={s.billTotalLabel}>Total Payable</Text>
              <Text style={s.billTotalVal}>{formatETB(finalPayable)}</Text>
            </View>
          </View>

          {/* Place Order CTA Card */}
          <TouchableOpacity
            style={[
              s.placeOrderBtn,
              (isSubmitting || selectedGroups.length === 0 || noPaymentMethod) && { opacity: 0.75 },
            ]}
            onPress={handlePlaceOrder}
            disabled={isSubmitting || selectedGroups.length === 0 || noPaymentMethod}
            activeOpacity={0.88}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <View style={s.btnContentRow}>
                <Text style={s.placeOrderBtnTxt}>
                  {selectedGroups.length > 1
                    ? `Checkout ${selectedGroups.length} Orders`
                    : paymentMethod === "COD"
                      ? "Place Order · Pay on Delivery"
                      : "Confirm & Pay with Chapa"}
                </Text>
                <Text style={s.placeOrderAmount}>{formatETB(finalPayable)}</Text>
              </View>
            )}
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Location Modal */}
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
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.22)",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  clearBtnTxt: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  emptyIconCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: DARK,
    marginBottom: 8,
  },
  emptySub: {
    fontSize: 13.5,
    color: "#64748B",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
  },
  browseBtn: {
    backgroundColor: TEAL,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
  },
  browseBtnTxt: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 14,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    // Clears the floating customer tab bar so "Place Order" is fully tappable
    paddingBottom: 110,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingHorizontal: 12,
    height: 42,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 13,
    color: DARK,
  },
  selectionBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  selectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748B",
  },
  toggleAllTxt: {
    fontSize: 12,
    fontWeight: "800",
    color: TEAL,
  },
  merchantCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
  },
  merchantCardSelected: {
    borderColor: TEAL,
    backgroundColor: "#FFFFFF",
  },
  merchantCardUnselected: {
    borderColor: "#E2E8F0",
    backgroundColor: "#F8FAFC",
    opacity: 0.7,
  },
  merchantHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  merchantTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: DARK,
  },
  merchantSub: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 1,
  },
  itemsContainer: {
    paddingTop: 8,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  itemDivider: {
    borderBottomWidth: 1,
    borderBottomColor: "#F8FAFC",
  },
  itemImg: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: "#F1F5F9",
  },
  itemInfo: {
    flex: 1,
    marginLeft: 12,
  },
  itemName: {
    fontSize: 13.5,
    fontWeight: "700",
    color: DARK,
  },
  itemUnitPrice: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 1,
  },
  itemTotalPrice: {
    fontSize: 12.5,
    fontWeight: "800",
    color: TEAL,
    marginTop: 2,
  },
  qtyControls: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    borderRadius: 10,
    padding: 4,
  },
  qtyBtn: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  qtyTxt: {
    fontSize: 12,
    fontWeight: "800",
    color: DARK,
    paddingHorizontal: 8,
  },
  groupFooter: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  groupFooterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 3,
  },
  groupFooterLabel: {
    fontSize: 11.5,
    color: "#64748B",
  },
  groupFooterVal: {
    fontSize: 12,
    fontWeight: "700",
    color: DARK,
  },
  sectionCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  sectionHeading: {
    fontSize: 14.5,
    fontWeight: "800",
    color: DARK,
    marginBottom: 12,
  },
  cardHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  changeLink: {
    fontSize: 12,
    fontWeight: "700",
    color: TEAL,
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  addressIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#E6F4F1",
    alignItems: "center",
    justifyContent: "center",
  },
  addressTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: DARK,
  },
  addressSub: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 1,
  },
  promoInputRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  promoInput: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
    fontSize: 13,
    color: DARK,
    fontWeight: "700",
  },
  promoApplyBtn: {
    backgroundColor: TEAL,
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  promoApplyBtnTxt: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 13,
  },
  appliedPromoCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#DCFCE7",
    padding: 12,
    borderRadius: 12,
  },
  appliedPromoTxt: {
    fontSize: 12.5,
    fontWeight: "700",
    color: "#166534",
    marginLeft: 6,
  },
  removePromoTxt: {
    fontSize: 12,
    fontWeight: "800",
    color: "#EF4444",
  },
  promoErrorTxt: {
    fontSize: 11,
    color: "#EF4444",
    marginTop: 6,
    marginLeft: 2,
  },
  paymentOption: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
  },
  paymentOptionActive: {
    borderColor: TEAL,
    backgroundColor: "#F5FAF9",
  },
  paymentTitle: {
    fontSize: 13.5,
    fontWeight: "700",
    color: DARK,
  },
  paymentSub: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
  paymentPill: {
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  paymentPillTxt: {
    fontSize: 10,
    fontWeight: "800",
    color: "#166534",
  },
  billRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  billLabel: {
    fontSize: 12.5,
    color: "#64748B",
  },
  billVal: {
    fontSize: 13,
    fontWeight: "700",
    color: DARK,
  },
  billDivider: {
    height: 1,
    backgroundColor: "#F1F5F9",
    marginVertical: 10,
  },
  // Distance-based delivery pricing breakdown card
  deliveryBreakdownCard: {
    backgroundColor: "#F0FDF9",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#A7F3D0",
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  deliveryBreakdownRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 5,
    gap: 6,
  },
  deliveryBreakdownLabel: {
    flex: 1,
    fontSize: 12.5,
    color: "#0D7A5F",
  },
  deliveryBreakdownVal: {
    fontSize: 13,
    color: "#0D7A5F",
    fontWeight: "600",
  },
  deliveryMinNote: {
    fontSize: 10.5,
    color: "#64748B",
    fontStyle: "italic",
    marginTop: 3,
  },
  billRowTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  billTotalLabel: {
    fontSize: 15,
    fontWeight: "900",
    color: DARK,
  },
  billTotalVal: {
    fontSize: 18,
    fontWeight: "900",
    color: TEAL,
  },
  placeOrderBtn: {
    backgroundColor: TEAL,
    borderRadius: 16,
    paddingVertical: 15,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  btnContentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
  },
  placeOrderBtnTxt: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
  placeOrderAmount: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
});

