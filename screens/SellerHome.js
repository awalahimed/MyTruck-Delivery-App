import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Modal,
  TextInput,
  Switch,
  StyleSheet,
  BackHandler,
  Linking,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useNavigation } from "@react-navigation/native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import * as ImagePicker from "expo-image-picker";
import { UserAuth } from "../contexts/AuthContext";
import { db, storage } from "../firebase";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import {
  collection,
  query,
  where,
  onSnapshot,
  updateDoc,
  doc,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
  addDoc,
  setDoc,
  deleteDoc,
  runTransaction,
  getDoc,
} from "firebase/firestore";
import DeliveryLocationModal from "../components/DeliveryLocationModal";
import { notifyCustomer } from "../services/orderNotifications";
import NotificationBell from "../components/ui/NotificationBell";
import SmartImage from "../components/ui/SmartImage";

const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";
const BG = "#F5FAF9";

const STATUS_CONFIG = {
  PENDING: { label: "Pending", bg: "#FEF9C3", text: "#A16207", actions: ["ACCEPTED", "DECLINED"] },
  // Reassigned by admin after another merchant declined — handled exactly like a new order
  AWAITING_MERCHANT: { label: "Pending", bg: "#FEF9C3", text: "#A16207", actions: ["ACCEPTED", "DECLINED"] },
  ACCEPTED: { label: "Accepted", bg: "#DCFCE7", text: "#166534", actions: ["PREPARING"] },
  PREPARING: { label: "Preparing", bg: "#DBEAFE", text: "#1E40AF", actions: ["READY"] },
  READY: { label: "Ready for Driver", bg: "#E0E7FF", text: "#3730A3", actions: [] },
  DECLINED: { label: "Declined", bg: "#FEE2E2", text: "#991B1B", actions: [] },
  COMPLETE: { label: "Completed", bg: "#D1FAE5", text: "#065F46", actions: [] },
  DRIVERACCEPTED: { label: "Driver Assigned", bg: "#FEF3C7", text: "#B45309", actions: [] },
  DRIVERPICKEDUP: { label: "Out for Delivery", bg: "#E0F2FE", text: "#0369A1", actions: [] },
  CANCELLED: { label: "Cancelled by Customer", bg: "#FEE2E2", text: "#991B1B", actions: [] },
};

const isNewOrder = (o) => o.status === "PENDING" || o.status === "AWAITING_MERCHANT";

const ACTION_LABELS = {
  ACCEPTED: "Accept Order",
  DECLINED: "Decline",
  PREPARING: "Start Preparing",
  READY: "Mark Ready for Pickup",
};

const TABS = [
  { id: "orders", label: "Kitchen Queue", icon: "clipboard-list-outline" },
  { id: "catalog", label: "Menu & Catalog", icon: "food-fork-drink" },
  { id: "analytics", label: "Sales & Insights", icon: "chart-box-outline" },
  { id: "profile", label: "Store Settings", icon: "storefront-outline" },
];

const CATEGORIES = [
  "All",
  "Burgers",
  "Pizza",
  "Ethiopian",
  "Fast Food",
  "Groceries",
  "Drinks",
  "Sides",
  "Desserts",
];

export default function SellerHome() {
  const navigation = useNavigation();
  const { user, dbUser, signOutUser } = UserAuth();

  const [activeTab, setActiveTab] = useState("orders");
  const [orderFilter, setOrderFilter] = useState("ALL"); // ALL, PENDING, PREPARING, READY, COMPLETE
  const [orders, setOrders] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadingMenu, setLoadingMenu] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [salesRange, setSalesRange] = useState("Today");
  const [catalogCategory, setCatalogCategory] = useState("All");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [isOpenForOrders, setIsOpenForOrders] = useState(true);

  // Add/Edit Product Modal State
  const [productModalVisible, setProductModalVisible] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [prodName, setProdName] = useState("");
  const [prodPrice, setProdPrice] = useState("");
  const [prodOriginalPrice, setProdOriginalPrice] = useState("");
  const [hasDiscount, setHasDiscount] = useState(false);
  const [prodDiscountedPrice, setProdDiscountedPrice] = useState("");
  const [discountStartDate, setDiscountStartDate] = useState("");
  const [discountEndDate, setDiscountEndDate] = useState("");
  const [prodCategory, setProdCategory] = useState("Burgers");
  const [prodDesc, setProdDesc] = useState("");
  const [prodImage, setProdImage] = useState("");
  const [prodAvailable, setProdAvailable] = useState(true);
  const [savingProduct, setSavingProduct] = useState(false);

  // Storefront Editable Profile State (Only 3 permitted fields)
  const [storeAddress, setStoreAddress] = useState(dbUser?.address || "");
  // Store map location: used for delivery fees, distance limits and the driver's pickup point
  const [storeCoords, setStoreCoords] = useState(
    dbUser?.storeLatitude && dbUser?.storeLongitude
      ? { latitude: Number(dbUser.storeLatitude), longitude: Number(dbUser.storeLongitude) }
      : null
  );
  const [storeLocationModalVisible, setStoreLocationModalVisible] = useState(false);
  const [storeWorkingHours, setStoreWorkingHours] = useState(dbUser?.workingHours || "08:00 AM - 10:00 PM");
  const [storeLogoUri, setStoreLogoUri] = useState(dbUser?.image || dbUser?.profileImage || "");
  const [savingStorefront, setSavingStorefront] = useState(false);

  // Merchant Rejection Modal State
  const [merchantRejectModalVisible, setMerchantRejectModalVisible] = useState(false);
  const [rejectingOrder, setRejectingOrder] = useState(null);
  const [merchantRejectReason, setMerchantRejectReason] = useState("Item out of stock");
  const [isRejectingBusy, setIsRejectingBusy] = useState(false);

  useEffect(() => {
    if (dbUser?.address) setStoreAddress(dbUser.address);
    if (dbUser?.workingHours) setStoreWorkingHours(dbUser.workingHours);
    if (dbUser?.image || dbUser?.profileImage) setStoreLogoUri(dbUser.image || dbUser.profileImage);
  }, [dbUser]);

  const isShop = dbUser?.role === "shop";
  const merchantId = dbUser?.shopId || (isShop ? (dbUser?.businessName?.toLowerCase().includes("bambis") ? "shop-bambis-supermarket" : (dbUser?.sellerId || user?.uid)) : (dbUser?.restaurantId || dbUser?.sellerId || user?.uid));
  const sellerId = dbUser?.sellerId || merchantId || user?.uid;
  const sellerField = isShop ? "shopId" : "restaurantId";
  const isApproved =
    dbUser?.approvalStatus === "APPROVED" ||
    dbUser?.status === "APPROVED" ||
    dbUser?.isApproved === true;

  useEffect(() => {
    if (!sellerId) return;
    const col = isShop ? "shops" : "restaurants";
    getDoc(doc(db, col, sellerId))
      .then((snap) => {
        const d = snap.exists() ? snap.data() : null;
        const lat = Number(d?.latitude);
        const lng = Number(d?.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0) setStoreCoords({ latitude: lat, longitude: lng });
      })
      .catch(() => {});
  }, [sellerId, isShop]);

  // Intercept hardware back button to prevent app exit
  useEffect(() => {
    const onBackPress = () => {
      if (productModalVisible) {
        setProductModalVisible(false);
        return true;
      }
      if (navigation.canGoBack()) {
        navigation.goBack();
        return true;
      }
      // Dashboard is this role's home: let Android minimise the app (never open customer Home)
      return false;
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", onBackPress);
    return () => sub.remove();
  }, [productModalVisible, navigation]);

  // Real-time menu and catalog items listener
  useEffect(() => {
    if (!sellerId && !user?.uid) return;
    setLoadingMenu(true);
    const unsubMenu = onSnapshot(
      collection(db, "dishes"),
      (snap) => {
        const items = [];
        snap.forEach((d) => {
          const item = { id: d.id, ...d.data() };
          const matches =
            item.restaurantId === sellerId ||
            item.restaurantId === merchantId ||
            item.restaurantId === user?.uid ||
            item.shopId === merchantId ||
            item.shopId === sellerId ||
            item.sellerId === user?.uid ||
            item.ownerUid === user?.uid ||
            (item.restaurantName && dbUser?.businessName && item.restaurantName.toLowerCase().trim() === dbUser.businessName.toLowerCase().trim()) ||
            (item.merchantName && dbUser?.businessName && item.merchantName.toLowerCase().trim() === dbUser.businessName.toLowerCase().trim());
          if (matches) {
            items.push(item);
          }
        });
        setMenuItems(items);
        setLoadingMenu(false);
      },
      (err) => {
        console.warn("SellerHome: menu load error", err?.message);
        setLoadingMenu(false);
      }
    );
    return unsubMenu;
  }, [sellerId, merchantId, user?.uid, dbUser?.businessName]);

  // Real-time orders listener
  useEffect(() => {
    if (!sellerId) {
      setLoadingOrders(false);
      return;
    }
    const storeIds = Array.from(
      new Set([sellerId, merchantId, dbUser?.restaurantId, dbUser?.shopId, user?.uid].filter(Boolean).map(String))
    ).slice(0, 10);
    const q = query(
      collection(db, "orders"),
      where("restaurantId", "in", storeIds),
      limit(100)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const all = [];
        snap.forEach((d) => {
          // Unpaid Chapa orders are not forwarded to the merchant until payment is verified
          if (d.data().status === "AWAITING_PAYMENT") return;
          all.push({ id: d.id, ...d.data() });
        });
        // In-memory sort by createdAt
        all.sort((a, b) => {
          const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
          const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
          return tB - tA;
        });
        setOrders(all);
        setLoadingOrders(false);
      },
      (error) => {
        console.warn("SellerHome: orders listener error", error?.message);
        setLoadingOrders(false);
      }
    );
    return unsub;
  }, [sellerId, merchantId, dbUser?.restaurantId, dbUser?.shopId, user?.uid]);

  // Today's Stats & Authoritative Financial Calculations
  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMillis = today.getTime();

    const todayOrders = orders.filter((o) => {
      const ms = o.createdAt?.toMillis ? o.createdAt.toMillis() : (o.createdAt?.seconds ? o.createdAt.seconds * 1000 : 0);
      return ms >= todayMillis;
    });

    // Net merchant item sales (100% of subtotal/restaurantEarnings goes to the restaurant)
    const todayNetSales = todayOrders
      .filter((o) => o.paymentStatus === "PAID" || o.paymentMethod === "COD" || o.status === "COMPLETE")
      .reduce((sum, o) => {
        const net = Number(o.restaurantEarnings != null ? o.restaurantEarnings : o.subtotal || o.merchantBaseSubtotal || (Number(o.total || 0) > 75 ? Number(o.total) - 75 : 0));
        return sum + net;
      }, 0);

    const pending = orders.filter(isNewOrder).length;
    const preparing = orders.filter((o) => o.status === "PREPARING" || o.status === "ACCEPTED").length;
    const completedOrdersList = orders.filter((o) => o.status === "COMPLETE");
    const completed = completedOrdersList.length;

    // Total lifetime/period balance payable to restaurant: e.g. 20 orders @ 455 = 9,100 ETB
    const balancePayable = completedOrdersList.reduce((sum, o) => {
      const net = Number(o.restaurantEarnings != null ? o.restaurantEarnings : o.subtotal || o.merchantBaseSubtotal || (Number(o.total || 0) > 75 ? Number(o.total) - 75 : 0));
      return sum + net;
    }, 0);

    return {
      todayCount: todayOrders.length,
      revenue: todayNetSales,
      todayNetSales,
      balancePayable,
      pending,
      preparing,
      completed,
      activeProducts: menuItems.filter((i) => i.isAvailable !== false).length,
      totalProducts: menuItems.length,
    };
  }, [orders, menuItems]);

  // Date-range filtered sales for the Sales & Insights tab
  const rangeOrders = useMemo(() => {
    const now = Date.now();
    const getTs = (o) => {
      if (o.createdAt?.toMillis) return o.createdAt.toMillis();
      if (o.createdAt?.seconds) return o.createdAt.seconds * 1000;
      if (typeof o.createdAt === "number") return o.createdAt;
      return 0;
    };
    const completed = orders.filter(
      (o) => o.status === "COMPLETE" || o.paymentStatus === "PAID" || o.paymentMethod === "COD"
    );
    if (salesRange === "Today") {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      return completed.filter((o) => getTs(o) >= start.getTime());
    }
    if (salesRange === "Yesterday") {
      const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
      const startYest = new Date(startToday); startYest.setDate(startYest.getDate() - 1);
      return completed.filter((o) => { const t = getTs(o); return t >= startYest.getTime() && t < startToday.getTime(); });
    }
    if (salesRange === "Last 7 Days") return completed.filter((o) => getTs(o) >= now - 7 * 86400000);
    if (salesRange === "Last 30 Days") return completed.filter((o) => getTs(o) >= now - 30 * 86400000);
    return completed; // All Time
  }, [orders, salesRange]);

  const rangeSalesTotal = useMemo(() => {
    return rangeOrders.reduce((sum, o) => {
      const net = Number(
        o.restaurantEarnings != null
          ? o.restaurantEarnings
          : o.subtotal || o.merchantBaseSubtotal || (Number(o.total || 0) > 75 ? Number(o.total) - 75 : 0)
      );
      return sum + net;
    }, 0);
  }, [rangeOrders]);

  // Filtered Orders for Queue
  const filteredOrders = useMemo(() => {
    if (orderFilter === "ALL") return orders;
    if (orderFilter === "PENDING") return orders.filter(isNewOrder);
    if (orderFilter === "PREPARING") return orders.filter((o) => o.status === "ACCEPTED" || o.status === "PREPARING");
    if (orderFilter === "READY") return orders.filter((o) => o.status === "READY" || o.status === "DRIVERACCEPTED" || o.status === "DRIVERPICKEDUP");
    if (orderFilter === "COMPLETE") return orders.filter((o) => o.status === "COMPLETE");
    return orders;
  }, [orders, orderFilter]);

  // Filtered Catalog
  const filteredCatalog = useMemo(() => {
    return menuItems.filter((item) => {
      const matchCat =
        catalogCategory === "All" ||
        item.category?.toLowerCase() === catalogCategory.toLowerCase() ||
        item.genre?.toLowerCase() === catalogCategory.toLowerCase();
      const matchQuery =
        !catalogSearch ||
        item.name?.toLowerCase().includes(catalogSearch.toLowerCase()) ||
        item.description?.toLowerCase().includes(catalogSearch.toLowerCase());
      return matchCat && matchQuery;
    });
  }, [menuItems, catalogCategory, catalogSearch]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await new Promise((r) => setTimeout(r, 600));
    setRefreshing(false);
  }, []);

  // Order status update
  // Allowed merchant transitions. Checked inside a transaction so a customer
  // cancelling at the same moment can't be overwritten.
  const MERCHANT_TRANSITIONS = {
    ACCEPTED: ["PENDING", "AWAITING_MERCHANT"],
    PREPARING: ["ACCEPTED"],
    READY: ["PREPARING"],
  };

  const updateOrderStatus = async (orderId, newStatus) => {
    try {
      const updated = await runTransaction(db, async (tx) => {
        const ref = doc(db, "orders", orderId);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("This order no longer exists.");
        const current = snap.data();
        if (current.status === "CANCELLED") throw new Error("The customer cancelled this order.");
        const allowedFrom = MERCHANT_TRANSITIONS[newStatus];
        if (allowedFrom && !allowedFrom.includes(current.status)) {
          throw new Error("This order was already updated. Pull to refresh.");
        }
        const updates = { status: newStatus, updatedAt: serverTimestamp() };
        if (newStatus === "ACCEPTED") updates.acceptedAt = serverTimestamp();
        if (newStatus === "PREPARING") {
          updates.preparingAt = serverTimestamp();
          // Starts the driver proximity rings (closest drivers see it first)
          updates.dispatchStartedAt = serverTimestamp();
        }
        if (newStatus === "READY") {
          updates.readyAt = serverTimestamp();
          if (!current.dispatchStartedAt) updates.dispatchStartedAt = serverTimestamp();
          // A driver may already have claimed it while it was cooking
          if (current.driverId) updates.status = "DRIVERACCEPTED";
        }
        tx.update(ref, updates);
        return { id: snap.id, ...current, status: updates.status };
      });
      const messages = {
        ACCEPTED: ["Order Accepted ✅", `${updated.restaurantName || "The store"} accepted your order.`],
        PREPARING: ["Preparing Your Order 👨‍🍳", "Your order is being prepared now."],
        READY: ["Order Ready 📦", "Your order is packed and waiting for a driver."],
        DRIVERACCEPTED: ["Order Ready 📦", "Your order is packed and your driver is on the way to pick it up."],
      };
      const msg = messages[updated.status];
      if (msg) notifyCustomer(updated, msg[0], msg[1]);
    } catch (e) {
      Alert.alert("Update Error", e?.message || "Could not update order status.");
    }
  };

  // Product management actions
  const openAddProduct = () => {
    setEditingProduct(null);
    setProdName("");
    setProdPrice("");
    setProdOriginalPrice("");
    setHasDiscount(false);
    setProdDiscountedPrice("");
    setDiscountStartDate("");
    setDiscountEndDate("");
    setProdCategory(isShop ? "Groceries" : "Burgers");
    setProdDesc("");
    setProdImage("");
    setProdAvailable(true);
    setProductModalVisible(true);
  };

  const openEditProduct = (item) => {
    setEditingProduct(item);
    setProdName(item.name || "");
    const orig = item.originalPrice != null ? item.originalPrice : item.price;
    setProdPrice(String(orig || ""));
    setProdOriginalPrice(String(orig || ""));
    const hasDisc = Boolean(item.hasDiscount && item.discountedPrice && Number(item.discountedPrice) < Number(orig));
    setHasDiscount(hasDisc);
    setProdDiscountedPrice(item.discountedPrice != null ? String(item.discountedPrice) : "");
    setDiscountStartDate(item.discountStartDate || "");
    setDiscountEndDate(item.discountEndDate || "");
    setProdCategory(item.category || item.genre || (isShop ? "Groceries" : "Burgers"));
    setProdDesc(item.description || "");
    setProdImage(item.image || "");
    setProdAvailable(item.isAvailable !== false);
    setProductModalVisible(true);
  };

  // Safe upload of dish image to Firebase Storage with local fallback
  const uploadDishImageSafe = async (localUri) => {
    if (!localUri) return null;
    if (localUri.startsWith("data:") || localUri.startsWith("http://") || localUri.startsWith("https://")) {
      return localUri;
    }
    try {
      const blob = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.onload = () => resolve(xhr.response);
        xhr.onerror = () => reject(new Error("Local file conversion failed"));
        xhr.responseType = "blob";
        xhr.open("GET", localUri, true);
        xhr.send(null);
      });
      const path = `dish-images/${sellerId || "common"}/${Date.now()}_item.jpg`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });
      const downloadUrl = await getDownloadURL(storageRef).catch(() => null);
      return downloadUrl || localUri;
    } catch (e) {
      console.warn("Storage upload dish image notice:", e?.message);
      return localUri;
    }
  };

  const pickStoreLogoImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Permission Required", "Please allow photo library access to change your storefront photo.");
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.6,
        base64: true,
      });
      if (!res.canceled && res.assets?.[0]) {
        const asset = res.assets[0];
        if (asset.base64) {
          setStoreLogoUri(`data:image/jpeg;base64,${asset.base64}`);
        } else if (asset.uri) {
          setStoreLogoUri(asset.uri);
        }
      }
    } catch (err) {
      Alert.alert("Notice", "Could not pick image.");
    }
  };

  const pickProductImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Permission Required", "Please allow photo library access to upload item photos.");
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.7,
        base64: true,
      });
      if (!res.canceled && res.assets?.[0]) {
        const asset = res.assets[0];
        if (asset.base64) {
          setProdImage(`data:image/jpeg;base64,${asset.base64}`);
        } else if (asset.uri) {
          setProdImage(asset.uri);
        }
      }
    } catch (err) {
      console.warn("pickProductImage error:", err?.message);
      Alert.alert("Notice", "Could not select product image.");
    }
  };

  const handleSaveStoreSettings = async () => {
    if (!user?.uid) return;
    setSavingStorefront(true);
    try {
      const updates = {
        address: storeAddress.trim(),
        workingHours: storeWorkingHours.trim(),
        image: storeLogoUri || null,
        profileImage: storeLogoUri || null,
        updatedAt: serverTimestamp(),
      };
      await updateDoc(doc(db, "user", user.uid), {
        ...updates,
        ...(storeCoords ? { storeLatitude: storeCoords.latitude, storeLongitude: storeCoords.longitude } : {}),
      });
      if (sellerId) {
        const col = isShop ? "shops" : "restaurants";
        await setDoc(
          doc(db, col, sellerId),
          { ...updates, ...(storeCoords ? { latitude: storeCoords.latitude, longitude: storeCoords.longitude } : {}) },
          { merge: true }
        );
      }
      Alert.alert("Storefront Updated ✓", "Your address, operating hours, and storefront photo have been saved.");
    } catch (e) {
      Alert.alert("Update Failed", e?.message || "Could not update storefront settings.");
    } finally {
      setSavingStorefront(false);
    }
  };

  const handleConfirmRejectOrder = async () => {
    if (!rejectingOrder?.id) return;
    setIsRejectingBusy(true);
    try {
      const reason = merchantRejectReason.trim() || "Item out of stock or kitchen capacity reached";
      const declined = await runTransaction(db, async (tx) => {
        const ref = doc(db, "orders", rejectingOrder.id);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("This order no longer exists.");
        const current = snap.data();
        if (current.status === "CANCELLED") throw new Error("The customer already cancelled this order.");
        if (!["PENDING", "AWAITING_MERCHANT"].includes(current.status)) {
          throw new Error("Only new orders can be declined. Contact MyTruck support for accepted orders.");
        }
        tx.update(ref, {
          status: "MERCHANT_REJECTED",
          rejectedByMerchant: true,
          merchantRejectionReason: reason,
          rejectedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        return { id: snap.id, ...current };
      });
      notifyCustomer(
        declined,
        "Store Couldn't Take Your Order",
        `${declined.restaurantName || "The store"} declined it (${reason}). We're finding another store — you can also cancel from the order screen.`
      );

      // Dispatch alert to Super Admin for immediate reassignment
      try {
        const nRef = doc(collection(db, "notifications"));
        await setDoc(nRef, {
          id: nRef.id,
          type: "ORDER_MERCHANT_REJECTED",
          category: "ADMIN",
          title: "Order Declined by Merchant ⚠️",
          body: `Order #${rejectingOrder.id.slice(-6).toUpperCase()} was declined by ${storeTitle}. Reason: ${reason}. Please reassign to an alternative merchant.`,
          data: { targetRoute: "AdminDashboard", orderId: rejectingOrder.id },
          isRead: false,
          createdAt: serverTimestamp(),
        });
      } catch (_) {}

      Alert.alert("Order Declined", "Order declined and forwarded to operations team for reassignment.");
      setMerchantRejectModalVisible(false);
      setRejectingOrder(null);
    } catch (e) {
      Alert.alert("Error", e?.message || "Could not decline order.");
    } finally {
      setIsRejectingBusy(false);
    }
  };

  const handleSaveProduct = async () => {
    if (!prodName.trim()) {
      Alert.alert("Required", "Please enter product name.");
      return;
    }
    const numPrice = Number(prodPrice);
    if (isNaN(numPrice) || numPrice <= 0) {
      Alert.alert("Invalid Price", "Please enter a valid base price in ETB.");
      return;
    }

    let finalSellingPrice = numPrice;
    let discAmount = 0;
    let discPercent = 0;
    let numDiscountedPrice = null;

    if (hasDiscount) {
      numDiscountedPrice = Number(prodDiscountedPrice);
      if (isNaN(numDiscountedPrice) || numDiscountedPrice <= 0) {
        Alert.alert("Invalid Discount Price", "Please enter a valid discounted price in ETB.");
        return;
      }
      if (numDiscountedPrice >= numPrice) {
        Alert.alert("Invalid Discount", "Discounted price must be strictly lower than the original base price.");
        return;
      }
      discAmount = Math.round((numPrice - numDiscountedPrice) * 100) / 100;
      discPercent = Math.round((discAmount / numPrice) * 100);
      if (discPercent < 1 || discPercent > 90) {
        Alert.alert("Invalid Discount", "Discount percentage must be between 1% and 90%.");
        return;
      }
      finalSellingPrice = numDiscountedPrice;
    }

    if (!prodImage || !prodImage.trim()) {
      Alert.alert(
        "Image Required",
        "Item image is a required field. Please upload or select a photo of this item."
      );
      return;
    }

    setSavingProduct(true);
    try {
      let finalImageUrl = prodImage.trim();
      if (finalImageUrl.startsWith("file:") || finalImageUrl.startsWith("content:")) {
        const uploadedUrl = await uploadDishImageSafe(finalImageUrl);
        if (uploadedUrl) finalImageUrl = uploadedUrl;
      }

      const activeMerchantId = isShop
        ? (merchantId || "shop-bambis-supermarket")
        : (merchantId || sellerId || user?.uid);

      const storeName = dbUser?.businessName || dbUser?.name || (isShop ? "Shop Store" : "Restaurant");

      const data = {
        name: prodName.trim(),
        price: finalSellingPrice,
        originalPrice: numPrice,
        discountedPrice: hasDiscount ? numDiscountedPrice : null,
        hasDiscount: Boolean(hasDiscount),
        discountAmount: discAmount,
        discountPercent: discPercent,
        discountStartDate: hasDiscount && discountStartDate ? discountStartDate : null,
        discountEndDate: hasDiscount && discountEndDate ? discountEndDate : null,
        category: prodCategory,
        genre: prodCategory,
        description: prodDesc.trim(),
        image: finalImageUrl,
        isAvailable: prodAvailable,
        inStock: prodAvailable,
        ownerUid: user?.uid,
        sellerId: user?.uid,
        restaurantId: activeMerchantId,
        shopId: isShop ? activeMerchantId : null,
        isShop: Boolean(isShop),
        sellerType: isShop ? "shop" : "restaurant",
        restaurantName: storeName,
        merchantName: storeName,
        status: "PENDING",
        approvalStatus: "PENDING",
        isApproved: false,
        isPublished: false,
        lifecycleStatus: "Pending",
        updatedAt: serverTimestamp(),
      };

      if (editingProduct?.id) {
        await updateDoc(doc(db, "dishes", editingProduct.id), data);
        if (isShop) {
          await setDoc(doc(db, "products", `dish-${editingProduct.id}`), {
            ...data,
            id: `dish-${editingProduct.id}`,
            isActive: false,
          }, { merge: true }).catch(() => {});
        }
        Alert.alert("Updated & Under Review", "Product details updated. Changes are submitted for Super Admin review.");
      } else {
        data.createdAt = serverTimestamp();
        const docRef = await addDoc(collection(db, "dishes"), data);
        if (isShop) {
          await setDoc(doc(db, "products", `dish-${docRef.id}`), {
            ...data,
            id: `dish-${docRef.id}`,
            isActive: false,
          }, { merge: true }).catch(() => {});
        }
        Alert.alert(
          "Submitted for Approval! ⏳",
          "Your item has been submitted for Super Admin review. Once approved, it will be published to customer apps."
        );
      }
      setProductModalVisible(false);
    } catch (e) {
      Alert.alert("Error Saving Product", e?.message || "Please try again.");
    } finally {
      setSavingProduct(false);
    }
  };

  const handleDeleteProduct = (item) => {
    Alert.alert(
      "Remove Product?",
      `Are you sure you want to permanently delete "${item.name}" from your catalog?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteDoc(doc(db, "dishes", item.id));
            } catch (e) {
              Alert.alert("Error", e?.message || "Could not delete product.");
            }
          },
        },
      ]
    );
  };

  const toggleProductAvailability = async (item, val) => {
    try {
      await updateDoc(doc(db, "dishes", item.id), {
        isAvailable: val,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      Alert.alert("Error", e?.message);
    }
  };

  const makeCall = (phone) => {
    if (!phone) return;
    Linking.openURL(`tel:${phone}`).catch(() => {
      Alert.alert("Call Unavailable", `Could not initiate call to ${phone}`);
    });
  };

  const storeTitle = dbUser?.businessName || (dbUser?.firstName ? `${dbUser.firstName}'s Store` : "My Business");
  const fallbackType = isShop ? "shop" : "restaurant";

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <StatusBar style="light" backgroundColor={TEAL} />

      {/* Executive Curved Header Bar — Inspired by AdminDashboard */}
      <View style={s.header}>
        <View style={s.headerTopRow}>
          {/* Storefront preview / Back to customer app button */}
          <TouchableOpacity
            // This dashboard is the role's home: only go back when there is a previous screen
            onPress={() => {
              if (navigation.canGoBack()) navigation.goBack();
            }}
            disabled={!navigation.canGoBack()}
            style={[s.headerBackBtn, !navigation.canGoBack() && { opacity: 0 }]}
            activeOpacity={0.8}
            accessibilityLabel="Preview Customer Storefront"
          >
            <MaterialCommunityIcons name="storefront-outline" size={20} color="#FFFFFF" />
          </TouchableOpacity>

          {/* Title & Role Info */}
          <View style={s.headerTitleWrap}>
            <Text style={s.headerTitle} numberOfLines={1}>
              {storeTitle}
            </Text>
            <View style={s.headerSubtitleRow}>
              <View style={[s.approvalPill, isApproved ? s.approvalApproved : s.approvalPending]}>
                <Text style={[s.approvalTxt, isApproved ? s.approvalTxtApproved : s.approvalTxtPending]}>
                  {isApproved ? "APPROVED" : (dbUser?.approvalStatus || "PENDING REVIEW")}
                </Text>
              </View>
              <Text style={s.headerSubtitle}>
                {isShop ? "Shop Merchant Terminal" : "Restaurant Merchant Terminal"}
              </Text>
            </View>
          </View>

          {/* Top Right Actions: Notification + Live Open Toggle */}
          <View style={s.headerRightActions}>
            <NotificationBell
              style={s.notificationCircle}
              iconColor="#FFFFFF"
              badgeColor={ORANGE}
            />
            <TouchableOpacity
              onPress={() => setIsOpenForOrders((prev) => !prev)}
              style={[s.storeToggleBtn, isOpenForOrders ? s.storeOpen : s.storeClosed]}
              activeOpacity={0.8}
            >
              <View style={[s.statusDot, { backgroundColor: isOpenForOrders ? "#22C55E" : "#EF4444" }]} />
              <Text style={s.storeToggleTxt}>{isOpenForOrders ? "OPEN" : "CLOSED"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Horizontal Segmented Tabs Bar */}
      <View style={s.tabsBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabsScroll}>
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            let badgeCount = null;
            if (tab.id === "orders" && stats.pending > 0) badgeCount = stats.pending;
            if (tab.id === "catalog") badgeCount = stats.totalProducts;

            return (
              <TouchableOpacity
                key={tab.id}
                onPress={() => setActiveTab(tab.id)}
                style={[s.tabItem, active && s.tabItemActive]}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons
                  name={tab.icon}
                  size={18}
                  color={active ? TEAL : "#64748B"}
                />
                <Text style={[s.tabLabel, active && s.tabLabelActive]}>
                  {tab.label}
                  {badgeCount !== null ? ` (${badgeCount})` : ""}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Main Body Content ScrollView */}
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={TEAL} />}
      >
        {/* Pending Approval Banner */}
        {!isApproved && (
          <View style={s.approvalBanner}>
            <MaterialCommunityIcons name="clock-alert-outline" size={24} color={ORANGE} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={s.approvalBannerTitle}>Account Pending Admin Verification</Text>
              <Text style={s.approvalBannerTxt}>
                Your business documents are currently being verified by the MyTruck Operations Team. You will receive an alert once fully activated.
              </Text>
            </View>
          </View>
        )}

        {/* Executive KPI Stats Cards Row */}
        <View style={s.kpiRow}>
          <View style={s.kpiCard}>
            <View style={[s.kpiIconBox, { backgroundColor: "#E6F7F1" }]}>
              <MaterialCommunityIcons name="file-document-outline" size={20} color={TEAL} />
            </View>
            <Text style={s.kpiValue}>{stats.todayCount}</Text>
            <Text style={s.kpiLabel}>Today's Orders</Text>
          </View>

          <View style={s.kpiCard}>
            <View style={[s.kpiIconBox, { backgroundColor: "#FEF3C7" }]}>
              <MaterialCommunityIcons name="cash-multiple" size={20} color="#D97706" />
            </View>
            <Text style={s.kpiValue}>ETB {stats.revenue.toFixed(0)}</Text>
            <Text style={s.kpiLabel}>Revenue (ETB)</Text>
          </View>

          <View style={s.kpiCard}>
            <View style={[s.kpiIconBox, { backgroundColor: "#FFEDD5" }]}>
              <MaterialCommunityIcons name="clock-outline" size={20} color={ORANGE} />
            </View>
            <Text style={[s.kpiValue, stats.pending > 0 && { color: ORANGE }]}>{stats.pending}</Text>
            <Text style={s.kpiLabel}>Kitchen Pending</Text>
          </View>

          <View style={s.kpiCard}>
            <View style={[s.kpiIconBox, { backgroundColor: "#EFF6FF" }]}>
              <MaterialCommunityIcons name="store-cog-outline" size={20} color="#2563EB" />
            </View>
            <Text style={s.kpiValue}>{stats.activeProducts}</Text>
            <Text style={s.kpiLabel}>Active Listings</Text>
          </View>
        </View>

        {/* TAB 1: KITCHEN & ORDERS QUEUE */}
        {activeTab === "orders" && (
          <View>
            {!storeCoords && (
              <TouchableOpacity
                onPress={() => setActiveTab("profile")}
                style={{ backgroundColor: "#FFF7ED", borderWidth: 1, borderColor: "#FDBA74", borderRadius: 12, padding: 12, marginBottom: 12 }}
                activeOpacity={0.85}
              >
                <Text style={{ fontSize: 12.5, fontWeight: "800", color: "#9A3412" }}>📍 Your store location isn't set</Text>
                <Text style={{ fontSize: 11.5, color: "#9A3412", marginTop: 2 }}>
                  Drivers and delivery fees use an approximate point until you pin it. Tap to open Store Settings.
                </Text>
              </TouchableOpacity>
            )}
            {/* Status Filter Chips */}
            <View style={s.filterScrollWrap}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
                {[
                  { id: "ALL", label: `All (${orders.length})` },
                  { id: "PENDING", label: `Pending (${stats.pending})` },
                  { id: "PREPARING", label: `Preparing (${stats.preparing})` },
                  { id: "READY", label: `Ready for Driver` },
                  { id: "COMPLETE", label: `Completed (${stats.completed})` },
                ].map((f) => {
                  const sel = orderFilter === f.id;
                  return (
                    <TouchableOpacity
                      key={f.id}
                      onPress={() => setOrderFilter(f.id)}
                      style={[s.filterChip, sel && s.filterChipActive]}
                    >
                      <Text style={[s.filterChipTxt, sel && s.filterChipTxtActive]}>{f.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {loadingOrders ? (
              <View style={s.emptyCenter}>
                <ActivityIndicator size="large" color={TEAL} />
                <Text style={s.emptySub}>Synchronizing orders with live kitchen queue…</Text>
              </View>
            ) : filteredOrders.length === 0 ? (
              <View style={s.emptyCard}>
                <MaterialCommunityIcons name="receipt" size={54} color="#CBD5E1" />
                <Text style={s.emptyTitle}>No Orders in this Queue</Text>
                <Text style={s.emptySub}>
                  {orderFilter === "ALL"
                    ? "New customer orders will appear here automatically in real time."
                    : `There are currently no orders with "${orderFilter}" status.`}
                </Text>
              </View>
            ) : (
              filteredOrders.map((order) => {
                const statusMeta = STATUS_CONFIG[order.status] || {
                  label: order.status || "Unknown",
                  bg: "#F1F5F9",
                  text: "#475569",
                  actions: [],
                };
                const itemsCount = (order.items || []).reduce((sum, it) => sum + Number(it.quantity || 1), 0);
                const orderRef = order.id ? `#MT-${order.id.slice(-6).toUpperCase()}` : "#MT-ORDER";

                return (
                  <View key={order.id} style={s.orderCard}>
                    {/* Card Top: Ref & Status Pill */}
                    <View style={s.orderCardHeader}>
                      <View>
                        <Text style={s.orderRefText}>{orderRef}</Text>
                        <Text style={s.orderTimeText}>
                          {order.createdAt?.seconds
                            ? new Date(order.createdAt.seconds * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                            : "Just now"}
                        </Text>
                      </View>
                      <View style={[s.orderStatusPill, { backgroundColor: statusMeta.bg }]}>
                        <Text style={[s.orderStatusTxt, { color: statusMeta.text }]}>{statusMeta.label}</Text>
                      </View>
                    </View>

                    {/* Customer Row with Call Shortcut */}
                    <View style={s.customerRow}>
                      <View style={s.customerAvatar}>
                        <MaterialCommunityIcons name="account" size={18} color={TEAL} />
                      </View>
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={s.customerName}>
                          {order.userFirstName} {order.userLastName || ""}
                        </Text>
                        <Text style={s.customerAddress} numberOfLines={1}>
                          📍 {order.userAddress || "Standard delivery address"}
                        </Text>
                      </View>
                      {Boolean(order.userPhoneNumber) && (
                        <TouchableOpacity
                          onPress={() => makeCall(order.userPhoneNumber)}
                          style={s.callBtn}
                          activeOpacity={0.8}
                        >
                          <MaterialCommunityIcons name="phone" size={16} color="#FFFFFF" />
                          <Text style={s.callBtnTxt}>Call</Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    {/* Order Items Preview */}
                    <View style={s.itemsPreviewBox}>
                      {(order.items || []).slice(0, 3).map((it, idx) => (
                        <View key={idx} style={s.itemLine}>
                          <Text style={s.itemQty}>{it.quantity || 1}x</Text>
                          <Text style={s.itemName} numberOfLines={1}>{it.name || "Item"}</Text>
                          <Text style={s.itemPrice}>ETB {Number((it.price || 0) * (it.quantity || 1)).toFixed(0)}</Text>
                        </View>
                      ))}
                      {(order.items || []).length > 3 && (
                        <Text style={s.moreItemsTxt}>+ {(order.items || []).length - 3} more items...</Text>
                      )}
                    </View>

                    {/* Pricing and Payment Badge */}
                    <View style={s.orderFooterRow}>
                      <View>
                        <Text style={s.orderTotalLabel}>Total Amount ({itemsCount} items)</Text>
                        <Text style={s.orderTotalValue}>ETB {Number(order.total || 0).toFixed(2)}</Text>
                      </View>
                      <View style={[
                        s.paymentPill,
                        order.paymentStatus === "PAID"
                          ? s.paymentPaid
                          : (order.paymentMethod === "CHAPA" ? { backgroundColor: "#FEE2E2" } : s.paymentPending)
                      ]}>
                        <MaterialCommunityIcons
                          name={order.paymentStatus === "PAID" ? "check-decagram" : (order.paymentMethod === "CHAPA" ? "alert-circle-outline" : "cash")}
                          size={13}
                          color={order.paymentStatus === "PAID" ? "#166534" : (order.paymentMethod === "CHAPA" ? "#DC2626" : "#B45309")}
                        />
                        <Text style={[
                          s.paymentTxt,
                          order.paymentStatus === "PAID"
                            ? s.paymentTxtPaid
                            : (order.paymentMethod === "CHAPA" ? { color: "#DC2626" } : s.paymentTxtPending)
                        ]}>
                          {order.paymentStatus === "PAID"
                            ? "PAID ONLINE"
                            : (order.paymentMethod === "CHAPA" ? "UNPAID (CHAPA)" : (order.paymentMethod || "COD"))}
                        </Text>
                      </View>
                    </View>

                    {/* Unpaid Chapa Order Warning for Kitchen */}
                    {order.paymentMethod === "CHAPA" && order.paymentStatus !== "PAID" && (
                      <View style={{ backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FCA5A5", borderRadius: 8, padding: 8, marginBottom: 8 }}>
                        <Text style={{ fontSize: 11, color: "#B91C1C", fontWeight: "700" }}>
                          ⚠️ Customer has not completed payment on Chapa yet. Awaiting payment before preparation.
                        </Text>
                      </View>
                    )}

                    {/* Merchant Rejection State Banner */}
                    {Boolean(order.status === "MERCHANT_REJECTED" || order.rejectedByMerchant) && (
                      <View style={{ backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECDD3", borderRadius: 8, padding: 8, marginTop: 6 }}>
                        <Text style={{ fontSize: 11, color: "#991B1B", fontWeight: "700" }}>
                          ⚠️ You declined this order ({order.merchantRejectionReason || "Unavailable"}). Forwarded to operations.
                        </Text>
                      </View>
                    )}

                    {/* Dynamic Action Buttons */}
                    {(statusMeta.actions || []).length > 0 && (
                      <View style={s.actionsRow}>
                        {statusMeta.actions.map((act) => {
                          const isDecline = act === "DECLINED";
                          return (
                            <TouchableOpacity
                              key={act}
                              onPress={() => {
                                if (isDecline) {
                                  setRejectingOrder(order);
                                  setMerchantRejectReason("Item out of stock");
                                  setMerchantRejectModalVisible(true);
                                  return;
                                }
                                Alert.alert(
                                  `${ACTION_LABELS[act]}?`,
                                  `Are you sure you want to mark this order as "${ACTION_LABELS[act]}"?`,
                                  [
                                    { text: "Cancel", style: "cancel" },
                                    { text: "Confirm", onPress: () => updateOrderStatus(order.id, act) },
                                  ]
                                );
                              }}
                              style={[s.actionBtn, isDecline ? s.actionBtnDecline : s.actionBtnPrimary]}
                              activeOpacity={0.8}
                            >
                              <Text style={[s.actionBtnTxt, isDecline ? s.actionBtnTxtDecline : s.actionBtnTxtPrimary]}>
                                {ACTION_LABELS[act] || act}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </View>
        )}

        {/* TAB 2: MENU & CATALOG MANAGEMENT */}
        {activeTab === "catalog" && (
          <View>
            {/* Header with Search and Add Product Button */}
            <View style={s.catalogHeaderRow}>
              <View style={s.searchWrap}>
                <MaterialCommunityIcons name="magnify" size={20} color="#94A3B8" />
                <TextInput
                  style={s.searchInput}
                  placeholder="Search products or dishes..."
                  placeholderTextColor="#94A3B8"
                  value={catalogSearch}
                  onChangeText={setCatalogSearch}
                />
              </View>
              <TouchableOpacity
                onPress={openAddProduct}
                style={s.addProductBtn}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons name="plus" size={18} color="#FFFFFF" />
                <Text style={s.addProductBtnTxt}>Add Item</Text>
              </TouchableOpacity>
            </View>

            {/* Category Filter Pills */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.catPillRow}>
              {CATEGORIES.map((cat) => {
                const sel = catalogCategory === cat;
                return (
                  <TouchableOpacity
                    key={cat}
                    onPress={() => setCatalogCategory(cat)}
                    style={[s.catChip, sel && s.catChipActive]}
                  >
                    <Text style={[s.catChipTxt, sel && s.catChipTxtActive]}>{cat}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {loadingMenu ? (
              <View style={s.emptyCenter}>
                <ActivityIndicator size="large" color={TEAL} />
                <Text style={s.emptySub}>Loading store catalog…</Text>
              </View>
            ) : filteredCatalog.length === 0 ? (
              <View style={s.emptyCard}>
                <MaterialCommunityIcons name="food-off" size={54} color="#CBD5E1" />
                <Text style={s.emptyTitle}>No Products Found</Text>
                <Text style={s.emptySub}>
                  {catalogSearch
                    ? `No items match "${catalogSearch}". Try another keyword.`
                    : "Your catalog is empty. Tap 'Add Item' to list dishes or merchandise."}
                </Text>
                <TouchableOpacity onPress={openAddProduct} style={s.emptyActionBtn}>
                  <Text style={s.emptyActionBtnTxt}>Add New Product</Text>
                </TouchableOpacity>
              </View>
            ) : (
              filteredCatalog.map((item) => (
                <View key={item.id} style={s.productCard}>
                  <View style={s.productCardInner}>
                    {/* Reliable SmartImage with local fallback */}
                    <SmartImage
                      uri={item.image}
                      fallbackType={fallbackType}
                      style={s.productImage}
                      resizeMode="cover"
                    />

                    {/* Product Details */}
                    <View style={s.productInfo}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <Text style={s.productName} numberOfLines={1}>{item.name}</Text>
                        <View style={[s.stockBadge, item.isAvailable !== false ? s.inStock : s.outOfStock]}>
                          <Text style={[s.stockBadgeTxt, item.isAvailable !== false ? s.inStockTxt : s.outOfStockTxt]}>
                            {item.isAvailable !== false ? "IN STOCK" : "OUT OF STOCK"}
                          </Text>
                        </View>
                      </View>

                      {Boolean(item.description) && (
                        <Text style={s.productDesc} numberOfLines={2}>{item.description}</Text>
                      )}

                      <View style={s.productMetaRow}>
                        {item.hasDiscount && item.originalPrice && Number(item.originalPrice) > Number(item.price) ? (
                          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 5 }}>
                            <Text style={[s.productPrice, { color: "#E11D48" }]}>ETB {Number(item.price || 0).toFixed(0)}</Text>
                            <Text style={{ fontSize: 11.5, color: "#94A3B8", textDecorationLine: "line-through" }}>
                              ETB {Number(item.originalPrice).toFixed(0)}
                            </Text>
                            <View style={{ backgroundColor: "#FEE2E2", paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3 }}>
                              <Text style={{ fontSize: 9.5, fontWeight: "800", color: "#E11D48" }}>
                                -{item.discountPercent || Math.round(((Number(item.originalPrice) - Number(item.price)) / Number(item.originalPrice)) * 100)}%
                              </Text>
                            </View>
                          </View>
                        ) : (
                          <Text style={s.productPrice}>ETB {Number(item.price || 0).toFixed(0)}</Text>
                        )}
                        <View style={s.catBadge}>
                          <Text style={s.catBadgeTxt}>{item.category || item.genre || "Item"}</Text>
                        </View>
                      </View>
                    </View>
                  </View>

                  {/* Approval Status & Governance Notice */}
                  {item.status === "REJECTED" || item.lifecycleStatus === "Rejected" ? (
                    <View style={{ backgroundColor: "#FEE2E2", marginHorizontal: 12, marginTop: 8, padding: 8, borderRadius: 8, borderWidth: 1, borderColor: "#FCA5A5" }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                        <MaterialCommunityIcons name="close-circle" size={14} color="#DC2626" />
                        <Text style={{ fontSize: 11, fontWeight: "800", color: "#DC2626" }}>REJECTED BY ADMIN</Text>
                      </View>
                      <Text style={{ fontSize: 11, color: "#991B1B", marginTop: 3 }}>
                        Reason: {item.rejectionReason || item.reviewReason || "Does not meet catalog guidelines."}
                      </Text>
                    </View>
                  ) : item.status === "PENDING" || item.lifecycleStatus === "Pending" || (!item.isApproved && item.status !== "APPROVED" && item.status !== "Published") ? (
                    <View style={{ backgroundColor: "#FEF9C3", marginHorizontal: 12, marginTop: 8, padding: 8, borderRadius: 8, borderWidth: 1, borderColor: "#FDE047" }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                        <MaterialCommunityIcons name="clock-time-four-outline" size={14} color="#A16207" />
                        <Text style={{ fontSize: 11, fontWeight: "800", color: "#A16207" }}>PENDING ADMIN APPROVAL</Text>
                      </View>
                      <Text style={{ fontSize: 10.5, color: "#854D0E", marginTop: 2 }}>
                        Under Super Admin review. Once approved, it will be published to customer apps.
                      </Text>
                    </View>
                  ) : (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginHorizontal: 12, marginTop: 6 }}>
                      <MaterialCommunityIcons name="check-decagram" size={13} color="#166534" />
                      <Text style={{ fontSize: 11, fontWeight: "700", color: "#166534" }}>Approved & Live in Store</Text>
                    </View>
                  )}

                  {/* Product Card Actions Bottom Bar */}
                  <View style={s.productBottomBar}>
                    <View style={s.stockToggleWrap}>
                      <Switch
                        value={item.isAvailable !== false}
                        onValueChange={(val) => toggleProductAvailability(item, val)}
                        trackColor={{ false: "#CBD5E1", true: TEAL }}
                        thumbColor="#FFFFFF"
                      />
                      <Text style={s.stockToggleLabel}>
                        {item.isAvailable !== false ? "Visible to customers" : "Hidden from menu"}
                      </Text>
                    </View>

                    <View style={s.productBtnRow}>
                      <TouchableOpacity
                        onPress={() => openEditProduct(item)}
                        style={s.editBtn}
                        activeOpacity={0.8}
                      >
                        <MaterialCommunityIcons name="pencil-outline" size={16} color={TEAL} />
                        <Text style={s.editBtnTxt}>Edit</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => handleDeleteProduct(item)}
                        style={s.deleteBtn}
                        activeOpacity={0.8}
                      >
                        <MaterialCommunityIcons name="trash-can-outline" size={16} color="#DC2626" />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {/* TAB 3: SALES & INSIGHTS */}
        {activeTab === "analytics" && (
          <View>
            {/* Date Range Filter Pills */}
            <View style={{ flexDirection: "row", paddingHorizontal: 16, paddingVertical: 10, gap: 8, flexWrap: "wrap" }}>
              {["Today", "Yesterday", "Last 7 Days", "Last 30 Days", "All Time"].map((r) => (
                <TouchableOpacity
                  key={r}
                  onPress={() => setSalesRange(r)}
                  style={{
                    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
                    backgroundColor: salesRange === r ? "#179B83" : "#E8F5F2",
                    borderWidth: 1, borderColor: salesRange === r ? "#179B83" : "#C7E8E0",
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: "700", color: salesRange === r ? "#FFF" : "#179B83" }}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.analyticsHeroCard}>
              <Text style={s.analyticsHeroSub}>Balance Payable (Fulfilled Orders)</Text>
              <Text style={s.analyticsHeroAmt}>ETB {stats.balancePayable.toFixed(2)}</Text>
              <Text style={{ fontSize: 12, color: "#E6F7F1", marginTop: 2, marginBottom: 12, textAlign: "center", fontWeight: "600" }}>
                {stats.completed} orders completed · Balance payable: ETB {stats.balancePayable.toFixed(2)}
              </Text>
              <View style={s.analyticsBreakdownRow}>
                <View style={s.analyticsPill}>
                  <Text style={s.analyticsPillLabel}>{salesRange} Sales</Text>
                  <Text style={s.analyticsPillVal}>ETB {rangeSalesTotal.toFixed(0)}</Text>
                </View>
                <View style={s.analyticsPill}>
                  <Text style={s.analyticsPillLabel}>Fulfilled</Text>
                  <Text style={s.analyticsPillVal}>{stats.completed} Orders</Text>
                </View>
                <View style={s.analyticsPill}>
                  <Text style={s.analyticsPillLabel}>Kitchen Queue</Text>
                  <Text style={s.analyticsPillVal}>{stats.pending} Pending</Text>
                </View>
              </View>
            </View>

            {/* Promotional Deals & Discounts KPI */}
            <View style={[s.analyticsHeroCard, { backgroundColor: "#FFF1F2", borderWidth: 1, borderColor: "#FECDD3", marginTop: 12 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={[s.analyticsHeroSub, { color: "#9F1239" }]}>Promotional Deals & Discounts</Text>
                <View style={{ backgroundColor: "#FEE2E2", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                  <Text style={{ fontSize: 10, fontWeight: "800", color: "#E11D48" }}>ACTIVE PROMOS</Text>
                </View>
              </View>
              <Text style={[s.analyticsHeroAmt, { color: "#E11D48" }]}>
                {menuItems.filter((i) => i.hasDiscount && i.originalPrice > i.price).length} Items on Sale
              </Text>
              <Text style={{ fontSize: 11.5, color: "#9F1239", marginTop: 4, lineHeight: 16 }}>
                Items with discounts attract up to 3x more orders. Commission is calculated strictly on your discounted selling price.
              </Text>
            </View>

            {/* Quick Operational Guidelines */}
            <View style={s.guidelinesCard}>
              <Text style={s.guidelinesTitle}>Merchant Operating Guidelines</Text>
              <View style={s.guidelineItem}>
                <MaterialCommunityIcons name="timer-sand" size={18} color={TEAL} />
                <Text style={s.guidelineTxt}>Prepare orders within 15–20 minutes to maintain high customer rating.</Text>
              </View>
              <View style={s.guidelineItem}>
                <MaterialCommunityIcons name="truck-check" size={18} color={TEAL} />
                <Text style={s.guidelineTxt}>Tap 'Mark Ready for Pickup' as soon as food is packed for the driver.</Text>
              </View>
              <View style={s.guidelineItem}>
                <MaterialCommunityIcons name="alert-circle-outline" size={18} color={ORANGE} />
                <Text style={s.guidelineTxt}>Keep product stock up to date to prevent customer order cancellations.</Text>
              </View>
            </View>
          </View>
        )}

        {/* TAB 4: STORE SETTINGS & PROFILE */}
        {activeTab === "profile" && (
          <View>
            {/* View-Only Locked Legal Registration Details matching User Mandate */}
            <View style={{ backgroundColor: "#F8FAFC", borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: "#E2E8F0" }}>
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
                <MaterialCommunityIcons name="shield-lock" size={22} color={TEAL} style={{ marginRight: 8 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: "800", color: DARK }}>Legal Registration & KYC Profile</Text>
                  <Text style={{ fontSize: 11, color: "#64748B" }}>Locked & Verified by Operations Team 🔒</Text>
                </View>
                <View style={{ backgroundColor: "#DCFCE7", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}>
                  <Text style={{ fontSize: 10.5, fontWeight: "800", color: "#166534" }}>VERIFIED</Text>
                </View>
              </View>

              <View style={{ backgroundColor: "white", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#F1F5F9" }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: "#F8FAFC" }}>
                  <Text style={{ fontSize: 12, color: "#64748B" }}>Legal Business Name</Text>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: DARK }}>{storeTitle} 🔒</Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: "#F8FAFC" }}>
                  <Text style={{ fontSize: 12, color: "#64748B" }}>Manager / Owner Name</Text>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: DARK }}>{dbUser?.fullName || dbUser?.ownerName || "Owner"} 🔒</Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: "#F8FAFC" }}>
                  <Text style={{ fontSize: 12, color: "#64748B" }}>Official Phone Number</Text>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: DARK }}>{dbUser?.phoneNumber || dbUser?.phone || "—"} 🔒</Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: "#F8FAFC" }}>
                  <Text style={{ fontSize: 12, color: "#64748B" }}>Telebirr Settlement #</Text>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: TEAL }}>{dbUser?.telebirrPhone || dbUser?.phone || "—"} 🔒</Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: "#F8FAFC" }}>
                  <Text style={{ fontSize: 12, color: "#64748B" }}>Settlement Bank</Text>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: DARK }}>{dbUser?.bankName || "Commercial Bank of Ethiopia"} 🔒</Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: "#F8FAFC" }}>
                  <Text style={{ fontSize: 12, color: "#64748B" }}>Bank Account Number</Text>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: DARK }}>{dbUser?.accountNumber || "—"} 🔒</Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: "#F8FAFC" }}>
                  <Text style={{ fontSize: 12, color: "#64748B" }}>License / Reg. Number</Text>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: DARK }}>{dbUser?.licenceNumber || "Verified License"} 🔒</Text>
                </View>
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 }}>
                  <Text style={{ fontSize: 12, color: "#64748B" }}>Submitted Documents</Text>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: "#166534" }}>Documents On File ✓ 🔒</Text>
                </View>
              </View>
              <Text style={{ fontSize: 10.5, color: "#94A3B8", marginTop: 8, fontStyle: "italic" }}>
                🔒 Official legal credentials and bank details cannot be edited directly. To request official changes, contact Super Admin Operations.
              </Text>
            </View>

            {/* Editable Storefront Settings (The Only Permitted Fields) */}
            <View style={{ backgroundColor: "white", borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: "#E2E8F0" }}>
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
                <MaterialCommunityIcons name="pencil-outline" size={20} color={TEAL} style={{ marginRight: 8 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: "800", color: DARK }}>Storefront Customization</Text>
                  <Text style={{ fontSize: 11, color: "#64748B" }}>Permitted updates: Logo, hours & address</Text>
                </View>
              </View>

              {/* Logo / Company Photo */}
              <Text style={s.modalLabel}>Company Logo / Storefront Photo</Text>
              <View style={{ alignItems: "center", marginVertical: 8 }}>
                <SmartImage
                  uri={storeLogoUri || dbUser?.image || dbUser?.profileImage}
                  fallbackType={fallbackType}
                  style={{ width: "100%", height: 140, borderRadius: 12, backgroundColor: "#F1F5F9" }}
                  resizeMode="cover"
                />
                <TouchableOpacity
                  style={{ marginTop: 8, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, backgroundColor: "#E6F7F1", flexDirection: "row", alignItems: "center" }}
                  onPress={pickStoreLogoImage}
                >
                  <MaterialCommunityIcons name="camera" size={16} color={TEAL} style={{ marginRight: 6 }} />
                  <Text style={{ fontSize: 12, fontWeight: "800", color: TEAL }}>Change Storefront Photo / Logo</Text>
                </TouchableOpacity>
              </View>

              {/* Working Hours Interval */}
              <Text style={s.modalLabel}>Operating / Working Hours Interval</Text>
              <TextInput
                style={s.modalInput}
                value={storeWorkingHours}
                onChangeText={setStoreWorkingHours}
                placeholder="e.g. 08:00 AM - 10:00 PM"
                placeholderTextColor="#94A3B8"
              />

              {/* Operating Address */}
              <Text style={s.modalLabel}>Operating Address & Location</Text>
              <TextInput
                style={s.modalInput}
                value={storeAddress}
                onChangeText={setStoreAddress}
                placeholder="e.g. Bole, Addis Ababa, Ethiopia"
                placeholderTextColor="#94A3B8"
              />

              <TouchableOpacity
                onPress={() => setStoreLocationModalVisible(true)}
                style={{ flexDirection: "row", alignItems: "center", marginTop: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: storeCoords ? "#A7F3D0" : "#FDBA74", backgroundColor: storeCoords ? "#ECFDF5" : "#FFF7ED" }}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name={storeCoords ? "map-marker-check" : "map-marker-alert"} size={20} color={storeCoords ? "#047857" : "#C2410C"} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={{ fontSize: 13, fontWeight: "800", color: storeCoords ? "#065F46" : "#9A3412" }}>
                    {storeCoords ? "Store location pinned" : "Pin your store on the map"}
                  </Text>
                  <Text style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>
                    {storeCoords
                      ? `${storeCoords.latitude.toFixed(5)}, ${storeCoords.longitude.toFixed(5)} · tap to change, then Save`
                      : "Required for correct delivery fees and so drivers find your pickup point"}
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[{ marginTop: 12, backgroundColor: TEAL, paddingVertical: 14, borderRadius: 12, alignItems: "center" }, savingStorefront && { opacity: 0.7 }]}
                onPress={handleSaveStoreSettings}
                disabled={savingStorefront}
              >
                {savingStorefront ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={{ fontSize: 14, fontWeight: "800", color: "white" }}>Save Storefront Changes</Text>
                )}
              </TouchableOpacity>
            </View>


            {/* Sign Out Button */}
            <TouchableOpacity
              onPress={() => {
                Alert.alert(
                  "Sign Out",
                  "Are you sure you want to sign out of your merchant account?",
                  [
                    { text: "Cancel", style: "cancel" },
                    { text: "Sign Out", style: "destructive", onPress: signOutUser },
                  ]
                );
              }}
              style={s.signOutBtn}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name="logout" size={20} color="#DC2626" />
              <Text style={s.signOutBtnTxt}>Sign Out of Merchant Account</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {storeLocationModalVisible ? (
        <DeliveryLocationModal
          visible={storeLocationModalVisible}
          onClose={() => setStoreLocationModalVisible(false)}
          initialLocation={storeCoords}
          onConfirmLocation={(loc) => {
            setStoreCoords({ latitude: Number(loc.latitude), longitude: Number(loc.longitude) });
            if (!storeAddress.trim() && loc.address && loc.address !== "My Location, Ethiopia") setStoreAddress(loc.address);
            Alert.alert("Location Selected", "Tap \"Save Storefront Changes\" to publish your store location.");
          }}
        />
      ) : null}

      {/* Add / Edit Product Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={productModalVisible}
        onRequestClose={() => setProductModalVisible(false)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{editingProduct ? "Edit Product" : "Add New Product"}</Text>
              <TouchableOpacity onPress={() => setProductModalVisible(false)}>
                <MaterialCommunityIcons name="close" size={22} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ width: "100%", maxHeight: 440 }}>
              <Text style={s.modalLabel}>Product Name *</Text>
              <TextInput
                style={s.modalInput}
                placeholder="e.g. Classic Beef Burger"
                placeholderTextColor="#94A3B8"
                value={prodName}
                onChangeText={setProdName}
              />

              <Text style={s.modalLabel}>Base / Original Price (ETB) *</Text>
              <TextInput
                style={s.modalInput}
                placeholder="e.g. 350"
                placeholderTextColor="#94A3B8"
                keyboardType="numeric"
                value={prodPrice}
                onChangeText={setProdPrice}
              />

              {/* Discount / Promotion Toggle & Configuration */}
              <View style={[s.modalSwitchRow, { marginTop: 10, marginBottom: 8, backgroundColor: "#F8FAFC", padding: 10, borderRadius: 10, borderWidth: 1, borderColor: "#E2E8F0" }]}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <MaterialCommunityIcons name="tag-outline" size={16} color={hasDiscount ? "#E11D48" : TEAL} />
                    <Text style={[s.modalSwitchTitle, { color: hasDiscount ? "#E11D48" : DARK }]}>Offer Promotional Discount</Text>
                  </View>
                  <Text style={s.modalSwitchSub}>Apply a special reduced selling price</Text>
                </View>
                <Switch
                  value={hasDiscount}
                  onValueChange={setHasDiscount}
                  trackColor={{ false: "#CBD5E1", true: "#E11D48" }}
                  thumbColor="#FFFFFF"
                />
              </View>

              {hasDiscount && (
                <View style={{ backgroundColor: "#FFF1F2", padding: 10, borderRadius: 10, marginBottom: 10, borderWidth: 1, borderColor: "#FECDD3" }}>
                  <Text style={[s.modalLabel, { color: "#9F1239", marginTop: 0 }]}>Discounted Selling Price (ETB) *</Text>
                  <TextInput
                    style={[s.modalInput, { backgroundColor: "#FFFFFF", borderColor: "#FDA4AF" }]}
                    placeholder="e.g. 290"
                    placeholderTextColor="#94A3B8"
                    keyboardType="numeric"
                    value={prodDiscountedPrice}
                    onChangeText={setProdDiscountedPrice}
                  />

                  {/* Live Discount Calculator Preview */}
                  {Number(prodPrice) > 0 && Number(prodDiscountedPrice) > 0 && Number(prodDiscountedPrice) < Number(prodPrice) ? (
                    <View style={{ marginTop: 6, padding: 8, backgroundColor: "#FFFFFF", borderRadius: 8, borderWidth: 1, borderColor: "#FECDD3" }}>
                      <Text style={{ fontSize: 10.5, fontWeight: "700", color: "#9F1239", marginBottom: 3 }}>LIVE CUSTOMER PREVIEW</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ fontSize: 15, fontWeight: "800", color: "#E11D48" }}>
                          ETB {Number(prodDiscountedPrice).toFixed(0)}
                        </Text>
                        <Text style={{ fontSize: 12, color: "#94A3B8", textDecorationLine: "line-through" }}>
                          ETB {Number(prodPrice).toFixed(0)}
                        </Text>
                        <View style={{ backgroundColor: "#FEE2E2", paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 }}>
                          <Text style={{ fontSize: 10.5, fontWeight: "800", color: "#E11D48" }}>
                            -{Math.round(((Number(prodPrice) - Number(prodDiscountedPrice)) / Number(prodPrice)) * 100)}% OFF
                          </Text>
                        </View>
                      </View>
                      <Text style={{ fontSize: 10.5, color: "#166534", marginTop: 3 }}>
                        Customer saves ETB {(Number(prodPrice) - Number(prodDiscountedPrice)).toFixed(2)} per item!
                      </Text>
                    </View>
                  ) : Number(prodDiscountedPrice) >= Number(prodPrice) && Number(prodPrice) > 0 ? (
                    <Text style={{ fontSize: 10.5, color: "#DC2626", marginTop: 4 }}>
                      ⚠️ Discounted price must be lower than original price (ETB {prodPrice}).
                    </Text>
                  ) : null}
                </View>
              )}

              <Text style={s.modalLabel}>Category</Text>
              <View style={s.modalCatRow}>
                {CATEGORIES.filter((c) => c !== "All").map((cat) => {
                  const sel = prodCategory === cat;
                  return (
                    <TouchableOpacity
                      key={cat}
                      onPress={() => setProdCategory(cat)}
                      style={[s.modalCatChip, sel && s.modalCatChipActive]}
                    >
                      <Text style={[s.modalCatTxt, sel && s.modalCatTxtActive]}>{cat}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={s.modalLabel}>Description</Text>
              <TextInput
                style={[s.modalInput, { height: 65, textAlignVertical: "top" }]}
                placeholder="Ingredients, portion size, flavor profile..."
                placeholderTextColor="#94A3B8"
                multiline
                value={prodDesc}
                onChangeText={setProdDesc}
              />

              {/* Item Image * (Required) */}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12, marginBottom: 6 }}>
                <Text style={[s.modalLabel, { marginTop: 0, marginBottom: 0 }]}>Item Image * (Required)</Text>
                {prodImage ? (
                  <TouchableOpacity onPress={() => setProdImage("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={{ fontSize: 12, color: "#EF4444", fontWeight: "600" }}>Remove Image</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              {prodImage ? (
                <View style={s.prodImgPreviewWrap}>
                  <SmartImage
                    uri={prodImage}
                    fallbackType={fallbackType}
                    style={s.prodImgPreview}
                    resizeMode="cover"
                  />
                  <TouchableOpacity
                    style={s.prodImgChangeBtn}
                    activeOpacity={0.85}
                    onPress={pickProductImage}
                  >
                    <MaterialCommunityIcons name="camera-retake-outline" size={16} color="#FFFFFF" />
                    <Text style={s.prodImgChangeTxt}>Change Photo</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={s.prodImgPickerBtn}
                  activeOpacity={0.8}
                  onPress={pickProductImage}
                >
                  <View style={s.prodImgPickerIconCircle}>
                    <MaterialCommunityIcons name="camera-plus" size={24} color={TEAL} />
                  </View>
                  <Text style={s.prodImgPickerTitle}>Upload Item Photo *</Text>
                  <Text style={s.prodImgPickerSub}>Tap to select from device gallery (JPEG, PNG)</Text>
                </TouchableOpacity>
              )}

              {/* Direct image web URL fallback */}
              <View style={{ marginTop: 8 }}>
                <Text style={[s.modalLabel, { fontSize: 11, color: "#64748B", marginBottom: 4, marginTop: 4 }]}>Or Enter Direct Image Web URL</Text>
                <TextInput
                  style={[s.modalInput, { fontSize: 12, height: 40 }]}
                  placeholder="https://example.com/item.jpg"
                  placeholderTextColor="#94A3B8"
                  value={prodImage}
                  onChangeText={setProdImage}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              <View style={s.modalSwitchRow}>
                <View>
                  <Text style={s.modalSwitchTitle}>Available for Ordering</Text>
                  <Text style={s.modalSwitchSub}>Customers can order this item</Text>
                </View>
                <Switch
                  value={prodAvailable}
                  onValueChange={setProdAvailable}
                  trackColor={{ false: "#CBD5E1", true: TEAL }}
                  thumbColor="#FFFFFF"
                />
              </View>
            </ScrollView>

            <View style={s.modalBtnRow}>
              <TouchableOpacity
                onPress={() => setProductModalVisible(false)}
                style={s.modalCancelBtn}
              >
                <Text style={s.modalCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSaveProduct}
                disabled={savingProduct}
                style={s.modalSaveBtn}
              >
                {savingProduct ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={s.modalSaveTxt}>Save Product</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Merchant Reject Order Modal */}
      {merchantRejectModalVisible && (
        <Modal
          visible={merchantRejectModalVisible}
          animationType="fade"
          transparent
          onRequestClose={() => setMerchantRejectModalVisible(false)}
        >
          <View style={s.modalOverlay}>
            <View style={[s.modalCard, { maxWidth: 360 }]}>
              <View style={{ alignItems: "center", marginBottom: 12 }}>
                <MaterialCommunityIcons name="alert-circle-outline" size={36} color="#DC2626" />
                <Text style={[s.modalTitle, { marginTop: 6 }]}>Decline Order</Text>
                <Text style={{ fontSize: 12, color: "#64748B", textAlign: "center", marginTop: 4 }}>
                  Please select or enter the reason for declining Order #{rejectingOrder?.id?.slice(-6)?.toUpperCase()}.
                </Text>
              </View>

              {["Item out of stock", "Kitchen at capacity", "Store closed early", "Special dietary requirement unavailable"].map((r) => (
                <TouchableOpacity
                  key={r}
                  style={{
                    paddingVertical: 9,
                    paddingHorizontal: 12,
                    borderRadius: 8,
                    backgroundColor: merchantRejectReason === r ? "#FEE2E2" : "#F8FAFC",
                    borderWidth: 1,
                    borderColor: merchantRejectReason === r ? "#FCA5A5" : "#E2E8F0",
                    marginBottom: 6,
                  }}
                  onPress={() => setMerchantRejectReason(r)}
                >
                  <Text style={{ fontSize: 12, fontWeight: merchantRejectReason === r ? "800" : "500", color: merchantRejectReason === r ? "#991B1B" : DARK }}>
                    {merchantRejectReason === r ? "✓ " : ""}{r}
                  </Text>
                </TouchableOpacity>
              ))}

              <TextInput
                style={[s.modalInput, { marginTop: 6 }]}
                placeholder="Or specify custom reason..."
                placeholderTextColor="#94A3B8"
                value={merchantRejectReason}
                onChangeText={setMerchantRejectReason}
              />

              <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                <TouchableOpacity
                  style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: "#F1F5F9", alignItems: "center" }}
                  onPress={() => { setMerchantRejectModalVisible(false); setRejectingOrder(null); }}
                  disabled={isRejectingBusy}
                >
                  <Text style={{ fontSize: 13, fontWeight: "700", color: "#64748B" }}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: "#DC2626", alignItems: "center" }}
                  onPress={handleConfirmRejectOrder}
                  disabled={isRejectingBusy}
                >
                  {isRejectingBusy ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text style={{ fontSize: 13, fontWeight: "800", color: "white" }}>Confirm Decline</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
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
    backgroundColor: TEAL,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  headerTopRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerBackBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  headerSubtitleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  headerSubtitle: {
    fontSize: 11,
    color: "#CCFBF1",
    marginLeft: 6,
  },
  approvalPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  approvalApproved: {
    backgroundColor: "#DCFCE7",
  },
  approvalPending: {
    backgroundColor: "#FEF9C3",
  },
  approvalTxt: {
    fontSize: 9,
    fontWeight: "800",
  },
  approvalTxtApproved: {
    color: "#166534",
  },
  approvalTxtPending: {
    color: "#A16207",
  },
  headerRightActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  notificationCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    marginRight: 8,
  },
  storeToggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
  },
  storeOpen: {
    backgroundColor: "rgba(255, 255, 255, 0.25)",
  },
  storeClosed: {
    backgroundColor: "rgba(239, 68, 68, 0.35)",
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 5,
  },
  storeToggleTxt: {
    fontSize: 10,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  tabsBar: {
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#EDF2F1",
    paddingVertical: 8,
  },
  tabsScroll: {
    paddingHorizontal: 14,
  },
  tabItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#F8FAFC",
    marginRight: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  tabItemActive: {
    backgroundColor: "#F0FDF9",
    borderColor: TEAL,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748B",
    marginLeft: 6,
  },
  tabLabelActive: {
    color: TEAL,
  },
  scroll: {
    padding: 16,
    paddingBottom: 40,
  },
  approvalBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF7ED",
    borderRadius: 16,
    padding: 14,
    marginBottom: 14,
    borderLeftWidth: 4,
    borderLeftColor: ORANGE,
  },
  approvalBannerTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: DARK,
  },
  approvalBannerTxt: {
    fontSize: 11,
    color: "#78716C",
    marginTop: 2,
    lineHeight: 16,
  },
  kpiRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
    gap: 8,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "center",
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 4,
    borderWidth: 1,
    borderColor: "#EDF2F1",
  },
  kpiIconBox: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  kpiValue: {
    fontSize: 14,
    fontWeight: "800",
    color: DARK,
  },
  kpiLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#64748B",
    marginTop: 2,
    textAlign: "center",
  },
  filterScrollWrap: {
    marginBottom: 12,
  },
  filterRow: {
    flexDirection: "row",
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginRight: 6,
  },
  filterChipActive: {
    backgroundColor: TEAL,
    borderColor: TEAL,
  },
  filterChipTxt: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748B",
  },
  filterChipTxtActive: {
    color: "#FFFFFF",
  },
  orderCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 5,
    borderWidth: 1,
    borderColor: "#EDF2F1",
  },
  orderCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
    paddingBottom: 10,
    marginBottom: 10,
  },
  orderRefText: {
    fontSize: 14,
    fontWeight: "800",
    color: DARK,
  },
  orderTimeText: {
    fontSize: 11,
    color: "#94A3B8",
    marginTop: 1,
  },
  orderStatusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  orderStatusTxt: {
    fontSize: 11,
    fontWeight: "800",
  },
  customerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  customerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#E6F7F1",
    alignItems: "center",
    justifyContent: "center",
  },
  customerName: {
    fontSize: 13,
    fontWeight: "700",
    color: DARK,
  },
  customerAddress: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 1,
  },
  callBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: TEAL,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  callBtnTxt: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
    marginLeft: 4,
  },
  itemsPreviewBox: {
    backgroundColor: "#F8FAFC",
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  itemLine: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  itemQty: {
    fontSize: 11,
    fontWeight: "800",
    color: TEAL,
    width: 24,
  },
  itemName: {
    flex: 1,
    fontSize: 11,
    fontWeight: "600",
    color: DARK,
  },
  itemPrice: {
    fontSize: 11,
    fontWeight: "700",
    color: "#475569",
  },
  moreItemsTxt: {
    fontSize: 10,
    color: "#94A3B8",
    fontStyle: "italic",
    marginTop: 2,
  },
  orderFooterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 4,
  },
  orderTotalLabel: {
    fontSize: 10,
    color: "#64748B",
  },
  orderTotalValue: {
    fontSize: 14,
    fontWeight: "800",
    color: TEAL,
  },
  paymentPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  paymentPaid: {
    backgroundColor: "#DCFCE7",
  },
  paymentPending: {
    backgroundColor: "#FEF3C7",
  },
  paymentTxt: {
    fontSize: 10,
    fontWeight: "800",
    marginLeft: 4,
  },
  paymentTxtPaid: {
    color: "#166534",
  },
  paymentTxtPending: {
    color: "#B45309",
  },
  actionsRow: {
    flexDirection: "row",
    marginTop: 12,
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBtnPrimary: {
    backgroundColor: TEAL,
  },
  actionBtnDecline: {
    backgroundColor: "#FEE2E2",
  },
  actionBtnTxt: {
    fontSize: 12,
    fontWeight: "800",
  },
  actionBtnTxtPrimary: {
    color: "#FFFFFF",
  },
  actionBtnTxtDecline: {
    color: "#DC2626",
  },
  catalogHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    gap: 8,
  },
  searchWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingHorizontal: 10,
    height: 42,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  searchInput: {
    flex: 1,
    marginLeft: 6,
    fontSize: 12,
    color: DARK,
  },
  addProductBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: TEAL,
    paddingHorizontal: 12,
    height: 42,
    borderRadius: 14,
  },
  addProductBtnTxt: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
    marginLeft: 4,
  },
  catPillRow: {
    paddingVertical: 4,
    marginBottom: 12,
  },
  catChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginRight: 6,
  },
  catChipActive: {
    backgroundColor: "#E6F7F1",
    borderColor: TEAL,
  },
  catChipTxt: {
    fontSize: 11,
    color: "#64748B",
    fontWeight: "600",
  },
  catChipTxtActive: {
    color: TEAL,
    fontWeight: "800",
  },
  productCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 12,
    marginBottom: 12,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 5,
    borderWidth: 1,
    borderColor: "#EDF2F1",
  },
  productCardInner: {
    flexDirection: "row",
  },
  productImage: {
    width: 76,
    height: 76,
    borderRadius: 14,
    backgroundColor: "#F1F5F9",
  },
  productInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: "space-between",
  },
  productName: {
    fontSize: 14,
    fontWeight: "800",
    color: DARK,
    flex: 1,
    marginRight: 6,
  },
  stockBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  inStock: {
    backgroundColor: "#DCFCE7",
  },
  outOfStock: {
    backgroundColor: "#FEE2E2",
  },
  stockBadgeTxt: {
    fontSize: 8,
    fontWeight: "800",
  },
  inStockTxt: {
    color: "#166534",
  },
  outOfStockTxt: {
    color: "#991B1B",
  },
  productDesc: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
    lineHeight: 15,
  },
  productMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
  },
  productPrice: {
    fontSize: 14,
    fontWeight: "800",
    color: TEAL,
  },
  catBadge: {
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 8,
  },
  catBadgeTxt: {
    fontSize: 10,
    color: "#64748B",
    fontWeight: "600",
  },
  productBottomBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  stockToggleWrap: {
    flexDirection: "row",
    alignItems: "center",
  },
  stockToggleLabel: {
    fontSize: 10,
    color: "#64748B",
    marginLeft: 6,
  },
  productBtnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "#E6F7F1",
    borderRadius: 10,
  },
  editBtnTxt: {
    fontSize: 11,
    fontWeight: "700",
    color: TEAL,
    marginLeft: 3,
  },
  deleteBtn: {
    padding: 6,
    backgroundColor: "#FEE2E2",
    borderRadius: 10,
  },
  emptyCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 28,
    alignItems: "center",
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  emptyCenter: {
    padding: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: DARK,
    marginTop: 12,
  },
  emptySub: {
    fontSize: 12,
    color: "#64748B",
    textAlign: "center",
    marginTop: 4,
    lineHeight: 18,
    maxWidth: 260,
  },
  emptyActionBtn: {
    marginTop: 14,
    backgroundColor: TEAL,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
  },
  emptyActionBtnTxt: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 12,
  },
  analyticsHeroCard: {
    backgroundColor: DARK,
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
  },
  analyticsHeroSub: {
    fontSize: 12,
    color: "#A7F3D0",
    fontWeight: "700",
  },
  analyticsHeroAmt: {
    fontSize: 28,
    fontWeight: "900",
    color: "#FFFFFF",
    marginTop: 4,
  },
  analyticsBreakdownRow: {
    flexDirection: "row",
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.15)",
    gap: 8,
  },
  analyticsPill: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    padding: 10,
    borderRadius: 12,
  },
  analyticsPillLabel: {
    fontSize: 10,
    color: "#94A3B8",
  },
  analyticsPillVal: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FFFFFF",
    marginTop: 2,
  },
  guidelinesCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "#EDF2F1",
  },
  guidelinesTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: DARK,
    marginBottom: 12,
  },
  guidelineItem: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  guidelineTxt: {
    fontSize: 12,
    color: "#475569",
    marginLeft: 10,
    flex: 1,
    lineHeight: 16,
  },
  profileCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    overflow: "hidden",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#EDF2F1",
  },
  profileBanner: {
    width: "100%",
    height: 120,
    backgroundColor: "#E2E8F0",
  },
  profileContent: {
    padding: 16,
  },
  profileBusinessName: {
    fontSize: 18,
    fontWeight: "800",
    color: DARK,
  },
  profileBusinessType: {
    fontSize: 12,
    color: TEAL,
    fontWeight: "700",
    marginTop: 2,
    marginBottom: 14,
  },
  profileInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  profileInfoTxt: {
    fontSize: 12,
    color: "#475569",
    marginLeft: 8,
    flex: 1,
  },
  previewStorefrontBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: TEAL,
    borderRadius: 14,
    paddingVertical: 14,
    marginBottom: 12,
  },
  previewStorefrontBtnTxt: {
    fontSize: 13,
    fontWeight: "800",
    color: TEAL,
    marginLeft: 6,
  },
  signOutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FEE2E2",
    borderRadius: 14,
    paddingVertical: 14,
    marginBottom: 20,
  },
  signOutBtnTxt: {
    fontSize: 13,
    fontWeight: "800",
    color: "#DC2626",
    marginLeft: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(11, 42, 38, 0.65)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: 390,
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 20,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: DARK,
  },
  modalLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#475569",
    marginTop: 8,
    marginBottom: 4,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: DARK,
    backgroundColor: "#F8FAFC",
  },
  modalCatRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginVertical: 4,
  },
  modalCatChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#F8FAFC",
  },
  modalCatChipActive: {
    backgroundColor: "#E6F7F1",
    borderColor: TEAL,
  },
  modalCatTxt: {
    fontSize: 10,
    color: "#64748B",
    fontWeight: "600",
  },
  modalCatTxtActive: {
    color: TEAL,
    fontWeight: "800",
  },
  modalSwitchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  modalSwitchTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: DARK,
  },
  modalSwitchSub: {
    fontSize: 10,
    color: "#64748B",
  },
  modalBtnRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
    width: "100%",
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
  },
  modalCancelTxt: {
    color: "#64748B",
    fontWeight: "700",
    fontSize: 13,
  },
  modalSaveBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: TEAL,
    alignItems: "center",
  },
  modalSaveTxt: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 13,
  },
  prodImgPreviewWrap: {
    width: "100%",
    height: 150,
    borderRadius: 14,
    overflow: "hidden",
    position: "relative",
    backgroundColor: "#E2E8F0",
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  prodImgPreview: {
    width: "100%",
    height: "100%",
  },
  prodImgChangeBtn: {
    position: "absolute",
    bottom: 8,
    right: 8,
    backgroundColor: "rgba(11, 42, 38, 0.85)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  prodImgChangeTxt: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  prodImgPickerBtn: {
    width: "100%",
    height: 120,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: TEAL,
    backgroundColor: "#F0FDF4",
    justifyContent: "center",
    alignItems: "center",
    padding: 12,
  },
  prodImgPickerIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#DCFCE7",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 6,
  },
  prodImgPickerTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: DARK,
  },
  prodImgPickerSub: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
    textAlign: "center",
  },
});
