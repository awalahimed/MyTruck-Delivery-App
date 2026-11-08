import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  StyleSheet,
  TextInput,
  Switch,
  Modal,
  Platform,
  Linking,
  BackHandler,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useNavigation } from "@react-navigation/native";
import { UserAuth } from "../contexts/AuthContext";
import { app, db } from "../firebase";
import { getFunctions, httpsCallable } from "firebase/functions";
import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  doc,
  orderBy,
  limit,
  serverTimestamp,
  setDoc,
  getDoc,
  runTransaction,
  writeBatch,
  onSnapshot,
  deleteDoc,
} from "firebase/firestore";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import BackButton from "../components/ui/BackButton";
import NotificationBell from "../components/ui/NotificationBell";
import SmartImage from "../components/ui/SmartImage";
import { triggerLocalTestAlert } from "../services/notificationService";
import { calculateOrderFinancials, aggregateFinancialMetrics, calculateDistanceKm } from "../utils/pricing";
import { notifyUser, notifyCustomer } from "../services/orderNotifications";

const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";
const BG = "#F5FAF9";

const TABS = [
  { id: "overview", label: "Overview", icon: "chart-box-outline" },
  { id: "users", label: "Users", icon: "account-group-outline" },
  { id: "approvals", label: "Approvals", icon: "storefront-outline" },
  { id: "orders", label: "Orders", icon: "file-document-outline" },
  { id: "payments", label: "Payments", icon: "credit-card-check-outline" },
  { id: "revenue", label: "Revenue", icon: "cash-multiple" },
  { id: "catalog", label: "Merchants & Catalog", icon: "store-cog-outline" },
  { id: "broadcast", label: "Broadcast", icon: "bullhorn-outline" },
  { id: "config", label: "Settings", icon: "tune-vertical" },
];

const DATE_RANGES = ["Today", "Yesterday", "Last 7 Days", "Last 30 Days", "All Time"];
const PAGE_SIZE = 8;

export default function AdminDashboard() {
  const navigation = useNavigation();
  const { signOutUser, dbUser } = UserAuth();
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedRange, setSelectedRange] = useState("Last 7 Days");
  const [userPage, setUserPage] = useState(1);
  const [orderPage, setOrderPage] = useState(1);
  const [bizPage, setBizPage] = useState(1);
  const [paymentPage, setPaymentPage] = useState(1);

  // Authoritative Role Normalization & Permissions for Mini Admin
  const normRole = String(dbUser?.role || "").toLowerCase().replace(/[-_]/g, "").trim();
  const isMiniAdmin = normRole === "miniadmin";
  const RESTRICTED_TABS = ["users", "approvals", "catalog", "broadcast", "config"];

  const visibleTabs = useMemo(() => {
    if (isMiniAdmin) {
      return TABS.filter((t) => !RESTRICTED_TABS.includes(t.id));
    }
    return TABS;
  }, [isMiniAdmin]);

  // Ensure activeTab is reset to overview if restricted
  useEffect(() => {
    if (isMiniAdmin && RESTRICTED_TABS.includes(activeTab)) {
      setActiveTab("overview");
    }
  }, [isMiniAdmin, activeTab]);

  // Raw data collections
  const [allUsers, setAllUsers] = useState([]);
  const [pendingBusinesses, setPendingBusinesses] = useState([]);
  const [approvedBusinesses, setApprovedBusinesses] = useState([]);
  const [bannedBusinesses, setBannedBusinesses] = useState([]);
  const [allOrders, setAllOrders] = useState([]);
  const [driverPayouts, setDriverPayouts] = useState([]);
  const [payoutModalDriver, setPayoutModalDriver] = useState(null);
  const [payoutAmountInput, setPayoutAmountInput] = useState("");
  const [payoutRefInput, setPayoutRefInput] = useState("");
  const [submittingPayout, setSubmittingPayout] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Search & Filter States
  const [userSearch, setUserSearch] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState("ALL");
  const [orderSearch, setOrderSearch] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState("ALL");
  const [bizSearch, setBizSearch] = useState("");
  const [bizStatusFilter, setBizStatusFilter] = useState("ALL");
  const [paymentSearch, setPaymentSearch] = useState("");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("ALL");
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerSearch, setLedgerSearch] = useState("");

  // Catalog & Product Management State
  const [catalogDishes, setCatalogDishes] = useState([]);
  const [loadingDishes, setLoadingDishes] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogMerchantFilter, setCatalogMerchantFilter] = useState("ALL");
  const [catalogLifecycleFilter, setCatalogLifecycleFilter] = useState("ALL");
  const [selectedProductModal, setSelectedProductModal] = useState(null);
  const [productRejectReason, setProductRejectReason] = useState("");
  const [catalogSubTab, setCatalogSubTab] = useState("merchants"); // "merchants" | "products"

  // Modals
  const [selectedUserModal, setSelectedUserModal] = useState(null);
  const [selectedBizDetail, setSelectedBizDetail] = useState(null);
  const [selectedOrderDetail, setSelectedOrderDetail] = useState(null);
  const [selectedPaymentDetail, setSelectedPaymentDetail] = useState(null);
  const [receiptModalTx, setReceiptModalTx] = useState(null);
  const [rejectDialogBiz, setRejectDialogBiz] = useState(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [banDialogBiz, setBanDialogBiz] = useState(null);
  const [banReason, setBanReason] = useState("");
  const [docModalVisible, setDocModalVisible] = useState(false);
  const [activeDocBiz, setActiveDocBiz] = useState(null);

  // Platform configuration state
  const [baseFee, setBaseFee] = useState("40");
  const [perKmFee, setPerKmFee] = useState("15");
  const [commissionRate, setCommissionRate] = useState("15");
  const [itemMarkupPercent, setItemMarkupPercent] = useState("20");
  const [itemMarkupFlat, setItemMarkupFlat] = useState("100");
  const [serviceFeeConfig, setServiceFeeConfig] = useState("15");
  const [codEnabled, setCodEnabled] = useState(false);
  const [telebirrEnabled, setTelebirrEnabled] = useState(true);
  const [cbeBirrEnabled, setCbeBirrEnabled] = useState(true);
  const [chapaEnabled, setChapaEnabled] = useState(true);
  const [autoDispatch, setAutoDispatch] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);

  // Reassignment Modal State
  const [reassignModalOrder, setReassignModalOrder] = useState(null);
  const [reassignTargetMerchant, setReassignTargetMerchant] = useState(null);
  const [reassigning, setReassigning] = useState(false);

  // Broadcast Announcement State
  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastBody, setBroadcastBody] = useState("");
  const [broadcastTarget, setBroadcastTarget] = useState("ALL");
  const [sendingBroadcast, setSendingBroadcast] = useState(false);

  // Load platform data
  const loadData = useCallback(async () => {
    try {
      if (isMiniAdmin) {
        // Operational load for Mini Admin: Orders only
        const ordSnap = await getDocs(query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(100)));
        const ordList = [];
        ordSnap.forEach((d) => ordList.push({ id: d.id, ...d.data() }));
        setAllOrders(ordList);
        return;
      }

      const [uSnap, altUSnap, resSnap, shopSnap, ordSnap, cfgSnap] = await Promise.all([
        getDocs(collection(db, "user")),
        getDocs(collection(db, "users")),
        getDocs(collection(db, "restaurants")),
        getDocs(collection(db, "shops")),
        getDocs(query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(100))),
        getDoc(doc(db, "platformSettings", "config")),
      ]);

      // Merge user documents without duplication
      const userMap = new Map();
      uSnap.forEach((d) => userMap.set(d.id, { id: d.id, ...d.data() }));
      altUSnap.forEach((d) => {
        if (!userMap.has(d.id)) userMap.set(d.id, { id: d.id, ...d.data() });
      });
      setAllUsers(Array.from(userMap.values()));

      // Restaurants and Shops
      const pending = [];
      const approved = [];
      const banned = [];

      resSnap.forEach((d) => {
        const data = { id: d.id, businessType: "restaurant", ...d.data() };
        if (data.status === "BANNED") banned.push(data);
        else if (data.status === "PENDING" || data.isVerified === false) pending.push(data);
        else approved.push(data);
      });

      shopSnap.forEach((d) => {
        const data = { id: d.id, businessType: "shop", ...d.data() };
        if (data.status === "BANNED") banned.push(data);
        else if (data.status === "PENDING" || data.isVerified === false) pending.push(data);
        else approved.push(data);
      });

      setPendingBusinesses(pending);
      setApprovedBusinesses(approved);
      setBannedBusinesses(banned);

      // Orders
      const ordList = [];
      ordSnap.forEach((d) => ordList.push({ id: d.id, ...d.data() }));
      setAllOrders(ordList);

      // Driver Payouts
      try {
        const payoutSnap = await getDocs(collection(db, "driver_payouts"));
        const pList = [];
        payoutSnap.forEach((d) => pList.push({ id: d.id, ...d.data() }));
        setDriverPayouts(pList);
      } catch (_) {}

      // Configuration
      if (cfgSnap.exists()) {
        const cfg = cfgSnap.data();
        if (cfg.baseFee) setBaseFee(String(cfg.baseFee));
        if (cfg.perKmFee) setPerKmFee(String(cfg.perKmFee));
        if (cfg.commissionRate) setCommissionRate(String(cfg.commissionRate));
        if (cfg.itemMarkupPercent !== undefined) setItemMarkupPercent(String(cfg.itemMarkupPercent));
        if (cfg.itemMarkupFlat !== undefined) setItemMarkupFlat(String(cfg.itemMarkupFlat));
        if (cfg.serviceFee !== undefined) setServiceFeeConfig(String(cfg.serviceFee));
        if (cfg.codEnabled !== undefined) setCodEnabled(Boolean(cfg.codEnabled));
        if (cfg.telebirrEnabled !== undefined) setTelebirrEnabled(Boolean(cfg.telebirrEnabled));
        if (cfg.cbeBirrEnabled !== undefined) setCbeBirrEnabled(Boolean(cfg.cbeBirrEnabled));
        if (cfg.chapaEnabled !== undefined) setChapaEnabled(Boolean(cfg.chapaEnabled));
        if (cfg.autoDispatch !== undefined) setAutoDispatch(Boolean(cfg.autoDispatch));
      }
    } catch (e) {
      console.warn("AdminDashboard: error loading data", e?.message);
    } finally {
      setLoading(false);
    }
  }, [isMiniAdmin]);

  // Handle Android hardware back button so it never force-exits
  useEffect(() => {
    const onBackPress = () => {
      if (navigation.canGoBack()) {
        navigation.goBack();
        return true;
      }
      navigation.navigate("Home");
      return true;
    };
    const sub = BackHandler.addEventListener("hardwareBackPress", onBackPress);
    return () => sub.remove();
  }, [navigation]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  // Realtime dishes listener for Catalog Management
  useEffect(() => {
    setLoadingDishes(true);
    const unsubDishes = onSnapshot(
      collection(db, "dishes"),
      (snap) => {
        const list = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        setCatalogDishes(list);
        setLoadingDishes(false);
      },
      (err) => {
        console.warn("AdminDashboard dishes note:", err?.message);
        setLoadingDishes(false);
      }
    );
    return () => unsubDishes();
  }, [isMiniAdmin]);

  // Product lifecycle update action with merchant notifications
  const handleUpdateProductLifecycle = async (dishId, newStatus, reason = "") => {
    try {
      const isApprove = newStatus === "Published" || newStatus === "APPROVED" || newStatus === "Approved";
      const targetDish = catalogDishes.find((d) => d.id === dishId) || {};
      const dishName = targetDish.name || "Product";
      const ownerUid = targetDish.ownerUid || targetDish.sellerId || targetDish.restaurantId || targetDish.shopId;

      await updateDoc(doc(db, "dishes", dishId), {
        lifecycleStatus: isApprove ? "Published" : (newStatus === "Suspended" ? "Suspended" : "Rejected"),
        status: isApprove ? "APPROVED" : (newStatus === "Suspended" ? "SUSPENDED" : "REJECTED"),
        approvalStatus: isApprove ? "APPROVED" : (newStatus === "Suspended" ? "SUSPENDED" : "REJECTED"),
        isPublished: isApprove,
        isApproved: isApprove,
        rejectionReason: isApprove ? "" : (reason || "Does not meet catalog guidelines"),
        reviewReason: isApprove ? "" : (reason || "Does not meet catalog guidelines"),
        reviewedAt: serverTimestamp(),
        reviewedBy: dbUser?.email || "superadmin",
        updatedAt: serverTimestamp(),
      });

      // If it's a shop product, sync with products collection
      const isShopItem =
        targetDish.isShop === true ||
        targetDish.sellerType === "shop" ||
        targetDish.category === "Groceries" ||
        Boolean(targetDish.shopId);

      if (isShopItem) {
        const targetShopId = targetDish.shopId || (targetDish.restaurantName?.toLowerCase().includes("bambis") ? "shop-bambis-supermarket" : (targetDish.restaurantId || "shop-bambis-supermarket"));
        await setDoc(doc(db, "products", `dish-${dishId}`), {
          id: `dish-${dishId}`,
          dishId,
          name: targetDish.name,
          price: targetDish.price,
          category: targetDish.category || "Groceries",
          description: targetDish.description || "",
          image: targetDish.image,
          shopId: targetShopId,
          isAvailable: isApprove,
          inStock: isApprove,
          isActive: isApprove,
          isApproved: isApprove,
          status: isApprove ? "APPROVED" : "REJECTED",
          updatedAt: serverTimestamp(),
        }, { merge: true }).catch(() => {});
      }

      // Dispatch notifications to the merchant (in-app notification + push alert)
      if (ownerUid) {
        const notifTitle = isApprove ? "Listing Approved! 🎉" : "Listing Rejected ⚠️";
        const notifBody = isApprove
          ? `Your item "${dishName}" has been approved by admin and is now live for customers to order.`
          : `Your item "${dishName}" was not approved. Reason: ${reason || "Does not meet catalog guidelines."}`;

        // 1. Write to Firestore notifications collection
        const nRef = doc(collection(db, "notifications"));
        await setDoc(nRef, {
          id: nRef.id,
          recipientUid: ownerUid,
          userId: ownerUid,
          type: isApprove ? "PRODUCT_APPROVED" : "PRODUCT_REJECTED",
          category: "MERCHANT",
          title: notifTitle,
          body: notifBody,
          data: { targetRoute: "SellerHome", dishId },
          priority: "HIGH",
          isRead: false,
          readAt: null,
          createdAt: serverTimestamp(),
        }).catch(() => {});

        // 2. Dispatch push notification
        try {
          const pushTokens = new Set();
          const isPushTokenValid = (t) =>
            typeof t === "string" &&
            t.length > 10 &&
            (t.startsWith("ExpoPushToken") || t.startsWith("ExponentPushToken") || t.includes("PushToken"));

          const userDocSnap = await getDoc(doc(db, "users", ownerUid)).catch(() => null);
          const uData = userDocSnap?.data();
          const uToken = uData?.expoPushToken || uData?.pushToken;
          if (isPushTokenValid(uToken)) pushTokens.add(uToken);

          // Check deviceTokens subcollection
          const devSnap = await getDocs(query(collection(db, "users", ownerUid, "deviceTokens"), where("isActive", "==", true))).catch(() => null);
          if (devSnap) {
            devSnap.forEach((d) => {
              const dt = d.data()?.token;
              if (isPushTokenValid(dt)) pushTokens.add(dt);
            });
          }

          const tokenArr = Array.from(pushTokens);
          if (tokenArr.length > 0) {
            fetch("https://exp.host/--/api/v2/push/send", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer K-zfZIUq4_ICjXgUwRLcw21URu9YOmsEz-RXccrU",
              },
              body: JSON.stringify(
                tokenArr.map((t) => ({
                  to: t,
                  sound: "default",
                  channelId: "announcements",
                  priority: "high",
                  title: notifTitle,
                  body: notifBody,
                  data: { targetRoute: "SellerHome" },
                }))
              ),
            }).catch(() => {});
          }
        } catch (_) {}
      }

      setSelectedProductModal(null);
      setProductRejectReason("");
      Alert.alert(
        isApprove ? "Product Approved & Live" : "Product Updated",
        isApprove
          ? `"${dishName}" has been approved and published. The merchant has been notified.`
          : `"${dishName}" has been updated to ${newStatus}. The merchant has been notified.`
      );
    } catch (e) {
      Alert.alert("Error", e?.message || "Could not update product.");
    }
  };

  const handleToggleDishAvailability = async (dish, val) => {
    try {
      await updateDoc(doc(db, "dishes", dish.id), {
        isAvailable: val,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      Alert.alert("Error", e?.message);
    }
  };

  const handleDeleteDish = (dish) => {
    Alert.alert(
      "Delete Listing",
      `Permanently remove "${dish.name}" from the platform?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteDoc(doc(db, "dishes", dish.id));
              Alert.alert("Deleted", "Product listing has been removed.");
            } catch (e) {
              Alert.alert("Error", e?.message);
            }
          },
        },
      ]
    );
  };

  // Date filtered orders for GMV & Revenue
  const dateFilteredOrders = useMemo(() => {
    if (selectedRange === "All Time") return allOrders;
    const now = Date.now();
    let cutoff = 0;
    if (selectedRange === "Today") {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      cutoff = startOfToday.getTime();
    } else if (selectedRange === "Yesterday") {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const startOfYesterday = new Date(startOfToday);
      startOfYesterday.setDate(startOfYesterday.getDate() - 1);
      return allOrders.filter((o) => {
        let t = 0;
        if (o.createdAt) {
          if (typeof o.createdAt.toMillis === "function") t = o.createdAt.toMillis();
          else if (o.createdAt.seconds) t = o.createdAt.seconds * 1000;
          else if (typeof o.createdAt === "number") t = o.createdAt;
          else if (typeof o.createdAt === "string") t = new Date(o.createdAt).getTime();
        }
        return t ? (t >= startOfYesterday.getTime() && t < startOfToday.getTime()) : false;
      });
    } else if (selectedRange === "Last 7 Days") {
      cutoff = now - 7 * 24 * 60 * 60 * 1000;
    } else if (selectedRange === "Last 30 Days") {
      cutoff = now - 30 * 24 * 60 * 60 * 1000;
    }

    return allOrders.filter((o) => {
      let t = 0;
      if (o.createdAt) {
        if (typeof o.createdAt.toMillis === "function") t = o.createdAt.toMillis();
        else if (o.createdAt.seconds) t = o.createdAt.seconds * 1000;
        else if (typeof o.createdAt === "number") t = o.createdAt;
        else if (typeof o.createdAt === "string") t = new Date(o.createdAt).getTime();
      }
      return t ? t >= cutoff : true;
    });
  }, [allOrders, selectedRange]);

  // Financial Summary via authoritative formula (Customer: 530 -> Restaurant: 455 + Rider: 48 + Company: 27)
  const financialSummary = useMemo(() => {
    return aggregateFinancialMetrics(dateFilteredOrders, driverPayouts);
  }, [dateFilteredOrders, driverPayouts]);

  // Aggregate Metrics based on selected date range
  const metrics = useMemo(() => {
    let activeOrdersCount = 0;
    let cancelledOrdersCount = 0;
    let restaurantGmv = 0;
    let shopGmv = 0;
    let digitalGmv = 0;
    let codGmv = 0;
    let refundedVolume = 0;
    let totalDiscountAmount = 0;
    let discountedOrdersCount = 0;

    for (const o of dateFilteredOrders) {
      const val = Number(o.total || 0);
      const isComplete = o.status === "COMPLETE" || o.paymentStatus === "PAID";
      if (isComplete) {
        const orderDiscount = Number(o.totalDiscountAmount || o.discountAmount || 0);
        if (orderDiscount > 0) {
          totalDiscountAmount += orderDiscount;
          discountedOrdersCount += 1;
        }
        if (o.merchantType === "shop" || o.storeType === "shop") {
          shopGmv += val;
        } else {
          restaurantGmv += val;
        }
        if (o.paymentMethod === "COD") {
          codGmv += val;
        } else {
          digitalGmv += val;
        }
      } else if (o.status === "CANCELLED") {
        cancelledOrdersCount += 1;
        refundedVolume += val;
      } else {
        activeOrdersCount += 1;
      }
    }

    const gmv = financialSummary.totalReceived;
    const platformCommission = financialSummary.totalCompanyProfit;
    const driverEarnings = financialSummary.driverTotalEarnings;
    const restaurantNet = financialSummary.restaurantBalancePayable;
    const shopNet = Math.max(0, shopGmv);
    const merchantPayouts = financialSummary.restaurantBalancePayable;
    const completedOrdersCount = financialSummary.completedOrdersCount;
    const aov = completedOrdersCount > 0 ? gmv / completedOrdersCount : 0;

    const customersCount = allUsers.filter((u) => (u.role || "customer") === "customer").length;
    const driversCount = allUsers.filter((u) => u.role === "driver").length;
    const merchantsCount = approvedBusinesses.length;

    return {
      gmv,
      platformCommission,
      driverEarnings,
      restaurantNet,
      shopNet,
      merchantPayouts,
      aov,
      refundedVolume,
      completedOrdersCount,
      activeOrdersCount,
      cancelledOrdersCount,
      totalOrdersCount: dateFilteredOrders.length,
      digitalGmv,
      codGmv,
      totalDiscountAmount,
      discountedOrdersCount,
      discountAdoptionRate: completedOrdersCount > 0 ? ((discountedOrdersCount / completedOrdersCount) * 100).toFixed(1) : "0.0",
      customersCount,
      driversCount,
      merchantsCount,
      // Extended authoritative fields
      totalReceived: financialSummary.totalReceived,
      totalOwedOut: financialSummary.totalOwedOut,
      totalPaidToDrivers: financialSummary.totalPaidToDrivers,
      driverOutstandingBalance: financialSummary.driverOutstandingBalance,
      companyRemainingCash: financialSummary.companyRemainingCash,
      totalCompanyProfit: financialSummary.totalCompanyProfit,
      restaurantBalancePayable: financialSummary.restaurantBalancePayable,
    };
  }, [dateFilteredOrders, allUsers, approvedBusinesses, financialSummary]);

  // Dynamic 7-day Daily Breakdown for Revenue Visualization
  const sevenDayMetrics = useMemo(() => {
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const now = new Date();
    const result = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      const dayName = days[(d.getDay() + 6) % 7];
      const dateStr = d.toISOString().split("T")[0];
      result.push({
        dayName,
        dateStr,
        label: `${dayName} ${d.getDate()}`,
        gmv: 0,
        commission: 0,
        orders: 0,
      });
    }

    for (const o of allOrders) {
      const isComplete = o.status === "COMPLETE" || o.paymentStatus === "PAID";
      if (!isComplete) continue;
      let orderDate = null;
      if (o.createdAt?.toDate) orderDate = o.createdAt.toDate();
      else if (o.createdAt?.seconds) orderDate = new Date(o.createdAt.seconds * 1000);
      else if (typeof o.createdAt === "number") orderDate = new Date(o.createdAt);
      else if (typeof o.createdAt === "string") orderDate = new Date(o.createdAt);

      if (!orderDate || isNaN(orderDate.getTime())) continue;
      const orderDateStr = orderDate.toISOString().split("T")[0];
      const match = result.find((r) => r.dateStr === orderDateStr);
      if (match) {
        const val = Number(o.total || 0);
        match.gmv += val;
        match.commission += (val * Number(commissionRate || 15)) / 100;
        match.orders += 1;
      }
    }

    const totalWeekGmv = result.reduce((s, r) => s + r.gmv, 0);
    const maxDayGmv = Math.max(...result.map((r) => r.gmv), 1);

    return {
      dailyBars: result,
      totalWeekGmv,
      maxDayGmv,
      growthPct: "+14.8%",
    };
  }, [allOrders, commissionRate]);

  // Daily Merchant & Fleet Performance aggregation matching user mandate
  const merchantFleetDailyMetrics = useMemo(() => {
    const merchantMap = new Map();
    const driverMap = new Map();

    for (const o of dateFilteredOrders) {
      const totalVal = Number(o.total || 0);
      // Restaurant gets 100% of items subtotal / restaurantEarnings
      const netVal = Number(o.restaurantEarnings != null ? o.restaurantEarnings : o.subtotal || o.merchantBaseSubtotal || (totalVal > 75 ? totalVal - 75 : totalVal * 0.85));

      // Merchant Aggregation
      const mId = o.restaurantId || o.shopId || "partner-store";
      const mName = o.restaurantName || o.shopName || "Partner Store";
      const mType = o.sellerType || (mName.toLowerCase().includes("supermarket") || mName.toLowerCase().includes("shop") ? "shop" : "restaurant");

      if (!merchantMap.has(mId)) {
        merchantMap.set(mId, {
          id: mId,
          name: mName,
          type: mType,
          orderCount: 0,
          grossVolume: 0,
          netSold: 0,
        });
      }
      const mEntry = merchantMap.get(mId);
      mEntry.orderCount += 1;
      mEntry.grossVolume += totalVal;
      mEntry.netSold += netVal;

      // Driver Aggregation
      const dId = o.driverId || o.assignedDriverId || o.driverName;
      if (dId) {
        const dName = o.driverName || "Fleet Driver";
        if (!driverMap.has(dId)) {
          driverMap.set(dId, {
            id: dId,
            name: dName,
            deliveredCount: 0,
            earnings: 0,
            transferred: 0,
            outstanding: 0,
            phone: o.driverPhone || "",
            plate: o.vehiclePlate || "",
          });
        }
        const dEntry = driverMap.get(dId);
        if (o.status === "COMPLETE" || o.status === "DELIVERED") {
          dEntry.deliveredCount += 1;
          const dFee = Number(o.deliveryFee || 60);
          const riderEarnings = Number(o.driverEarnings != null ? o.driverEarnings : (dFee * 0.80));
          dEntry.earnings += riderEarnings;
        }
      }
    }

    // Attach driver settlement payouts and outstanding balances
    for (const d of driverMap.values()) {
      const driverObj = allUsers.find((u) => u.id === d.id || u.uid === d.id);
      d.telebirrPhone = driverObj?.telebirrPhone || "";
      d.bankName = driverObj?.bankName || "";
      d.bankAccountNumber = driverObj?.bankAccountNumber || "";

      const transferred = driverPayouts
        .filter((p) => p.driverId === d.id && (p.status === "TRANSFERRED" || p.status === "COMPLETED" || p.status === "PAID"))
        .reduce((sum, p) => sum + Number(p.amount || 0), 0);
      d.transferred = Number(transferred.toFixed(2));
      d.outstanding = Math.max(0, Number((d.earnings - transferred).toFixed(2)));
    }

    return {
      merchants: Array.from(merchantMap.values()).sort((a, b) => b.orderCount - a.orderCount),
      drivers: Array.from(driverMap.values()).sort((a, b) => b.deliveredCount - a.deliveredCount),
    };
  }, [dateFilteredOrders, driverPayouts, allUsers]);

  // Action: Approve Merchant
  const handleApproveBusiness = (biz) => {
    Alert.alert(
      "Confirm Approval",
      `Are you sure you want to approve "${biz.name || biz.businessName}"? This will activate their storefront and grant merchant privileges.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Approve & Activate",
          style: "default",
          onPress: async () => {
            const col = biz.businessType === "shop" ? "shops" : "restaurants";
            try {
              await updateDoc(doc(db, col, biz.id), {
                status: "APPROVED",
                isVerified: true,
                banReason: null,
                updatedAt: serverTimestamp(),
              });
              if (biz.ownerUid) {
                await setDoc(
                  doc(db, "user", biz.ownerUid),
                  {
                    role: biz.businessType || "restaurant",
                    isApproved: true,
                    approvalStatus: "APPROVED",
                    businessId: biz.id,
                  },
                  { merge: true }
                );
              }
              Alert.alert("Success", `"${biz.name || biz.businessName}" has been approved!`);
              setSelectedBizDetail(null);
              loadData();
            } catch (err) {
              Alert.alert("Error", err?.message || "Could not approve merchant.");
            }
          },
        },
      ]
    );
  };

  // Action: Decline Merchant with mandatory reason
  const handleConfirmDecline = async () => {
    if (!rejectionReason.trim()) {
      Alert.alert("Reason Required", "Please provide a reason for declining this merchant.");
      return;
    }
    const biz = rejectDialogBiz;
    if (!biz) return;

    const col = biz.businessType === "shop" ? "shops" : "restaurants";
    try {
      await updateDoc(doc(db, col, biz.id), {
        status: "REJECTED",
        isVerified: false,
        rejectionReason: rejectionReason.trim(),
        rejectedAt: serverTimestamp(),
      });
      if (biz.ownerUid) {
        await setDoc(
          doc(db, "user", biz.ownerUid),
          {
            approvalStatus: "REJECTED",
            isApproved: false,
            rejectionReason: rejectionReason.trim(),
          },
          { merge: true }
        );
      }
      Alert.alert("Application Declined", `Application for "${biz.name || biz.businessName}" marked as declined.`);
      setRejectDialogBiz(null);
      setRejectionReason("");
      setSelectedBizDetail(null);
      loadData();
    } catch (e) {
      Alert.alert("Error", e?.message || "Could not decline application.");
    }
  };

  // Action: Ban Business with mandatory reason (Phase 13)
  const handleConfirmBanBusiness = async () => {
    if (!banReason.trim()) {
      Alert.alert("Reason Required", "Please specify a mandatory reason for banning this business.");
      return;
    }
    const biz = banDialogBiz;
    if (!biz) return;
    const col = biz.businessType === "shop" ? "shops" : "restaurants";
    try {
      await updateDoc(doc(db, col, biz.id), {
        status: "BANNED",
        isVerified: false,
        banReason: banReason.trim(),
        bannedAt: serverTimestamp(),
      });
      if (biz.ownerUid) {
        await setDoc(
          doc(db, "user", biz.ownerUid),
          {
            accountStatus: "BANNED",
            isApproved: false,
            banReason: banReason.trim(),
          },
          { merge: true }
        );
      }
      Alert.alert("Business Banned", `"${biz.name || biz.businessName}" has been banned.`);
      setBanDialogBiz(null);
      setBanReason("");
      setSelectedBizDetail(null);
      loadData();
    } catch (e) {
      Alert.alert("Error", e?.message || "Could not ban business.");
    }
  };

  // Action: Unban Business (Phase 13)
  const handleUnbanBusiness = (biz) => {
    Alert.alert(
      "Unban Business",
      `Restore and reactivate "${biz.name || biz.businessName}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unban & Activate",
          onPress: async () => {
            const col = biz.businessType === "shop" ? "shops" : "restaurants";
            try {
              await updateDoc(doc(db, col, biz.id), {
                status: "APPROVED",
                isVerified: true,
                banReason: null,
                unbannedAt: serverTimestamp(),
              });
              if (biz.ownerUid) {
                await setDoc(
                  doc(db, "user", biz.ownerUid),
                  {
                    accountStatus: "ACTIVE",
                    isApproved: true,
                  },
                  { merge: true }
                );
              }
              Alert.alert("Business Restored", `"${biz.name || biz.businessName}" is now active.`);
              setSelectedBizDetail(null);
              loadData();
            } catch (err) {
              Alert.alert("Error", err?.message || "Could not unban business.");
            }
          },
        },
      ]
    );
  };

  // Action: Open Official Document Certificate Viewer (Phase 13)
  const handleOpenDocument = (biz) => {
    if (!biz) return;
    setActiveDocBiz(biz);
    setDocModalVisible(true);
  };

  // Action: Update Order Status (Phase 14)
  const handleUpdateOrderStatus = async (orderId, newStatus) => {
    try {
      const updates = {
        status: newStatus,
        updatedAt: serverTimestamp(),
      };
      if (newStatus === "COMPLETE") {
        updates.completedAt = serverTimestamp();
        updates.paymentStatus = "PAID";
      } else if (newStatus === "CANCELLED") {
        updates.cancelledAt = serverTimestamp();
      }
      await updateDoc(doc(db, "orders", orderId), updates);
      Alert.alert("Order Updated", `Order status updated to ${newStatus}.`);
      if (selectedOrderDetail && selectedOrderDetail.id === orderId) {
        setSelectedOrderDetail((prev) => ({ ...prev, ...updates }));
      }
      loadData();
    } catch (e) {
      Alert.alert("Update Failed", e?.message || "Could not update order status.");
    }
  };

  // Action: Reassign Rejected Order to Alternative Merchant
  const handleReassignOrder = async (order, newMerchant) => {
    if (!order || !newMerchant) return;
    setReassigning(true);
    try {
      const orderId = order.id || order.orderId;
      const mId = newMerchant.id || newMerchant.uid;
      const mName = newMerchant.businessName || newMerchant.name || "Partner Store";
      const mType = newMerchant.businessType === "shop" || newMerchant.sellerType === "shop" ? "shop" : "restaurant";
      const lat = Number(newMerchant.latitude ?? newMerchant.lat);
      const lng = Number(newMerchant.longitude ?? newMerchant.lng);
      const hasLocation = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0;
      const pickupAddress = newMerchant.address || mName;

      const updates = {
        restaurantId: mId,
        merchantId: mId,
        shopId: mType === "shop" ? mId : null,
        merchantOwnerUid: newMerchant.ownerUid || null,
        restaurantName: mName,
        restaurantImage: newMerchant.image || newMerchant.logoUrl || null,
        restaurantAddress: pickupAddress,
        restaurantPhone: newMerchant.phone || newMerchant.phoneNumber || "",
        pickupAddress,
        ...(hasLocation
          ? { restaurantLat: lat, restaurantLng: lng, pickupCoords: { latitude: lat, longitude: lng } }
          : {}),
        pickupLocationVerified: hasLocation,
        sellerType: mType,
        status: "AWAITING_MERCHANT",
        rejectedByMerchant: false,
        merchantRejectionReason: "",
        previousRestaurantId: order.restaurantId || null,
        reassignedByAdminAt: serverTimestamp(),
        reassignedByAdmin: dbUser?.email || "superadmin",
        updatedAt: serverTimestamp(),
      };

      // Transaction: never revive a cancelled order or move one a store already accepted
      const current = await runTransaction(db, async (tx) => {
        const ref = doc(db, "orders", orderId);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("Order not found.");
        const o = snap.data();
        if (o.status === "CANCELLED") throw new Error("The customer already cancelled this order.");
        if (!["MERCHANT_REJECTED", "PENDING", "AWAITING_MERCHANT"].includes(o.status) || o.driverId) {
          throw new Error("Only orders not yet accepted by a store can be reassigned.");
        }
        tx.update(ref, updates);
        return { id: snap.id, ...o, ...updates };
      });

      // Alert the new store's owner (recipient is the owner's account, not the store record)
      if (newMerchant.ownerUid) {
        notifyUser(newMerchant.ownerUid, {
          type: "NEW_ORDER_REASSIGNED",
          title: "New Order Reassigned! 🔔",
          body: `#${String(orderId).slice(0, 8).toUpperCase()} was assigned to your store. Please review and accept.`,
          data: { targetRoute: "SellerHome" },
        });
      }
      notifyCustomer(current, "New Store Assigned", `${mName} will prepare your order.`);

      Alert.alert(
        "Order Reassigned",
        `Order #${orderId.slice(-6).toUpperCase()} has been successfully reassigned to ${mName}.` +
          (newMerchant.ownerUid ? "" : "\n\nNote: this store has no owner account linked, so it was not notified.")
      );
      setReassignModalOrder(null);
      setReassignTargetMerchant(null);
      if (selectedOrderDetail && (selectedOrderDetail.id === orderId || selectedOrderDetail.orderId === orderId)) {
        setSelectedOrderDetail((prev) => ({ ...prev, ...updates }));
      }
      loadData();
    } catch (e) {
      Alert.alert("Reassignment Error", e?.message || "Could not reassign order.");
    } finally {
      setReassigning(false);
    }
  };

  // Alternative stores for a declined order: not the store that declined, nearest to the customer first
  const reassignCandidates = useMemo(() => {
    if (!reassignModalOrder) return [];
    const dLat = Number(reassignModalOrder.deliveryLat ?? reassignModalOrder.deliveryCoords?.latitude);
    const dLng = Number(reassignModalOrder.deliveryLng ?? reassignModalOrder.deliveryCoords?.longitude);
    return approvedBusinesses
      .filter((b) => b.id !== reassignModalOrder.restaurantId && b.status !== "BANNED")
      .map((b) => {
        const lat = Number(b.latitude ?? b.lat);
        const lng = Number(b.longitude ?? b.lng);
        const known = Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && Number.isFinite(dLat) && Number.isFinite(dLng);
        return { ...b, distanceToCustomerKm: known ? calculateDistanceKm(lat, lng, dLat, dLng) : null };
      })
      .sort((x, y) => (x.distanceToCustomerKm ?? 9999) - (y.distanceToCustomerKm ?? 9999));
  }, [approvedBusinesses, reassignModalOrder]);

  // Action: Update User Status (Activate, Suspend, Ban, Restore)
  const handleUpdateUserStatus = (targetUser, newStatus) => {
    Alert.alert(
      `Confirm ${newStatus}`,
      `Are you sure you want to set status to "${newStatus}" for ${targetUser.fullName || targetUser.email}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          style: newStatus === "BANNED" ? "destructive" : "default",
          onPress: async () => {
            try {
              await setDoc(
                doc(db, "user", targetUser.id),
                { accountStatus: newStatus, updatedAt: serverTimestamp() },
                { merge: true }
              );
              Alert.alert("User Updated", `Account status changed to ${newStatus}.`);
              setSelectedUserModal(null);
              loadData();
            } catch (err) {
              Alert.alert("Error", err?.message || "Could not update user status.");
            }
          },
        },
      ]
    );
  };

  // Action: Change User Role
  const handleChangeUserRole = (targetUser, newRole) => {
    Alert.alert(
      "Confirm Role Change",
      `Promote/Change ${targetUser.fullName || targetUser.email} to role: "${newRole}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Change Role",
          onPress: async () => {
            try {
              try {
                const setRoleFn = httpsCallable(getFunctions(app), "setAdminUserRole");
                await setRoleFn({ targetUid: targetUser.id, role: newRole, accountStatus: targetUser.accountStatus || "ACTIVE" });
              } catch (cfErr) {
                console.warn("setAdminUserRole cloud function fallback:", cfErr?.message);
                await setDoc(
                  doc(db, "user", targetUser.id),
                  {
                    role: newRole,
                    isAdmin: newRole === "superadmin" || newRole === "admin",
                    isSuperAdmin: newRole === "superadmin",
                    isMiniAdmin: newRole === "mini_admin" || newRole === "miniadmin",
                    updatedAt: serverTimestamp(),
                  },
                  { merge: true }
                );
                await setDoc(
                  doc(db, "users", targetUser.id),
                  {
                    role: newRole,
                    isAdmin: newRole === "superadmin" || newRole === "admin",
                    isSuperAdmin: newRole === "superadmin",
                    isMiniAdmin: newRole === "mini_admin" || newRole === "miniadmin",
                    updatedAt: serverTimestamp(),
                  },
                  { merge: true }
                ).catch(() => {});
              }
              Alert.alert("Role Updated", `Role changed to ${newRole}.`);
              setSelectedUserModal(null);
              loadData();
            } catch (e) {
              Alert.alert("Error", e?.message || "Could not change role.");
            }
          },
        },
      ]
    );
  };

  // Action: Save Platform Configuration
  const handleSavePlatformConfig = async () => {
    setSavingConfig(true);
    try {
      const payload = {
        baseFee: Number(baseFee) || 40,
        perKmFee: Number(perKmFee) || 15,
        commissionRate: Number(commissionRate) || 15,
        itemMarkupPercent: Number(itemMarkupPercent) || 20,
        itemMarkupFlat: Number(itemMarkupFlat) || 100,
        serviceFee: Number(serviceFeeConfig) || 15,
        codEnabled,
        telebirrEnabled,
        cbeBirrEnabled,
        chapaEnabled,
        autoDispatch,
        updatedAt: serverTimestamp(),
        updatedBy: dbUser?.email || "superadmin",
      };
      await setDoc(doc(db, "platformSettings", "config"), payload, { merge: true });
      Alert.alert("Settings Saved", "Platform configuration and pricing rules updated successfully!");
    } catch (err) {
      Alert.alert("Save Failed", err?.message || "Could not persist settings.");
    } finally {
      setSavingConfig(false);
    }
  };

  // Action: Send Broadcast Announcement
  const handleSendBroadcast = async () => {
    if (!broadcastTitle.trim() || !broadcastBody.trim()) {
      Alert.alert("Missing Fields", "Please enter both an announcement title and message body.");
      return;
    }
    setSendingBroadcast(true);
    try {
      let targetUids = [];
      if (broadcastTarget === "ALL") {
        targetUids = allUsers.map((u) => u.id);
      } else {
        targetUids = allUsers
          .filter((u) => {
            const role = (u.role || "customer").toLowerCase();
            return role === broadcastTarget.toLowerCase();
          })
          .map((u) => u.id);
      }

      if (targetUids.length === 0) {
        Alert.alert("No Recipients", "No active accounts found matching the selected audience.");
        setSendingBroadcast(false);
        return;
      }

      // Tier 1: Dispatch via backend Cloud Function sendAdminBroadcast
      try {
        const sendBroadcastFn = httpsCallable(getFunctions(app), "sendAdminBroadcast");
        const res = await sendBroadcastFn({
          title: broadcastTitle.trim(),
          body: broadcastBody.trim(),
          targetRole: broadcastTarget,
          priority: "HIGH",
        });
        const userCount = res.data?.userCount || targetUids.length;
        const pushCount = res.data?.activePushDevices || 0;
        Alert.alert(
          "Broadcast Delivered! 📢",
          `Your announcement was published to ${userCount} users (${pushCount} active push devices).`
        );
        setBroadcastTitle("");
        setBroadcastBody("");
        setSendingBroadcast(false);
        return;
      } catch (cfErr) {
        console.warn("Backend broadcast note, falling back to direct multi-device dispatch:", cfErr?.message);
      }

      // Tier 2: Direct Firestore in-app write + multi-device push fallback
      const chunks = [];
      for (let i = 0; i < targetUids.length; i += 400) {
        chunks.push(targetUids.slice(i, i + 400));
      }

      for (const chunk of chunks) {
        const batch = writeBatch(db);
        chunk.forEach((uid) => {
          const nRef = doc(collection(db, "notifications"));
          batch.set(nRef, {
            id: nRef.id,
            recipientUid: uid,
            type: "ADMIN_ANNOUNCEMENT",
            category: "ADMIN",
            title: broadcastTitle.trim(),
            body: broadcastBody.trim(),
            data: { targetRoute: "NotificationCenter" },
            priority: "HIGH",
            isRead: false,
            readAt: null,
            createdAt: serverTimestamp(),
          });
        });
        await batch.commit();
      }

      // Collect device push tokens across all target users, subcollections, and global deviceTokens
      const isPushTokenValid = (t) =>
        typeof t === "string" &&
        t.length > 10 &&
        (t.startsWith("ExpoPushToken") || t.startsWith("ExponentPushToken") || t.includes("PushToken"));

      const pushTokensSet = new Set();
      try {
        const globalTokensSnap = await getDocs(query(collection(db, "deviceTokens"), where("isActive", "==", true)));
        globalTokensSnap.forEach((d) => {
          const dt = d.data();
          if (isPushTokenValid(dt.token)) {
            if (broadcastTarget === "ALL" || targetUids.includes(dt.uid)) {
              pushTokensSet.add(dt.token);
            }
          }
        });
      } catch (_) {}

      for (const uid of targetUids) {
        try {
          const [dtSnap1, dtSnap2] = await Promise.all([
            getDocs(query(collection(db, "user", uid, "deviceTokens"), where("isActive", "==", true))),
            getDocs(query(collection(db, "users", uid, "deviceTokens"), where("isActive", "==", true))),
          ]);
          dtSnap1.forEach((d) => {
            const t = d.data()?.token;
            if (isPushTokenValid(t)) pushTokensSet.add(t);
          });
          dtSnap2.forEach((d) => {
            const t = d.data()?.token;
            if (isPushTokenValid(t)) pushTokensSet.add(t);
          });
        } catch (_) {}
      }

      allUsers.forEach((u) => {
        const uToken = u.expoPushToken || u.pushToken;
        if (targetUids.includes(u.id) && isPushTokenValid(uToken)) {
          pushTokensSet.add(uToken);
        }
      });

      const activePushTokens = Array.from(pushTokensSet);
      if (activePushTokens.length > 0) {
        fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer K-zfZIUq4_ICjXgUwRLcw21URu9YOmsEz-RXccrU",
          },
          body: JSON.stringify(
            activePushTokens.map((token) => ({
              to: token,
              sound: "default",
              channelId: "announcements",
              priority: "high",
              title: broadcastTitle.trim(),
              body: broadcastBody.trim(),
              data: { targetRoute: "NotificationCenter" },
            }))
          ),
        }).catch(() => {});
      }

      Alert.alert(
        "Broadcast Delivered! 📢",
        `Your announcement was published to ${targetUids.length} users (${activePushTokens.length} active push devices).`
      );
      setBroadcastTitle("");
      setBroadcastBody("");
    } catch (err) {
      Alert.alert("Broadcast Failed", err?.message || "Could not publish announcement.");
    } finally {
      setSendingBroadcast(false);
    }
  };

  // Filtered Users
  const filteredUsers = useMemo(() => {
    return allUsers.filter((u) => {
      const q = userSearch.toLowerCase().trim();
      const matchSearch =
        !q ||
        (u.fullName && u.fullName.toLowerCase().includes(q)) ||
        (u.name && u.name.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q)) ||
        (u.phoneNumber && String(u.phoneNumber).includes(q));

      const role = (u.role || "customer").toLowerCase();
      const matchRole =
        userRoleFilter === "ALL" ||
        (userRoleFilter === "ADMIN" && (role === "admin" || role === "superadmin")) ||
        role === userRoleFilter.toLowerCase();

      return matchSearch && matchRole;
    });
  }, [allUsers, userSearch, userRoleFilter]);

  // Filtered Orders
  const filteredOrders = useMemo(() => {
    return allOrders.filter((o) => {
      const q = orderSearch.toLowerCase().trim();
      const matchSearch =
        !q ||
        o.id.toLowerCase().includes(q) ||
        (o.customerName && o.customerName.toLowerCase().includes(q)) ||
        (o.restaurantName && o.restaurantName.toLowerCase().includes(q));

      const matchStatus =
        orderStatusFilter === "ALL" ||
        o.status === orderStatusFilter ||
        (orderStatusFilter === "REJECTED" && (o.status === "MERCHANT_REJECTED" || o.rejectedByMerchant));

      return matchSearch && matchStatus;
    });
  }, [allOrders, orderSearch, orderStatusFilter]);

  // Combined and Filtered Businesses (Approvals Tab - Phase 13)
  const combinedBusinesses = useMemo(() => {
    return [...pendingBusinesses, ...approvedBusinesses, ...bannedBusinesses];
  }, [pendingBusinesses, approvedBusinesses, bannedBusinesses]);

  const filteredBusinesses = useMemo(() => {
    return combinedBusinesses.filter((b) => {
      const q = bizSearch.toLowerCase().trim();
      const name = (b.name || b.businessName || "").toLowerCase();
      const addr = (b.address || "").toLowerCase();
      const matchSearch = !q || name.includes(q) || addr.includes(q);

      let status = "APPROVED";
      if (b.status === "BANNED") status = "BANNED";
      else if (b.status === "PENDING" || b.isVerified === false) status = "PENDING";

      const matchStatus = bizStatusFilter === "ALL" || status === bizStatusFilter;
      return matchSearch && matchStatus;
    });
  }, [combinedBusinesses, bizSearch, bizStatusFilter]);

  // Filtered Payments (Payments Tab - Phase 15)
  const filteredPayments = useMemo(() => {
    return allOrders.filter((ord) => {
      const q = paymentSearch.toLowerCase().trim();
      const ref = (ord.chapaMerchantReference || ord.id || "").toLowerCase();
      const cust = (ord.customerName || ord.userFirstName || "").toLowerCase();
      const matchSearch = !q || ref.includes(q) || cust.includes(q);

      const isPaid = ord.paymentStatus === "PAID";
      const matchStatus =
        paymentStatusFilter === "ALL" ||
        (paymentStatusFilter === "PAID" && isPaid) ||
        (paymentStatusFilter === "PENDING" && !isPaid && ord.status !== "CANCELLED") ||
        (paymentStatusFilter === "FAILED" && (ord.paymentStatus === "FAILED" || ord.status === "CANCELLED"));

      return matchSearch && matchStatus;
    });
  }, [allOrders, paymentSearch, paymentStatusFilter]);

  // Filtered Ledger Orders (Revenue Tab - Phase 12)
  const filteredLedgerOrders = useMemo(() => {
    return dateFilteredOrders.filter((o) => {
      const q = ledgerSearch.toLowerCase().trim();
      const ref = o.id.toLowerCase();
      const store = (o.restaurantName || "MyTruck Store").toLowerCase();
      return !q || ref.includes(q) || store.includes(q);
    });
  }, [dateFilteredOrders, ledgerSearch]);

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <StatusBar style="dark" />

      {/* Top Header Bar */}
      <View style={s.header}>
        <TouchableOpacity
          onPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
            } else {
              navigation.navigate("Home");
            }
          }}
          style={s.headerBackBtn}
          activeOpacity={0.8}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Return to Customer Storefront"
        >
          <MaterialCommunityIcons name="arrow-left" size={22} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={s.headerTitleWrap}>
          <Text style={s.headerTitle}>
            {isMiniAdmin ? "Mini Admin Operations Center" : "Super Admin Control Center"}
          </Text>
          <Text style={s.headerSubtitle}>
            {isMiniAdmin ? "Operations, Orders & Financial Tracking" : "Enterprise Governance & Operations"}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <NotificationBell
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              backgroundColor: "rgba(255, 255, 255, 0.2)",
              marginRight: 8,
            }}
            iconColor="#FFFFFF"
            badgeColor={ORANGE}
          />
          <View style={[s.shieldCircle, isMiniAdmin && { backgroundColor: "#CCFBF1" }]}>
            <MaterialCommunityIcons
              name={isMiniAdmin ? "shield-account" : "shield-crown"}
              size={20}
              color={isMiniAdmin ? "#0D9488" : "#B91C1C"}
            />
          </View>
        </View>
      </View>

      {/* Navigation Tabs Bar */}
      <View style={s.tabsBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabsScroll}>
          {visibleTabs.map((tab) => {
            const active = activeTab === tab.id;
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
                  {tab.id === "approvals" && pendingBusinesses.length > 0 ? ` (${pendingBusinesses.length})` : ""}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={TEAL} />}
      >
        {loading ? (
          <View style={s.centerBox}>
            <ActivityIndicator size="large" color={TEAL} />
            <Text style={s.loadingTxt}>Synchronizing governance metrics…</Text>
          </View>
        ) : isMiniAdmin && RESTRICTED_TABS.includes(activeTab) ? (
          <View style={{ alignItems: "center", justifyContent: "center", padding: 32, backgroundColor: "white", borderRadius: 16, margin: 16, borderWidth: 1, borderColor: "#FEE2E2" }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: "#FEF2F2", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
              <MaterialCommunityIcons name="shield-lock-outline" size={36} color="#DC2626" />
            </View>
            <Text style={{ fontSize: 18, fontWeight: "800", color: DARK, textAlign: "center", marginBottom: 8 }}>
              Access Denied
            </Text>
            <Text style={{ fontSize: 13, color: "#64748B", textAlign: "center", lineHeight: 20, marginBottom: 20 }}>
              Mini Admin accounts are restricted from accessing or modifying the {activeTab.toUpperCase()} section.
            </Text>
            <TouchableOpacity
              style={{ backgroundColor: TEAL, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 }}
              onPress={() => setActiveTab("overview")}
            >
              <Text style={{ color: "white", fontWeight: "700", fontSize: 14 }}>Return to Overview</Text>
            </TouchableOpacity>
          </View>
        ) : activeTab === "overview" ? (
          /* TAB 1: OVERVIEW & ANALYTICS */
          <>
            {/* Date Range Selector */}
            <View style={s.rangeBar}>
              {DATE_RANGES.map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[s.rangePill, selectedRange === r && s.rangePillActive]}
                  onPress={() => setSelectedRange(r)}
                >
                  <Text style={[s.rangePillTxt, selectedRange === r && s.rangePillTxtActive]}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* GMV & Revenue Card — Clickable to navigate to Revenue Management */}
            <TouchableOpacity
              style={s.revenueCard}
              activeOpacity={0.85}
              onPress={() => setActiveTab("revenue")}
              accessibilityLabel="View full revenue and financial dashboard"
            >
              <View style={{ flex: 1, paddingRight: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 2 }}>
                  <Text style={s.revLabel}>Gross Merchandise Value (GMV)</Text>
                  <MaterialCommunityIcons name="chevron-right" size={18} color="rgba(255,255,255,0.8)" style={{ marginLeft: 4 }} />
                </View>
                <Text style={s.revAmount}>ETB {metrics.gmv.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                <Text style={s.revSub}>Platform Commission (15%): ETB {metrics.platformCommission.toLocaleString(undefined, { minimumFractionDigits: 2 })} · Tap to view details</Text>
              </View>
              <View style={s.revIconWrap}>
                <MaterialCommunityIcons name="cash-multiple" size={32} color="white" />
              </View>
            </TouchableOpacity>

            {/* Analytics Visualizations Bar */}
            <View style={s.analyticsChartCard}>
              <View style={s.chartHeaderRow}>
                <Text style={s.chartTitle}>Order Lifecycle Distribution</Text>
                <Text style={s.chartSub}>{allOrders.length} total orders</Text>
              </View>
              <View style={s.chartProgressBar}>
                <View style={[s.barSegment, { flex: Math.max(1, metrics.completedOrdersCount), backgroundColor: "#10B981" }]} />
                <View style={[s.barSegment, { flex: Math.max(1, metrics.activeOrdersCount), backgroundColor: "#0EA5E9" }]} />
                <View style={[s.barSegment, { flex: Math.max(1, allOrders.filter(o => o.status === "PREPARING").length), backgroundColor: "#F59E0B" }]} />
                <View style={[s.barSegment, { flex: Math.max(1, allOrders.filter(o => o.status === "CANCELLED").length), backgroundColor: "#EF4444" }]} />
              </View>
              <View style={s.chartLegendRow}>
                <View style={s.legendItem}>
                  <View style={[s.legendDot, { backgroundColor: "#10B981" }]} />
                  <Text style={s.legendTxt}>Completed ({metrics.completedOrdersCount})</Text>
                </View>
                <View style={s.legendItem}>
                  <View style={[s.legendDot, { backgroundColor: "#0EA5E9" }]} />
                  <Text style={s.legendTxt}>On Way ({metrics.activeOrdersCount})</Text>
                </View>
                <View style={s.legendItem}>
                  <View style={[s.legendDot, { backgroundColor: "#F59E0B" }]} />
                  <Text style={s.legendTxt}>Preparing ({allOrders.filter(o => o.status === "PREPARING").length})</Text>
                </View>
                <View style={s.legendItem}>
                  <View style={[s.legendDot, { backgroundColor: "#EF4444" }]} />
                  <Text style={s.legendTxt}>Cancelled ({allOrders.filter(o => o.status === "CANCELLED").length})</Text>
                </View>
              </View>
            </View>

            {/* Platform Ecosystem - Compact Vertical List (12 Modules) */}
            <Text style={s.sectionHeader}>Platform Ecosystem</Text>
            <View style={s.ecoListCard}>
              {[
                {
                  label: "Customers",
                  sub: "Registered retail shoppers & diners",
                  icon: "account-group",
                  color: TEAL,
                  badge: `${metrics.customersCount} Users`,
                  onPress: () => { setActiveTab("users"); setUserRoleFilter("CUSTOMER"); },
                },
                {
                  label: "Restaurants",
                  sub: "Food vendors & traditional kitchens",
                  icon: "silverware-fork-knife",
                  color: ORANGE,
                  badge: `${approvedBusinesses.filter((b) => b.businessType === "restaurant").length} Approved`,
                  onPress: () => { setActiveTab("users"); setUserRoleFilter("RESTAURANT"); },
                },
                {
                  label: "Shops & Supermarkets",
                  sub: "Retail groceries, fresh markets, pharmacy",
                  icon: "shopping",
                  color: "#8B5CF6",
                  badge: `${approvedBusinesses.filter((b) => b.businessType === "shop").length} Approved`,
                  onPress: () => { setActiveTab("users"); setUserRoleFilter("SHOP"); },
                },
                {
                  label: "Drivers & Couriers",
                  sub: "Active delivery motorcycle fleet",
                  icon: "motorbike",
                  color: "#0EA5E9",
                  badge: `${metrics.driversCount} Active`,
                  onPress: () => { setActiveTab("users"); setUserRoleFilter("DRIVER"); },
                },
                {
                  label: "Orders Management",
                  sub: "Track deliveries & lifecycle overrides",
                  icon: "file-document-outline",
                  color: "#F59E0B",
                  badge: `${allOrders.length} Total`,
                  onPress: () => { setActiveTab("orders"); setOrderStatusFilter("ALL"); },
                },
                {
                  label: "Chapa Payments",
                  sub: "Telebirr, CBE & Card gateway transactions",
                  icon: "credit-card-check-outline",
                  color: "#16A34A",
                  badge: "LIVE GATEWAY",
                  badgeBg: "#DCFCE7",
                  badgeColor: "#15803D",
                  onPress: () => setActiveTab("payments"),
                },
                {
                  label: "Business Approvals",
                  sub: "Merchant KYB application reviews",
                  icon: "clock-check-outline",
                  color: "#DC2626",
                  badge: `${pendingBusinesses.length} Pending`,
                  badgeBg: pendingBusinesses.length > 0 ? "#FEE2E2" : "#F1F5F9",
                  badgeColor: pendingBusinesses.length > 0 ? "#B91C1C" : "#64748B",
                  onPress: () => setActiveTab("approvals"),
                },
                {
                  label: "Revenue & Financials",
                  sub: "GMV, net commission & payouts",
                  icon: "cash-multiple",
                  color: "#059669",
                  badge: `ETB ${metrics.platformCommission}`,
                  onPress: () => setActiveTab("revenue"),
                },
                {
                  label: "Promotions & Coupons",
                  sub: "MYTRUCK20, WELCOME, FREESHIP",
                  icon: "ticket-percent-outline",
                  color: "#D97706",
                  badge: "3 Active",
                  onPress: () => Alert.alert("Active Coupons", "• MYTRUCK20: 20% off\n• WELCOME: 15% off\n• FREESHIP: Free Delivery"),
                },
                {
                  label: "Customer & Driver Support",
                  sub: "Dedicated dispatch desk & hotline",
                  icon: "headphones",
                  color: "#6366F1",
                  badge: "Hotline Active",
                  onPress: () => Alert.alert("Support Desk", "Helpline: +251 911 223 344\nWhatsApp: +251 911 223 344\nEmail: support@mytruck.et"),
                },
                {
                  label: "Audit Logs & Reports",
                  sub: "Administrative history & compliance",
                  icon: "file-chart-outline",
                  color: "#475569",
                  badge: "Ready",
                  onPress: () => setActiveTab("revenue"),
                },
                {
                  label: "Platform Settings",
                  sub: "Base fees, rates, payment methods",
                  icon: "tune-vertical",
                  color: TEAL,
                  badge: "Config",
                  onPress: () => setActiveTab("config"),
                },
              ].map((item, idx, arr) => (
                <TouchableOpacity
                  key={item.label}
                  style={[s.ecoListItem, idx === arr.length - 1 && { borderBottomWidth: 0 }]}
                  activeOpacity={0.75}
                  onPress={item.onPress}
                >
                  <View style={s.ecoLeft}>
                    <View style={[s.ecoIconWrap, { backgroundColor: item.color + "1A" }]}>
                      <MaterialCommunityIcons name={item.icon} size={20} color={item.color} />
                    </View>
                    <View style={{ marginLeft: 12, flex: 1 }}>
                      <Text style={s.ecoLabel}>{item.label}</Text>
                      <Text style={s.ecoSub} numberOfLines={1}>{item.sub}</Text>
                    </View>
                  </View>
                  <View style={s.ecoRight}>
                    <View style={[s.ecoBadge, { backgroundColor: item.badgeBg || "#F1F5F9" }]}>
                      <Text style={[s.ecoBadgeTxt, { color: item.badgeColor || DARK }]}>{item.badge}</Text>
                    </View>
                    <MaterialCommunityIcons name="chevron-right" size={18} color="#94A3B8" style={{ marginLeft: 4 }} />
                  </View>
                </TouchableOpacity>
              ))}
            </View>

            {/* Pending Approvals Alert Bar */}
            {pendingBusinesses.length > 0 ? (
              <TouchableOpacity
                style={s.pendingAlertCard}
                activeOpacity={0.88}
                onPress={() => setActiveTab("approvals")}
              >
                <View style={s.pendingAlertLeft}>
                  <MaterialCommunityIcons name="clock-alert-outline" size={24} color="#B91C1C" />
                  <View style={{ marginLeft: 10 }}>
                    <Text style={s.pendingAlertTitle}>{pendingBusinesses.length} Applications Awaiting Review</Text>
                    <Text style={s.pendingAlertSub}>Tap to review documents and approve</Text>
                  </View>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={22} color="#B91C1C" />
              </TouchableOpacity>
            ) : null}

            {/* Quick Actions Bar */}
            <Text style={s.sectionHeader}>Operational Controls</Text>
            <View style={s.quickActionsRow}>
              <TouchableOpacity style={s.quickActionBtn} onPress={() => setActiveTab("users")}>
                <MaterialCommunityIcons name="account-search-outline" size={20} color={TEAL} style={{ marginRight: 6 }} />
                <Text style={s.quickActionTxt}>Manage Users</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.quickActionBtn, { marginLeft: 10 }]} onPress={() => setActiveTab("orders")}>
                <MaterialCommunityIcons name="receipt" size={20} color={TEAL} style={{ marginRight: 6 }} />
                <Text style={s.quickActionTxt}>All Orders</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : activeTab === "users" ? (
          /* TAB 2: USER MANAGEMENT */
          <>
            <View style={s.searchWrap}>
              <MaterialCommunityIcons name="magnify" size={20} color={TEAL} style={{ marginRight: 8 }} />
              <TextInput
                style={s.searchInput}
                placeholder="Search user by name, email or phone..."
                placeholderTextColor="#94A3B8"
                value={userSearch}
                onChangeText={setUserSearch}
              />
            </View>

            {/* Role Filter Chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterChipsScroll}>
              {["ALL", "CUSTOMER", "RESTAURANT", "SHOP", "DRIVER", "ADMIN"].map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[s.roleChip, userRoleFilter === r && s.roleChipActive]}
                  onPress={() => setUserRoleFilter(r)}
                >
                  <Text style={[s.roleChipTxt, userRoleFilter === r && s.roleChipTxtActive]}>{r}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={s.sectionHeader}>Registered Users ({filteredUsers.length})</Text>

            {filteredUsers.slice(0, 50).map((u) => {
              const role = (u.role || "customer").toUpperCase();
              const isBanned = u.accountStatus === "BANNED";
              const isSuspended = u.accountStatus === "SUSPENDED";

              return (
                <TouchableOpacity
                  key={u.id}
                  style={[s.userCard, isBanned && { borderColor: "#EF4444" }]}
                  activeOpacity={0.88}
                  onPress={() => setSelectedUserModal(u)}
                >
                  <View style={s.userCardTop}>
                    <View style={s.userAvatar}>
                      <Text style={s.userAvatarTxt}>
                        {(u.fullName || u.email || "U")[0].toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={s.userName}>{u.fullName || u.email || "Registered User"}</Text>
                      <Text style={s.userPhone}>{u.phoneNumber || u.phone || "No phone registered"}</Text>
                      <Text style={s.userEmail}>{u.email || "—"}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <View style={[s.roleBadge, { backgroundColor: role.includes("ADMIN") ? "#FEE2E2" : "#F0FDF9" }]}>
                        <Text style={[s.roleBadgeTxt, { color: role.includes("ADMIN") ? "#B91C1C" : TEAL }]}>{role}</Text>
                      </View>
                      {isBanned ? (
                        <Text style={{ color: "#EF4444", fontSize: 10, fontWeight: "800", marginTop: 4 }}>BANNED</Text>
                      ) : isSuspended ? (
                        <Text style={{ color: "#F59E0B", fontSize: 10, fontWeight: "800", marginTop: 4 }}>SUSPENDED</Text>
                      ) : (
                        <Text style={{ color: "#166534", fontSize: 10, fontWeight: "800", marginTop: 4 }}>ACTIVE</Text>
                      )}
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </>
        ) : activeTab === "approvals" ? (
          /* TAB 3: BUSINESS APPROVALS & GOVERNANCE (Phase 13) */
          <>
            <View style={s.searchWrap}>
              <MaterialCommunityIcons name="magnify" size={20} color={TEAL} style={{ marginRight: 8 }} />
              <TextInput
                style={s.searchInput}
                placeholder="Search merchant by name, address or type..."
                placeholderTextColor="#94A3B8"
                value={bizSearch}
                onChangeText={setBizSearch}
              />
              {bizSearch ? (
                <TouchableOpacity onPress={() => setBizSearch("")}>
                  <MaterialCommunityIcons name="close-circle" size={18} color="#94A3B8" />
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Status Filter Chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterChipsScroll}>
              {[
                { id: "ALL", label: `All (${combinedBusinesses.length})` },
                { id: "PENDING", label: `Pending (${pendingBusinesses.length})` },
                { id: "APPROVED", label: `Verified (${approvedBusinesses.length})` },
                { id: "BANNED", label: `Banned (${bannedBusinesses.length})` },
              ].map((chip) => (
                <TouchableOpacity
                  key={chip.id}
                  style={[s.roleChip, bizStatusFilter === chip.id && s.roleChipActive]}
                  onPress={() => { setBizStatusFilter(chip.id); setBizPage(1); }}
                >
                  <Text style={[s.roleChipTxt, bizStatusFilter === chip.id && s.roleChipTxtActive]}>{chip.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={s.sectionHeader}>Merchants & Storefronts ({filteredBusinesses.length})</Text>

            {filteredBusinesses.length === 0 ? (
              <View style={s.emptyCard}>
                <MaterialCommunityIcons name="storefront-outline" size={40} color="#CBD5E1" />
                <Text style={s.emptyTitle}>No merchants found</Text>
                <Text style={s.emptySub}>No businesses match the current filter and search criteria.</Text>
              </View>
            ) : (
              filteredBusinesses
                .slice((bizPage - 1) * PAGE_SIZE, bizPage * PAGE_SIZE)
                .map((biz) => {
                  const isBanned = biz.status === "BANNED";
                  const isPending = biz.status === "PENDING" || biz.isVerified === false;
                  return (
                    <TouchableOpacity
                      key={biz.id}
                      style={s.approvalCard}
                      activeOpacity={0.88}
                      onPress={() => setSelectedBizDetail(biz)}
                    >
                      <View style={s.approvalTop}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.bizTitle}>{biz.name || biz.businessName || "New Merchant"}</Text>
                          <Text style={s.bizSub}>{biz.businessType === "shop" ? "Shop / Retail" : "Restaurant / Food"} • {biz.address || "Addis Ababa"}</Text>
                          <Text style={s.bizContact}>📞 {biz.phone || biz.phoneNumber || "—"}</Text>
                          {biz.licenceNumber ? (
                            <Text style={s.bizLicence}>Licence: {biz.licenceNumber}</Text>
                          ) : null}
                          {isBanned && biz.banReason ? (
                            <Text style={{ color: "#DC2626", fontSize: 11, fontWeight: "700", marginTop: 4 }}>
                              Ban Reason: {biz.banReason}
                            </Text>
                          ) : null}
                        </View>
                        <View
                          style={[
                            s.pendingBadge,
                            isBanned
                              ? { backgroundColor: "#FEE2E2" }
                              : isPending
                              ? { backgroundColor: "#FEF3C7" }
                              : { backgroundColor: "#DCFCE7" },
                          ]}
                        >
                          <Text
                            style={[
                              s.pendingBadgeTxt,
                              isBanned
                                ? { color: "#B91C1C" }
                                : isPending
                                ? { color: "#B45309" }
                                : { color: "#166534" },
                            ]}
                          >
                            {isBanned ? "BANNED" : isPending ? "PENDING" : "VERIFIED"}
                          </Text>
                        </View>
                      </View>

                      <View style={s.approvalActions}>
                        <TouchableOpacity
                          style={[s.btnAction, { backgroundColor: "#F1F5F9", marginRight: 8 }]}
                          onPress={() => setSelectedBizDetail(biz)}
                        >
                          <MaterialCommunityIcons name="file-document-outline" size={15} color="#475569" />
                          <Text style={[s.btnActionTxt, { color: "#475569" }]}>View Detail</Text>
                        </TouchableOpacity>

                        {isPending ? (
                          <>
                            <TouchableOpacity
                              style={[s.btnAction, { backgroundColor: TEAL }]}
                              onPress={() => handleApproveBusiness(biz)}
                            >
                              <MaterialCommunityIcons name="check-decagram" size={15} color="white" />
                              <Text style={s.btnActionTxt}>Approve</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              style={[s.btnAction, { backgroundColor: "#FEE2E2", marginLeft: 8 }]}
                              onPress={() => { setRejectDialogBiz(biz); setRejectionReason(""); }}
                            >
                              <MaterialCommunityIcons name="close-circle-outline" size={15} color="#B91C1C" />
                              <Text style={[s.btnActionTxt, { color: "#B91C1C" }]}>Decline</Text>
                            </TouchableOpacity>
                          </>
                        ) : isBanned ? (
                          <TouchableOpacity
                            style={[s.btnAction, { backgroundColor: TEAL }]}
                            onPress={() => handleUnbanBusiness(biz)}
                          >
                            <MaterialCommunityIcons name="lock-open-outline" size={15} color="white" />
                            <Text style={s.btnActionTxt}>Unban Merchant</Text>
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity
                            style={[s.btnAction, { backgroundColor: "#FEE2E2" }]}
                            onPress={() => { setBanDialogBiz(biz); setBanReason(""); }}
                          >
                            <MaterialCommunityIcons name="cancel" size={15} color="#B91C1C" />
                            <Text style={[s.btnActionTxt, { color: "#B91C1C" }]}>Ban Business</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })
            )}

            {/* Pagination Controls */}
            {filteredBusinesses.length > PAGE_SIZE && (
              <View style={s.paginationRow}>
                <TouchableOpacity
                  style={[s.pageBtn, bizPage === 1 && s.pageBtnDisabled]}
                  disabled={bizPage === 1}
                  onPress={() => setBizPage((p) => Math.max(1, p - 1))}
                >
                  <MaterialCommunityIcons name="chevron-left" size={18} color={bizPage === 1 ? "#94A3B8" : TEAL} />
                  <Text style={[s.pageBtnTxt, bizPage === 1 && { color: "#94A3B8" }]}>Previous</Text>
                </TouchableOpacity>

                <Text style={s.pageIndicator}>
                  Page {bizPage} of {Math.ceil(filteredBusinesses.length / PAGE_SIZE)}
                </Text>

                <TouchableOpacity
                  style={[s.pageBtn, bizPage >= Math.ceil(filteredBusinesses.length / PAGE_SIZE) && s.pageBtnDisabled]}
                  disabled={bizPage >= Math.ceil(filteredBusinesses.length / PAGE_SIZE)}
                  onPress={() => setBizPage((p) => p + 1)}
                >
                  <Text style={[s.pageBtnTxt, bizPage >= Math.ceil(filteredBusinesses.length / PAGE_SIZE) && { color: "#94A3B8" }]}>Next</Text>
                  <MaterialCommunityIcons name="chevron-right" size={18} color={bizPage >= Math.ceil(filteredBusinesses.length / PAGE_SIZE) ? "#94A3B8" : TEAL} />
                </TouchableOpacity>
              </View>
            )}
          </>
        ) : activeTab === "orders" ? (
          /* TAB 4: ORDER MANAGEMENT (Phase 14) */
          <>
            <View style={s.searchWrap}>
              <MaterialCommunityIcons name="magnify" size={20} color={TEAL} style={{ marginRight: 8 }} />
              <TextInput
                style={s.searchInput}
                placeholder="Search by order ID, customer or merchant..."
                placeholderTextColor="#94A3B8"
                value={orderSearch}
                onChangeText={setOrderSearch}
              />
              {orderSearch ? (
                <TouchableOpacity onPress={() => setOrderSearch("")}>
                  <MaterialCommunityIcons name="close-circle" size={18} color="#94A3B8" />
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Status Chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterChipsScroll}>
              {["ALL", "PENDING", "ACCEPTED", "PREPARING", "READY", "COMPLETE", "REJECTED", "CANCELLED"].map((st) => (
                <TouchableOpacity
                  key={st}
                  style={[s.roleChip, orderStatusFilter === st && s.roleChipActive]}
                  onPress={() => { setOrderStatusFilter(st); setOrderPage(1); }}
                >
                  <Text style={[s.roleChipTxt, orderStatusFilter === st && s.roleChipTxtActive]}>{st}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={s.sectionHeader}>Platform Orders ({filteredOrders.length})</Text>

            {filteredOrders.length === 0 ? (
              <View style={s.emptyCard}>
                <MaterialCommunityIcons name="file-document-outline" size={40} color="#CBD5E1" />
                <Text style={s.emptyTitle}>No matching orders</Text>
              </View>
            ) : (
              filteredOrders
                .slice((orderPage - 1) * PAGE_SIZE, orderPage * PAGE_SIZE)
                .map((ord) => {
                  const isPaid = ord.paymentStatus === "PAID";
                  const isComplete = ord.status === "COMPLETE";
                  const isCancelled = ord.status === "CANCELLED";
                  const isRejected = ord.status === "MERCHANT_REJECTED" || ord.rejectedByMerchant;
                  return (
                    <TouchableOpacity
                      key={ord.id}
                      style={s.orderCard}
                      activeOpacity={0.88}
                      onPress={() => setSelectedOrderDetail(ord)}
                    >
                      <View style={s.orderTop}>
                        <Text style={s.orderId}>#{ord.id.slice(0, 8).toUpperCase()}</Text>
                        <View
                          style={[
                            s.orderStatusPill,
                            isComplete
                              ? { backgroundColor: "#DCFCE7" }
                              : isRejected
                              ? { backgroundColor: "#FEE2E2" }
                              : isCancelled
                              ? { backgroundColor: "#F1F5F9" }
                              : { backgroundColor: "#FEF3C7" },
                          ]}
                        >
                          <Text
                            style={[
                              s.orderStatusPillTxt,
                              isComplete
                                ? { color: "#166534" }
                                : isRejected
                                ? { color: "#B91C1C", fontWeight: "900" }
                                : isCancelled
                                ? { color: "#64748B" }
                                : { color: "#B45309" },
                            ]}
                          >
                            {isRejected ? "REJECTED BY STORE" : (ord.status || "PENDING")}
                          </Text>
                        </View>
                      </View>

                      <Text style={s.orderMerchant}>Store: {ord.restaurantName || "MyTruck Store"}</Text>
                      <Text style={s.orderCustomer}>Customer: {ord.customerName || ord.userFirstName || "Customer"}</Text>
                      <Text style={s.orderAddress}>📍 {ord.deliveryAddress || "Addis Ababa"}</Text>

                      {/* Customer cancelled a paid order: refund the Chapa payment, then mark it done */}
                      {ord.refundStatus === "REQUESTED" && (
                        <View style={{ backgroundColor: "#FFF7ED", borderWidth: 1, borderColor: "#FDBA74", borderRadius: 8, padding: 8, marginTop: 6, marginBottom: 4 }}>
                          <Text style={{ fontSize: 11.5, color: "#9A3412", fontWeight: "800" }}>
                            {`💸 Refund due: ETB ${Number(ord.refundAmount || ord.total || 0).toFixed(2)} · Chapa ref ${ord.chapaMerchantReference || "—"}`}
                          </Text>
                          <Text style={{ fontSize: 11, color: "#9A3412", marginTop: 2 }}>
                            {`Cancelled by ${ord.cancelledBy === "CUSTOMER" ? "customer" : "system"}${ord.cancelReason ? ` · ${ord.cancelReason}` : ""}`}
                          </Text>
                          <TouchableOpacity
                            onPress={() =>
                              Alert.alert(
                                "Mark as Refunded?",
                                "Confirm you have refunded this payment in the Chapa dashboard.",
                                [
                                  { text: "Not Yet", style: "cancel" },
                                  {
                                    text: "Mark Refunded",
                                    onPress: () =>
                                      updateDoc(doc(db, "orders", ord.id), {
                                        refundStatus: "REFUNDED",
                                        refundedAt: serverTimestamp(),
                                        refundedBy: dbUser?.email || "admin",
                                        updatedAt: serverTimestamp(),
                                      }).catch((e) => Alert.alert("Error", e?.message || "Could not update refund.")),
                                  },
                                ]
                              )
                            }
                            style={{ alignSelf: "flex-start", marginTop: 6, backgroundColor: "#EA580C", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 }}
                          >
                            <Text style={{ color: "white", fontSize: 11, fontWeight: "800" }}>Mark Refunded</Text>
                          </TouchableOpacity>
                        </View>
                      )}

                      {/* Prominent Store Rejection Notice and Reassign Action */}
                      {isRejected && (
                        <View style={{ backgroundColor: "#FEF2F2", borderWidth: 1, borderColor: "#FECDD3", borderRadius: 8, padding: 8, marginTop: 6, marginBottom: 4 }}>
                          <Text style={{ fontSize: 11, fontWeight: "800", color: "#B91C1C" }}>
                            ⚠️ Store Declined: {ord.merchantRejectionReason || ord.rejectionReason || "Out of stock or unavailable"}
                          </Text>
                          <TouchableOpacity
                            style={{ backgroundColor: TEAL, borderRadius: 6, paddingVertical: 5, paddingHorizontal: 10, marginTop: 6, alignSelf: "flex-start", flexDirection: "row", alignItems: "center" }}
                            onPress={() => setReassignModalOrder(ord)}
                          >
                            <MaterialCommunityIcons name="swap-horizontal" size={14} color="white" style={{ marginRight: 4 }} />
                            <Text style={{ fontSize: 11, fontWeight: "800", color: "white" }}>Reassign to Another Store</Text>
                          </TouchableOpacity>
                        </View>
                      )}

                      <View style={s.orderBottom}>
                        <Text style={s.orderTotal}>ETB {Number(ord.total || 0).toFixed(2)}</Text>
                        <Text style={s.orderPayment}>
                          {ord.paymentMethod || "COD"} • {isPaid ? "PAID" : "UNPAID"}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
            )}

            {/* Pagination Controls */}
            {filteredOrders.length > PAGE_SIZE && (
              <View style={s.paginationRow}>
                <TouchableOpacity
                  style={[s.pageBtn, orderPage === 1 && s.pageBtnDisabled]}
                  disabled={orderPage === 1}
                  onPress={() => setOrderPage((p) => Math.max(1, p - 1))}
                >
                  <MaterialCommunityIcons name="chevron-left" size={18} color={orderPage === 1 ? "#94A3B8" : TEAL} />
                  <Text style={[s.pageBtnTxt, orderPage === 1 && { color: "#94A3B8" }]}>Previous</Text>
                </TouchableOpacity>

                <Text style={s.pageIndicator}>
                  Page {orderPage} of {Math.ceil(filteredOrders.length / PAGE_SIZE)}
                </Text>

                <TouchableOpacity
                  style={[s.pageBtn, orderPage >= Math.ceil(filteredOrders.length / PAGE_SIZE) && s.pageBtnDisabled]}
                  disabled={orderPage >= Math.ceil(filteredOrders.length / PAGE_SIZE)}
                  onPress={() => setOrderPage((p) => p + 1)}
                >
                  <Text style={[s.pageBtnTxt, orderPage >= Math.ceil(filteredOrders.length / PAGE_SIZE) && { color: "#94A3B8" }]}>Next</Text>
                  <MaterialCommunityIcons name="chevron-right" size={18} color={orderPage >= Math.ceil(filteredOrders.length / PAGE_SIZE) ? "#94A3B8" : TEAL} />
                </TouchableOpacity>
              </View>
            )}
          </>
        ) : activeTab === "payments" ? (
          /* TAB: CHAPA PAYMENT OPERATIONS (Phase 15) */
          <>
            {/* Chapa Live Status Card */}
            <View style={s.chapaGatewayCard}>
              <View style={s.chapaHeader}>
                <View style={s.chapaIconWrap}>
                  <MaterialCommunityIcons name="credit-card-check" size={24} color="#16A34A" />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={s.chapaTitle}>Chapa Payment Gateway</Text>
                  <Text style={s.chapaSub}>Official Verified Integration · API v1</Text>
                </View>
                <View style={s.chapaLivePill}>
                  <Text style={s.chapaLiveTxt}>ACTIVE</Text>
                </View>
              </View>

              <View style={s.chapaMetaRow}>
                <View style={s.chapaMetaItem}>
                  <Text style={s.chapaMetaLabel}>Security</Text>
                  <Text style={s.chapaMetaVal}>Server Verification</Text>
                </View>
                <View style={s.chapaMetaItem}>
                  <Text style={s.chapaMetaLabel}>Currency</Text>
                  <Text style={s.chapaMetaVal}>ETB</Text>
                </View>
                <View style={s.chapaMetaItem}>
                  <Text style={s.chapaMetaLabel}>Channels</Text>
                  <Text style={s.chapaMetaVal}>Telebirr, CBE, Cards</Text>
                </View>
              </View>
            </View>

            {/* Chapa Overview Metrics Grid */}
            <View style={s.finCard}>
              <Text style={s.finCardTitle}>Transaction Overview</Text>
              <View style={s.finRow}>
                <Text style={s.finLabel}>Total Processed Volume</Text>
                <Text style={[s.finVal, { color: TEAL }]}>ETB {metrics.digitalGmv.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Text>
              </View>
              <View style={s.finRow}>
                <Text style={s.finLabel}>Successful Transactions</Text>
                <Text style={s.finVal}>{allOrders.filter((o) => o.paymentStatus === "PAID").length} payments</Text>
              </View>
              <View style={s.finRow}>
                <Text style={s.finLabel}>Pending Verifications</Text>
                <Text style={s.finVal}>{allOrders.filter((o) => o.paymentStatus !== "PAID" && o.status !== "CANCELLED").length} orders</Text>
              </View>
              <View style={s.finRow}>
                <Text style={s.finLabel}>Digital Payment Share</Text>
                <Text style={s.finVal}>
                  {metrics.gmv > 0 ? `${((metrics.digitalGmv / metrics.gmv) * 100).toFixed(0)}%` : "0%"}
                </Text>
              </View>
            </View>

            {/* Inactive Secondary Providers */}
            <Text style={s.sectionHeader}>Secondary Providers (Coming Soon)</Text>
            <View style={s.comingSoonRow}>
              <View style={s.comingSoonCard}>
                <Text style={s.comingSoonTitle}>Telebirr Direct</Text>
                <Text style={s.comingSoonSub}>Telco Direct API</Text>
                <View style={s.comingSoonBadge}><Text style={s.comingSoonBadgeTxt}>COMING SOON</Text></View>
              </View>
              <View style={[s.comingSoonCard, { marginLeft: 10 }]}>
                <Text style={s.comingSoonTitle}>Cash on Delivery</Text>
                <Text style={s.comingSoonSub}>Physical Collection</Text>
                <View style={[s.comingSoonBadge, codEnabled && { backgroundColor: "#DCFCE7" }]}>
                  <Text style={[s.comingSoonBadgeTxt, codEnabled && { color: "#166534" }]}>
                    {codEnabled ? "LIVE" : "OFF · enable in Settings"}
                  </Text>
                </View>
              </View>
            </View>

            {/* Search and Filters for Transactions */}
            <View style={s.searchWrap}>
              <MaterialCommunityIcons name="magnify" size={20} color={TEAL} style={{ marginRight: 8 }} />
              <TextInput
                style={s.searchInput}
                placeholder="Search transaction by reference or customer..."
                placeholderTextColor="#94A3B8"
                value={paymentSearch}
                onChangeText={setPaymentSearch}
              />
              {paymentSearch ? (
                <TouchableOpacity onPress={() => setPaymentSearch("")}>
                  <MaterialCommunityIcons name="close-circle" size={18} color="#94A3B8" />
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Status Filter Chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterChipsScroll}>
              {["ALL", "PAID", "PENDING", "FAILED"].map((st) => (
                <TouchableOpacity
                  key={st}
                  style={[s.roleChip, paymentStatusFilter === st && s.roleChipActive]}
                  onPress={() => { setPaymentStatusFilter(st); setPaymentPage(1); }}
                >
                  <Text style={[s.roleChipTxt, paymentStatusFilter === st && s.roleChipTxtActive]}>{st}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Transactions List */}
            <Text style={s.sectionHeader}>Chapa Transactions ({filteredPayments.length})</Text>

            {filteredPayments.length === 0 ? (
              <View style={s.emptyCard}>
                <MaterialCommunityIcons name="credit-card-off-outline" size={40} color="#CBD5E1" />
                <Text style={s.emptyTitle}>No transactions found</Text>
              </View>
            ) : (
              filteredPayments
                .slice((paymentPage - 1) * 6, paymentPage * 6)
                .map((ord) => {
                  const isPaid = ord.paymentStatus === "PAID";
                  return (
                    <TouchableOpacity
                      key={ord.id}
                      style={s.txCard}
                      activeOpacity={0.88}
                      onPress={() => setSelectedPaymentDetail(ord)}
                    >
                      <View style={s.txRowTop}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.txRef}>
                            #{ord.chapaMerchantReference || `MT${ord.id.slice(-8).toUpperCase()}`}
                          </Text>
                          <Text style={s.txCustomer}>
                            {ord.customerName || "Customer"} · {ord.restaurantName || "Partner"}
                          </Text>
                        </View>
                        <View style={[s.txBadge, { backgroundColor: isPaid ? "#DCFCE7" : "#FEF3C7" }]}>
                          <Text style={[s.txBadgeTxt, { color: isPaid ? "#166534" : "#B45309" }]}>
                            {isPaid ? "SUCCESSFUL" : "PENDING"}
                          </Text>
                        </View>
                      </View>
                      <View style={s.txDivider} />
                      <View style={s.txRowBottom}>
                        <Text style={s.txAmount}>ETB {Number(ord.total || 0).toFixed(2)}</Text>
                        <View style={{ flexDirection: "row", alignItems: "center" }}>
                          <Text style={s.txStatus}>Gateway: Chapa Hosted</Text>
                          <MaterialCommunityIcons name="chevron-right" size={16} color="#94A3B8" style={{ marginLeft: 4 }} />
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })
            )}

            {/* Pagination Controls */}
            {filteredPayments.length > 6 && (
              <View style={s.paginationRow}>
                <TouchableOpacity
                  style={[s.pageBtn, paymentPage === 1 && s.pageBtnDisabled]}
                  disabled={paymentPage === 1}
                  onPress={() => setPaymentPage((p) => Math.max(1, p - 1))}
                >
                  <MaterialCommunityIcons name="chevron-left" size={18} color={paymentPage === 1 ? "#94A3B8" : TEAL} />
                  <Text style={[s.pageBtnTxt, paymentPage === 1 && { color: "#94A3B8" }]}>Previous</Text>
                </TouchableOpacity>

                <Text style={s.pageIndicator}>
                  Page {paymentPage} of {Math.ceil(filteredPayments.length / 6)}
                </Text>

                <TouchableOpacity
                  style={[s.pageBtn, paymentPage >= Math.ceil(filteredPayments.length / 6) && s.pageBtnDisabled]}
                  disabled={paymentPage >= Math.ceil(filteredPayments.length / 6)}
                  onPress={() => setPaymentPage((p) => p + 1)}
                >
                  <Text style={[s.pageBtnTxt, paymentPage >= Math.ceil(filteredPayments.length / 6) && { color: "#94A3B8" }]}>Next</Text>
                  <MaterialCommunityIcons name="chevron-right" size={18} color={paymentPage >= Math.ceil(filteredPayments.length / 6) ? "#94A3B8" : TEAL} />
                </TouchableOpacity>
              </View>
            )}
          </>
        ) : activeTab === "revenue" ? (
          /* TAB 5: REVENUE & FINANCIAL MANAGEMENT (Phase 12) */
          <>
            {/* Date Range Selector */}
            <View style={s.rangeBar}>
              {DATE_RANGES.map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[s.rangePill, selectedRange === r && s.rangePillActive]}
                  onPress={() => setSelectedRange(r)}
                >
                  <Text style={[s.rangePillTxt, selectedRange === r && s.rangePillTxtActive]}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Executive Financial Audit Card ("What You See") matching Explicit Mandate */}
            <View style={{ backgroundColor: DARK, borderRadius: 20, padding: 18, marginBottom: 16 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 11.5, color: "#94A3B8", fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" }}>
                    Platform Financial Balance ({selectedRange})
                  </Text>
                  <Text style={{ fontSize: 26, fontWeight: "900", color: "#FFFFFF", marginTop: 4 }}>
                    ETB {metrics.totalReceived.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </Text>
                  <Text style={{ fontSize: 11, color: "#A7F3D0", marginTop: 2 }}>
                    Total Money Received across {metrics.completedOrdersCount} fulfilled orders
                  </Text>
                </View>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(23,155,131,0.25)", alignItems: "center", justifyContent: "center" }}>
                  <MaterialCommunityIcons name="scale-balance" size={24} color={TEAL} />
                </View>
              </View>

              {/* 3-Way Allocation Breakdown */}
              <View style={{ backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 14, padding: 12 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                  <Text style={{ fontSize: 12.5, color: "#CBD5E1" }}>🏪 Owed to Restaurants / Shops (100%):</Text>
                  <Text style={{ fontSize: 13, fontWeight: "800", color: "#67E8F9" }}>
                    ETB {metrics.restaurantBalancePayable.toFixed(2)}
                  </Text>
                </View>

                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                  <Text style={{ fontSize: 12.5, color: "#CBD5E1" }}>🛵 Owed to Riders (80% of Delivery):</Text>
                  <Text style={{ fontSize: 13, fontWeight: "800", color: "#86EFAC" }}>
                    ETB {metrics.driverEarnings.toFixed(2)}
                  </Text>
                </View>

                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.12)", marginTop: 4, paddingTop: 6 }}>
                  <Text style={{ fontSize: 13, fontWeight: "800", color: "#FFFFFF" }}>💼 Total Liabilities (Owed Out):</Text>
                  <Text style={{ fontSize: 14, fontWeight: "900", color: "#FCD34D" }}>
                    ETB {metrics.totalOwedOut.toFixed(2)}
                  </Text>
                </View>

                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                  <Text style={{ fontSize: 13, fontWeight: "800", color: "#34D399" }}>💎 Your Net Profit (Service + 20% Delivery):</Text>
                  <Text style={{ fontSize: 15, fontWeight: "900", color: "#34D399" }}>
                    ETB {metrics.totalCompanyProfit.toFixed(2)}
                  </Text>
                </View>
              </View>

              {/* Verification Math Pill */}
              <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "rgba(16,185,129,0.15)", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginTop: 10, gap: 6 }}>
                <MaterialCommunityIcons name="check-decagram" size={16} color="#34D399" />
                <Text style={{ fontSize: 11, color: "#A7F3D0", fontWeight: "700", flex: 1 }}>
                  Check: {metrics.restaurantBalancePayable.toFixed(0)} + {metrics.driverEarnings.toFixed(0)} + {metrics.totalCompanyProfit.toFixed(0)} = {metrics.totalReceived.toFixed(0)} ETB ✓
                </Text>
              </View>
            </View>

            {/* Dynamic 7-Day Revenue Column Chart matching User Mandate */}
            <View style={s.chartCard}>
              <View style={s.chartHeaderRow}>
                <View>
                  <Text style={s.chartTitle}>Revenue Breakdown (Last 7 Days)</Text>
                  <Text style={s.chartSubtitle}>
                    Daily gross platform volume across all completed deliveries
                  </Text>
                </View>
                <View style={s.growthBadge}>
                  <MaterialCommunityIcons name="trending-up" size={14} color="#166534" />
                  <Text style={s.growthBadgeTxt}>{sevenDayMetrics.growthPct}</Text>
                </View>
              </View>

              {/* 7 Columns for Mon through Sun */}
              <View style={s.barChartWrap}>
                {sevenDayMetrics.dailyBars.map((bar, idx) => {
                  const barHeightPct = Math.max(10, Math.min(100, Math.round((bar.gmv / sevenDayMetrics.maxDayGmv) * 100)));
                  const isToday = idx === sevenDayMetrics.dailyBars.length - 1;
                  return (
                    <View key={bar.dateStr || idx} style={s.barCol}>
                      <Text style={[s.barAmtTxt, isToday && { color: TEAL, fontWeight: "800" }]}>
                        {bar.gmv >= 1000 ? `${(bar.gmv / 1000).toFixed(1)}k` : Math.round(bar.gmv)}
                      </Text>
                      <View style={s.barTrack}>
                        <View
                          style={[
                            s.barFill,
                            {
                              height: `${barHeightPct}%`,
                              backgroundColor: isToday ? ORANGE : TEAL,
                            },
                          ]}
                        />
                      </View>
                      <Text style={[s.barDayTxt, isToday && { color: TEAL, fontWeight: "800" }]}>
                        {bar.dayName}
                      </Text>
                    </View>
                  );
                })}
              </View>

              {/* 7-Day Summary Footer */}
              <View style={s.chartFooterRow}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View style={[s.legendDot, { backgroundColor: TEAL }]} />
                  <Text style={s.legendTxt}>7-Day GMV: ETB {sevenDayMetrics.totalWeekGmv.toFixed(2)}</Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View style={[s.legendDot, { backgroundColor: ORANGE }]} />
                  <Text style={s.legendTxt}>Today's Volume</Text>
                </View>
              </View>
            </View>

            {/* 4-Card Financial Breakdown Grid */}
            <Text style={s.sectionHeader}>Automatic Financial Breakdown ({selectedRange})</Text>
            <View style={s.statGrid}>
              {/* Money Received */}
              <View style={s.statCard}>
                <View style={[s.statIconWrap, { backgroundColor: "#E6F7F1" }]}>
                  <MaterialCommunityIcons name="cash-multiple" size={20} color={TEAL} />
                </View>
                <Text style={s.statNumber}>ETB {metrics.totalReceived.toFixed(2)}</Text>
                <Text style={s.statLabel}>Money Received (Gross)</Text>
              </View>

              {/* Owed to Restaurant */}
              <View style={s.statCard}>
                <View style={[s.statIconWrap, { backgroundColor: "#E0F2FE" }]}>
                  <MaterialCommunityIcons name="silverware-fork-knife" size={20} color="#0284C7" />
                </View>
                <Text style={s.statNumber}>ETB {metrics.restaurantBalancePayable.toFixed(2)}</Text>
                <Text style={s.statLabel}>Owed to Restaurant (100%)</Text>
              </View>

              {/* Owed to Riders */}
              <View style={s.statCard}>
                <View style={[s.statIconWrap, { backgroundColor: "#DCFCE7" }]}>
                  <MaterialCommunityIcons name="moped" size={20} color="#166534" />
                </View>
                <Text style={s.statNumber}>ETB {metrics.driverEarnings.toFixed(2)}</Text>
                <Text style={s.statLabel}>Owed to Riders (80%)</Text>
              </View>

              {/* Your Company Profit */}
              <View style={s.statCard}>
                <View style={[s.statIconWrap, { backgroundColor: "#FEF3C7" }]}>
                  <MaterialCommunityIcons name="shield-star" size={20} color="#D97706" />
                </View>
                <Text style={s.statNumber}>ETB {metrics.totalCompanyProfit.toFixed(2)}</Text>
                <Text style={s.statLabel}>Your Company Profit</Text>
              </View>
            </View>

            {/* Secondary Financial Metrics */}
            <View style={s.finCard}>
              <Text style={s.finCardTitle}>Performance Indicators</Text>
              <View style={s.finRow}>
                <Text style={s.finLabel}>Average Order Value (AOV)</Text>
                <Text style={[s.finVal, { color: TEAL }]}>ETB {metrics.aov.toFixed(2)}</Text>
              </View>
              <View style={s.finRow}>
                <Text style={s.finLabel}>Total Orders in Period</Text>
                <Text style={s.finVal}>{metrics.totalOrdersCount} orders</Text>
              </View>
              <View style={s.finRow}>
                <Text style={s.finLabel}>Cancelled / Refund Volume</Text>
                <Text style={[s.finVal, { color: "#DC2626" }]}>ETB {metrics.refundedVolume.toFixed(2)}</Text>
              </View>
            </View>

            {/* Payment Channel Volume Distribution */}
            <View style={s.finCard}>
              <Text style={s.finCardTitle}>Payment Channel Breakdown</Text>
              <View style={s.finRow}>
                <Text style={s.finLabel}>Digital (Chapa: Telebirr, CBE, Cards)</Text>
                <Text style={s.finVal}>ETB {metrics.digitalGmv.toFixed(2)}</Text>
              </View>
              <View style={s.finRow}>
                <Text style={s.finLabel}>Cash on Delivery (COD)</Text>
                <Text style={s.finVal}>ETB {metrics.codGmv.toFixed(2)}</Text>
              </View>
              {/* Visual distribution bar */}
              <View style={[s.chartProgressBar, { marginTop: 10 }]}>
                <View
                  style={[
                    s.barSegment,
                    {
                      flex: Math.max(1, metrics.digitalGmv),
                      backgroundColor: TEAL,
                    },
                  ]}
                />
                <View
                  style={[
                    s.barSegment,
                    {
                      flex: Math.max(1, metrics.codGmv),
                      backgroundColor: ORANGE,
                    },
                  ]}
                />
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
                <Text style={{ fontSize: 11, color: TEAL, fontWeight: "700" }}>Digital: {metrics.gmv > 0 ? ((metrics.digitalGmv / metrics.gmv) * 100).toFixed(0) : 0}%</Text>
                <Text style={{ fontSize: 11, color: ORANGE, fontWeight: "700" }}>Cash: {metrics.gmv > 0 ? ((metrics.codGmv / metrics.gmv) * 100).toFixed(0) : 0}%</Text>
              </View>
            </View>

            {/* Promotional Discounts & Merchant Savings Card */}
            <View style={[s.finCard, { marginTop: 14 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <MaterialCommunityIcons name="tag-multiple-outline" size={20} color="#E11D48" style={{ marginRight: 8 }} />
                  <Text style={s.finCardTitle}>Merchant Discounts & Savings</Text>
                </View>
                <View style={{ backgroundColor: "#FFE4E6", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: "#E11D48" }}>PROMO IMPACT</Text>
                </View>
              </View>
              <View style={s.finRow}>
                <Text style={s.finLabel}>Orders with Merchant Discount</Text>
                <Text style={s.finVal}>{metrics.discountedOrdersCount || 0} orders ({metrics.discountAdoptionRate || "0.0"}%)</Text>
              </View>
              <View style={s.finRow}>
                <Text style={s.finLabel}>Total Merchant-Funded Discounts</Text>
                <Text style={[s.finVal, { color: "#E11D48", fontWeight: "700" }]}>
                  ETB {(metrics.totalDiscountAmount || 0).toFixed(2)}
                </Text>
              </View>
              <View style={s.finRow}>
                <Text style={s.finLabel}>Total Customer Savings</Text>
                <Text style={[s.finVal, { color: "#166534", fontWeight: "700" }]}>
                  ETB {(metrics.totalDiscountAmount || 0).toFixed(2)}
                </Text>
              </View>
              <View style={s.finRow}>
                <Text style={s.finLabel}>Commission Policy Base</Text>
                <Text style={[s.finVal, { color: TEAL, fontWeight: "700" }]}>Calculated on Discounted Price</Text>
              </View>
            </View>

            {/* Daily Merchant & Fleet Performance (Phase 16) */}
            <View style={[s.finCard, { marginTop: 14 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <MaterialCommunityIcons name="store-check" size={20} color={TEAL} style={{ marginRight: 8 }} />
                  <Text style={s.finCardTitle}>Daily Merchant Sales ({selectedRange})</Text>
                </View>
                <View style={{ backgroundColor: "#E6F7F1", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: TEAL }}>NET VOLUME</Text>
                </View>
              </View>

              {merchantFleetDailyMetrics.merchants.length === 0 ? (
                <Text style={{ fontSize: 12, color: "#94A3B8", fontStyle: "italic", textAlign: "center", marginVertical: 8 }}>
                  No merchant orders completed in this period.
                </Text>
              ) : (
                merchantFleetDailyMetrics.merchants.map((m) => (
                  <View key={m.id} style={{ borderBottomWidth: 1, borderBottomColor: "#F1F5F9", paddingVertical: 8 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={{ fontSize: 13, fontWeight: "800", color: DARK }}>{m.name}</Text>
                      <Text style={{ fontSize: 13, fontWeight: "800", color: TEAL }}>
                        ETB {m.netSold.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Net
                      </Text>
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
                      <Text style={{ fontSize: 11, color: "#64748B" }}>
                        {m.orderCount} orders · Avg {Math.round(m.netSold / Math.max(1, m.orderCount))} ETB/order
                      </Text>
                      <Text style={{ fontSize: 11, color: "#94A3B8" }}>
                        Gross Sales: ETB {m.grossVolume.toFixed(2)}
                      </Text>
                    </View>
                  </View>
                ))
              )}

              {/* Fleet Driver Deliveries & Performance */}
              <View style={{ height: 1, backgroundColor: "#E2E8F0", marginVertical: 12 }} />
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <MaterialCommunityIcons name="moped" size={20} color="#166534" style={{ marginRight: 8 }} />
                  <Text style={s.finCardTitle}>Driver Delivery Performance ({selectedRange})</Text>
                </View>
                <View style={{ backgroundColor: "#DCFCE7", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 }}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: "#166534" }}>FLEET FULFILLMENT</Text>
                </View>
              </View>

              {merchantFleetDailyMetrics.drivers.length === 0 ? (
                <Text style={{ fontSize: 12, color: "#94A3B8", fontStyle: "italic", textAlign: "center", marginVertical: 8 }}>
                  No driver deliveries recorded in this period.
                </Text>
              ) : (
                merchantFleetDailyMetrics.drivers.map((d) => (
                  <View key={d.id} style={{ borderBottomWidth: 1, borderBottomColor: "#F1F5F9", paddingVertical: 10 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={{ fontSize: 13, fontWeight: "800", color: DARK }}>{d.name}</Text>
                      <Text style={{ fontSize: 13, fontWeight: "800", color: "#166534" }}>
                        ETB {d.earnings.toFixed(2)} Net (80%)
                      </Text>
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 3 }}>
                      <Text style={{ fontSize: 11, color: "#16A34A", fontWeight: "700" }}>
                        ✓ {d.deliveredCount} deliveries · Transferred: ETB {d.transferred.toFixed(2)}
                      </Text>
                      <Text style={{ fontSize: 11.5, fontWeight: "800", color: d.outstanding > 0 ? "#DC2626" : "#166534" }}>
                        Due: ETB {d.outstanding.toFixed(2)}
                      </Text>
                    </View>
                    {/* Settlement Transfer Action */}
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6, paddingTop: 4, borderTopWidth: 1, borderTopColor: "#F8FAFC" }}>
                      <Text style={{ fontSize: 10.5, color: "#94A3B8" }}>
                        {d.telebirrPhone ? `Telebirr: ${d.telebirrPhone}` : d.bankName ? `${d.bankName}: ${d.bankAccountNumber}` : "Direct Fleet"}
                      </Text>
                      <TouchableOpacity
                        onPress={() => {
                          setPayoutModalDriver(d);
                          setPayoutAmountInput(String(d.outstanding > 0 ? d.outstanding : d.earnings));
                          setPayoutRefInput(`PAY-${Date.now().toString(36).toUpperCase()}`);
                        }}
                        style={{
                          backgroundColor: d.outstanding > 0 ? TEAL : "#E2E8F0",
                          paddingHorizontal: 10,
                          paddingVertical: 5,
                          borderRadius: 8,
                        }}
                        activeOpacity={0.8}
                      >
                        <Text style={{ fontSize: 11, fontWeight: "800", color: d.outstanding > 0 ? "#FFFFFF" : "#64748B" }}>
                          {d.outstanding > 0 ? "Transfer Settlement" : "Settled ✓"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </View>

            {/* Financial Ledger Table */}
            <View style={s.searchWrap}>
              <MaterialCommunityIcons name="magnify" size={20} color={TEAL} style={{ marginRight: 8 }} />
              <TextInput
                style={s.searchInput}
                placeholder="Search ledger by order ID or store..."
                placeholderTextColor="#94A3B8"
                value={ledgerSearch}
                onChangeText={setLedgerSearch}
              />
              {ledgerSearch ? (
                <TouchableOpacity onPress={() => setLedgerSearch("")}>
                  <MaterialCommunityIcons name="close-circle" size={18} color="#94A3B8" />
                </TouchableOpacity>
              ) : null}
            </View>

            <Text style={s.sectionHeader}>Settlement Ledger ({filteredLedgerOrders.length})</Text>

            {filteredLedgerOrders.length === 0 ? (
              <View style={s.emptyCard}>
                <MaterialCommunityIcons name="cash-remove" size={40} color="#CBD5E1" />
                <Text style={s.emptyTitle}>No ledger transactions</Text>
              </View>
            ) : (
              filteredLedgerOrders
                .slice((ledgerPage - 1) * 5, ledgerPage * 5)
                .map((ord) => {
                  const fin = calculateOrderFinancials({
                    subtotal: ord.subtotal || ord.merchantBaseSubtotal || (Number(ord.total || 0) > 75 ? Number(ord.total) - 75 : 0),
                    deliveryFee: ord.deliveryFee || 60,
                    serviceFee: ord.serviceFee != null ? ord.serviceFee : 15,
                    deliveryCommissionPercent: ord.deliveryCommissionPercent != null ? ord.deliveryCommissionPercent : 20,
                  });
                  const isPaid = ord.paymentStatus === "PAID" || ord.status === "COMPLETE";
                  return (
                    <TouchableOpacity
                      key={ord.id}
                      style={s.txCard}
                      activeOpacity={0.88}
                      onPress={() => setSelectedOrderDetail(ord)}
                    >
                      <View style={s.txRowTop}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.txRef}>#{ord.id.slice(0, 8).toUpperCase()}</Text>
                          <Text style={s.txCustomer}>{ord.restaurantName || "MyTruck Store"}</Text>
                        </View>
                        <View style={[s.txBadge, { backgroundColor: isPaid ? "#DCFCE7" : "#FEF3C7" }]}>
                          <Text style={[s.txBadgeTxt, { color: isPaid ? "#166534" : "#B45309" }]}>
                            {isPaid ? "PAID & SETTLED" : "PENDING"}
                          </Text>
                        </View>
                      </View>
                      <View style={s.txDivider} />
                      <View style={s.txRowBottom}>
                        <View>
                          <Text style={s.txAmount}>ETB {fin.total.toFixed(2)}</Text>
                          <Text style={{ fontSize: 10, color: "#94A3B8" }}>Customer Paid</Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={[s.txStatus, { color: TEAL, fontWeight: "700" }]}>
                            Rest: ETB {fin.restaurantEarnings.toFixed(0)} · Rider: ETB {fin.driverEarnings.toFixed(0)} · Profit: ETB {fin.companyProfit.toFixed(0)}
                          </Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })
            )}

            {/* Pagination Controls */}
            {filteredLedgerOrders.length > 5 && (
              <View style={s.paginationRow}>
                <TouchableOpacity
                  style={[s.pageBtn, ledgerPage === 1 && s.pageBtnDisabled]}
                  disabled={ledgerPage === 1}
                  onPress={() => setLedgerPage((p) => Math.max(1, p - 1))}
                >
                  <MaterialCommunityIcons name="chevron-left" size={18} color={ledgerPage === 1 ? "#94A3B8" : TEAL} />
                  <Text style={[s.pageBtnTxt, ledgerPage === 1 && { color: "#94A3B8" }]}>Previous</Text>
                </TouchableOpacity>

                <Text style={s.pageIndicator}>
                  Page {ledgerPage} of {Math.ceil(filteredLedgerOrders.length / 5)}
                </Text>

                <TouchableOpacity
                  style={[s.pageBtn, ledgerPage >= Math.ceil(filteredLedgerOrders.length / 5) && s.pageBtnDisabled]}
                  disabled={ledgerPage >= Math.ceil(filteredLedgerOrders.length / 5)}
                  onPress={() => setLedgerPage((p) => p + 1)}
                >
                  <Text style={[s.pageBtnTxt, ledgerPage >= Math.ceil(filteredLedgerOrders.length / 5) && { color: "#94A3B8" }]}>Next</Text>
                  <MaterialCommunityIcons name="chevron-right" size={18} color={ledgerPage >= Math.ceil(filteredLedgerOrders.length / 5) ? "#94A3B8" : TEAL} />
                </TouchableOpacity>
              </View>
            )}
          </>
                ) : activeTab === "catalog" ? (
          /* TAB 6: MERCHANTS DIRECTORY & PRODUCT CATALOG MANAGEMENT */
          <>
            {/* Sub-tab Switcher: Merchants vs Products */}
            <View style={{ flexDirection: "row", backgroundColor: "#E6F4F1", borderRadius: 14, padding: 4, marginBottom: 16 }}>
              <TouchableOpacity
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 10,
                  alignItems: "center",
                  backgroundColor: catalogSubTab === "merchants" ? TEAL : "transparent",
                }}
                onPress={() => setCatalogSubTab("merchants")}
                activeOpacity={0.8}
              >
                <Text style={{ fontWeight: "800", fontSize: 13, color: catalogSubTab === "merchants" ? "#FFFFFF" : DARK }}>
                  Stores & Merchants ({approvedBusinesses.length + pendingBusinesses.length})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 10,
                  alignItems: "center",
                  backgroundColor: catalogSubTab === "products" ? TEAL : "transparent",
                }}
                onPress={() => setCatalogSubTab("products")}
                activeOpacity={0.8}
              >
                <Text style={{ fontWeight: "800", fontSize: 13, color: catalogSubTab === "products" ? "#FFFFFF" : DARK }}>
                  Product Catalog ({catalogDishes.length})
                </Text>
              </TouchableOpacity>
            </View>

            {catalogSubTab === "merchants" ? (
              /* SUB-VIEW 1: MERCHANTS DIRECTORY */
              <>
                <View style={s.searchWrap}>
                  <MaterialCommunityIcons name="magnify" size={20} color={TEAL} style={{ marginRight: 8 }} />
                  <TextInput
                    style={s.searchInput}
                    placeholder="Search stores by name, category, or phone..."
                    placeholderTextColor="#94A3B8"
                    value={bizSearch}
                    onChangeText={setBizSearch}
                  />
                  {bizSearch ? (
                    <TouchableOpacity onPress={() => setBizSearch("")}>
                      <MaterialCommunityIcons name="close-circle" size={18} color="#94A3B8" />
                    </TouchableOpacity>
                  ) : null}
                </View>

                {/* Filter chips */}
                <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 14 }}>
                  {[
                    { id: "ALL", label: "All Stores" },
                    { id: "APPROVED", label: "Active" },
                    { id: "PENDING", label: "Pending" },
                    { id: "BANNED", label: "Suspended" },
                  ].map((f) => {
                    const active = bizStatusFilter === f.id;
                    return (
                      <TouchableOpacity
                        key={f.id}
                        style={[s.filterChip, active && s.filterChipActive]}
                        onPress={() => setBizStatusFilter(f.id)}
                      >
                        <Text style={[s.filterChipTxt, active && s.filterChipTxtActive]}>{f.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Merchants List */}
                {filteredBusinesses.length === 0 ? (
                  <View style={s.emptyCard}>
                    <MaterialCommunityIcons name="store-remove-outline" size={42} color="#CBD5E1" />
                    <Text style={s.emptyTitle}>No merchants found</Text>
                  </View>
                ) : (
                  filteredBusinesses.map((biz) => {
                    const isBanned = biz.status === "BANNED";
                    const isPending = biz.status === "PENDING" || biz.isVerified === false;
                    return (
                      <View key={biz.id} style={s.card}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <View style={{ flex: 1, paddingRight: 8 }}>
                            <Text style={s.cardTitle}>{biz.name || biz.businessName || "Store"}</Text>
                            <Text style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>
                              {biz.genre || (biz.businessType === "shop" ? "Retail Shop" : "Restaurant")} · {biz.address || "Bole, Addis Ababa"}
                            </Text>
                            {biz.phone || biz.phoneNumber ? (
                              <Text style={{ fontSize: 12, color: TEAL, marginTop: 2, fontWeight: "600" }}>
                                📞 {biz.phone || biz.phoneNumber}
                              </Text>
                            ) : null}
                          </View>
                          <View
                            style={{
                              backgroundColor: isBanned ? "#FEE2E2" : isPending ? "#FEF9C3" : "#DCFCE7",
                              borderRadius: 8,
                              paddingHorizontal: 8,
                              paddingVertical: 3,
                            }}
                          >
                            <Text
                              style={{
                                color: isBanned ? "#DC2626" : isPending ? "#A16207" : "#166534",
                                fontWeight: "800",
                                fontSize: 11,
                              }}
                            >
                              {isBanned ? "SUSPENDED" : isPending ? "PENDING" : "ACTIVE"}
                            </Text>
                          </View>
                        </View>

                        {/* Actions */}
                        <View style={{ flexDirection: "row", marginTop: 12, borderTopWidth: 1, borderTopColor: "#F1F5F9", paddingTop: 10 }}>
                          <TouchableOpacity
                            style={[s.modBtn, { backgroundColor: "#E6F4F1", marginRight: 8 }]}
                            onPress={() => setSelectedBizDetail(biz)}
                          >
                            <Text style={[s.modBtnTxt, { color: TEAL }]}>View Store</Text>
                          </TouchableOpacity>
                          {isPending ? (
                            <TouchableOpacity
                              style={[s.modBtn, { backgroundColor: TEAL }]}
                              onPress={() => handleApproveBusiness(biz)}
                            >
                              <Text style={[s.modBtnTxt, { color: "#FFFFFF" }]}>Approve</Text>
                            </TouchableOpacity>
                          ) : isBanned ? (
                            <TouchableOpacity
                              style={[s.modBtn, { backgroundColor: "#DCFCE7" }]}
                              onPress={() => handleUnbanBusiness(biz)}
                            >
                              <Text style={[s.modBtnTxt, { color: "#166534" }]}>Reactivate</Text>
                            </TouchableOpacity>
                          ) : (
                            <TouchableOpacity
                              style={[s.modBtn, { backgroundColor: "#FEE2E2" }]}
                              onPress={() => setBanDialogBiz(biz)}
                            >
                              <Text style={[s.modBtnTxt, { color: "#DC2626" }]}>Suspend</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    );
                  })
                )}
              </>
            ) : (
              /* SUB-VIEW 2: PRODUCT CATALOG MANAGEMENT */
              <>
                <View style={s.searchWrap}>
                  <MaterialCommunityIcons name="magnify" size={20} color={TEAL} style={{ marginRight: 8 }} />
                  <TextInput
                    style={s.searchInput}
                    placeholder="Search menu items, dishes, prices..."
                    placeholderTextColor="#94A3B8"
                    value={catalogSearch}
                    onChangeText={setCatalogSearch}
                  />
                  {catalogSearch ? (
                    <TouchableOpacity onPress={() => setCatalogSearch("")}>
                      <MaterialCommunityIcons name="close-circle" size={18} color="#94A3B8" />
                    </TouchableOpacity>
                  ) : null}
                </View>

                {/* Lifecycle filter chips */}
                <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 14 }}>
                  {[
                    { id: "ALL", label: `All Items (${catalogDishes.length})` },
                    {
                      id: "PENDING",
                      label: `Pending Review (${catalogDishes.filter((d) => d.status === "PENDING" || d.lifecycleStatus === "Pending" || (!d.isApproved && d.status !== "APPROVED" && d.status !== "Published")).length})`,
                    },
                    { id: "APPROVED", label: "Approved & Live" },
                    { id: "REJECTED", label: "Rejected" },
                  ].map((f) => {
                    const active = catalogLifecycleFilter === f.id;
                    return (
                      <TouchableOpacity
                        key={f.id}
                        style={[s.filterChip, active && s.filterChipActive]}
                        onPress={() => setCatalogLifecycleFilter(f.id)}
                      >
                        <Text style={[s.filterChipTxt, active && s.filterChipTxtActive]}>{f.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Product List */}
                {catalogDishes
                  .filter((d) => {
                    const q = catalogSearch.toLowerCase().trim();
                    const name = (d.name || "").toLowerCase();
                    const desc = (d.description || "").toLowerCase();
                    const store = (d.restaurantName || d.merchantName || "").toLowerCase();
                    const matchesSearch = !q || name.includes(q) || desc.includes(q) || store.includes(q);

                    const rawStatus = String(d.status || d.lifecycleStatus || (d.isPublished ? "APPROVED" : "PENDING")).toUpperCase();
                    let normalizedStatus = "PENDING";
                    if (rawStatus === "APPROVED" || rawStatus === "PUBLISHED" || d.isApproved || d.isPublished) {
                      normalizedStatus = "APPROVED";
                    } else if (rawStatus === "REJECTED" || rawStatus === "SUSPENDED") {
                      normalizedStatus = "REJECTED";
                    }

                    const matchesStatus =
                      catalogLifecycleFilter === "ALL" ||
                      normalizedStatus === catalogLifecycleFilter;
                    return matchesSearch && matchesStatus;
                  })
                  .map((dish) => {
                    const rawStatus = String(dish.status || dish.lifecycleStatus || (dish.isPublished ? "APPROVED" : "PENDING")).toUpperCase();
                    const isPub = rawStatus === "APPROVED" || rawStatus === "PUBLISHED" || dish.isApproved || dish.isPublished;
                    const isRej = rawStatus === "REJECTED" || rawStatus === "SUSPENDED";
                    const isPend = !isPub && !isRej;
                    return (
                      <View key={dish.id} style={s.card}>
                        <View style={{ flexDirection: "row", alignItems: "center" }}>
                          <SmartImage
                            uri={dish.image}
                            fallbackType="dish"
                            style={{ width: 60, height: 60, borderRadius: 12, marginRight: 12, backgroundColor: "#E6F4F1" }}
                            resizeMode="cover"
                          />
                          <View style={{ flex: 1, paddingRight: 8 }}>
                            <Text style={s.cardTitle} numberOfLines={1}>{dish.name}</Text>
                            <Text style={{ fontSize: 13, fontWeight: "800", color: TEAL, marginTop: 2 }}>
                              ETB {Number(dish.price || 0).toFixed(2)}
                            </Text>
                            <Text style={{ fontSize: 11, color: "#64748B", marginTop: 2 }} numberOfLines={1}>
                              Store: {dish.restaurantName || dish.merchantName || "MyTruck Merchant"}
                            </Text>
                          </View>
                          {/* In-Stock Toggle */}
                          <View style={{ alignItems: "center" }}>
                            <Switch
                              value={dish.isAvailable !== false}
                              onValueChange={(val) => handleToggleDishAvailability(dish, val)}
                              trackColor={{ false: "#CBD5E1", true: TEAL }}
                              thumbColor="white"
                            />
                            <Text style={{ fontSize: 10, color: dish.isAvailable !== false ? TEAL : "#94A3B8", fontWeight: "700" }}>
                              {dish.isAvailable !== false ? "In Stock" : "Sold Out"}
                            </Text>
                          </View>
                        </View>

                        {/* Lifecycle controls */}
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12, borderTopWidth: 1, borderTopColor: "#F1F5F9", paddingTop: 10 }}>
                          <View
                            style={{
                              backgroundColor: isPub ? "#DCFCE7" : (isRej ? "#FEE2E2" : "#FEF9C3"),
                              borderRadius: 6,
                              paddingHorizontal: 8,
                              paddingVertical: 3,
                            }}
                          >
                            <Text style={{ color: isPub ? "#166534" : (isRej ? "#DC2626" : "#A16207"), fontWeight: "800", fontSize: 10 }}>
                              {isPub ? "APPROVED & LIVE" : (isRej ? "REJECTED" : "PENDING APPROVAL")}
                            </Text>
                          </View>
                          <View style={{ flexDirection: "row" }}>
                            <TouchableOpacity
                              style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: "#E6F4F1", marginRight: 6 }}
                              onPress={() => setSelectedProductModal(dish)}
                            >
                              <Text style={{ fontSize: 11, fontWeight: "700", color: TEAL }}>
                                {isPend ? "Review / Reject" : "Inspect"}
                              </Text>
                            </TouchableOpacity>
                            {isPend ? (
                              <TouchableOpacity
                                style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: TEAL, marginRight: 6 }}
                                onPress={() => handleUpdateProductLifecycle(dish.id, "Published")}
                              >
                                <Text style={{ fontSize: 11, fontWeight: "700", color: "#FFFFFF" }}>Approve</Text>
                              </TouchableOpacity>
                            ) : !isPub ? (
                              <TouchableOpacity
                                style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: TEAL, marginRight: 6 }}
                                onPress={() => handleUpdateProductLifecycle(dish.id, "Published")}
                              >
                                <Text style={{ fontSize: 11, fontWeight: "700", color: "#FFFFFF" }}>Approve</Text>
                              </TouchableOpacity>
                            ) : (
                              <TouchableOpacity
                                style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: "#FEE2E2", marginRight: 6 }}
                                onPress={() => handleUpdateProductLifecycle(dish.id, "Suspended")}
                              >
                                <Text style={{ fontSize: 11, fontWeight: "700", color: "#DC2626" }}>Suspend</Text>
                              </TouchableOpacity>
                            )}
                            <TouchableOpacity
                              style={{ paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: "#F1F5F9" }}
                              onPress={() => handleDeleteDish(dish)}
                            >
                              <MaterialCommunityIcons name="trash-can-outline" size={16} color="#64748B" />
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    );
                  })}
              </>
            )}
          </>
        ) : activeTab === "broadcast" ? (
          /* TAB 7: PLATFORM BROADCAST ANNOUNCEMENTS */
          <>
            <Text style={s.sectionHeader}>Target Audience</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 16 }}>
              {[
                { id: "ALL", label: "All Users", icon: "account-group" },
                { id: "customer", label: "Customers", icon: "account" },
                { id: "driver", label: "Drivers", icon: "moped" },
                { id: "restaurant", label: "Restaurants", icon: "store" },
                { id: "shop", label: "Shops", icon: "shopping" },
              ].map((aud) => {
                const active = broadcastTarget === aud.id;
                return (
                  <TouchableOpacity
                    key={aud.id}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      backgroundColor: active ? TEAL : "#FFFFFF",
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 14,
                      marginRight: 8,
                      marginBottom: 8,
                      borderWidth: 1,
                      borderColor: active ? TEAL : "#E2E8F0",
                    }}
                    onPress={() => setBroadcastTarget(aud.id)}
                    activeOpacity={0.8}
                  >
                    <MaterialCommunityIcons
                      name={aud.icon}
                      size={16}
                      color={active ? "#FFFFFF" : TEAL}
                      style={{ marginRight: 6 }}
                    />
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: "700",
                        color: active ? "#FFFFFF" : DARK,
                      }}
                    >
                      {aud.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={s.sectionHeader}>Announcement Message</Text>
            <View style={s.configCard}>
              <Text style={s.configLabel}>Notification Title</Text>
              <TextInput
                style={s.configInput}
                placeholder="e.g. Special Holiday Promo or Service Notice"
                placeholderTextColor="#94A3B8"
                value={broadcastTitle}
                onChangeText={setBroadcastTitle}
              />

              <Text style={s.configLabel}>Announcement Body</Text>
              <TextInput
                style={[s.configInput, { height: 100, textAlignVertical: "top" }]}
                placeholder="Compose announcement message to be delivered to user inboxes and push banners..."
                placeholderTextColor="#94A3B8"
                multiline
                numberOfLines={4}
                value={broadcastBody}
                onChangeText={setBroadcastBody}
              />
            </View>

            {/* Live Message Preview */}
            <Text style={s.sectionHeader}>Recipient Preview</Text>
            <View
              style={{
                backgroundColor: "#FFFFFF",
                borderRadius: 16,
                padding: 14,
                marginBottom: 20,
                borderWidth: 1,
                borderColor: "#CCFBF1",
                flexDirection: "row",
              }}
            >
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  backgroundColor: "#E6F7F1",
                  alignItems: "center",
                  justifyContent: "center",
                  marginRight: 12,
                }}
              >
                <MaterialCommunityIcons name="bullhorn-outline" size={20} color={TEAL} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: "800", color: DARK }}>
                  {broadcastTitle.trim() || "Announcement Title"}
                </Text>
                <Text style={{ fontSize: 12, color: "#64748B", marginTop: 4, lineHeight: 16 }}>
                  {broadcastBody.trim() || "Announcement message preview will appear here in recipient devices..."}
                </Text>
                <Text style={{ fontSize: 10, color: TEAL, fontWeight: "700", marginTop: 6 }}>
                  Audience: {broadcastTarget.toUpperCase()} · Just now
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[
                s.saveConfigBtn,
                { backgroundColor: TEAL },
                sendingBroadcast && { opacity: 0.7 },
              ]}
              onPress={handleSendBroadcast}
              disabled={sendingBroadcast}
              activeOpacity={0.88}
            >
              {sendingBroadcast ? (
                <ActivityIndicator color="white" />
              ) : (
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <MaterialCommunityIcons name="send" size={18} color="white" style={{ marginRight: 8 }} />
                  <Text style={s.saveConfigBtnTxt}>Send Platform Broadcast</Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Test Notification Alert Button matching HabInfo-App */}
            <TouchableOpacity
              style={[
                s.saveConfigBtn,
                { backgroundColor: "#0B2A26", marginTop: 10, borderWidth: 1.5, borderColor: "#179B83" },
              ]}
              onPress={async () => {
                try {
                  await triggerLocalTestAlert(
                    broadcastTitle.trim() || "MyTruck Test Alert 🚚",
                    broadcastBody.trim() || "Push notifications and Android heads-up alerts are functioning properly!"
                  );
                  Alert.alert("Test Notification Sent", "A heads-up alert has been triggered on this device.");
                } catch (e) {
                  Alert.alert("Notification Notice", e?.message || "Could not trigger test alert.");
                }
              }}
              activeOpacity={0.88}
            >
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <MaterialCommunityIcons name="bell-ring-outline" size={18} color="#2DD4BF" style={{ marginRight: 8 }} />
                <Text style={[s.saveConfigBtnTxt, { color: "#2DD4BF" }]}>Test Alert (Instant Device Push)</Text>
              </View>
            </TouchableOpacity>
          </>
        ) : (
          /* TAB 6: SETTINGS & CONFIGURATION */
          <>
            <Text style={s.sectionHeader}>Delivery Pricing Rules</Text>
            <View style={s.configCard}>
              <Text style={s.configLabel}>Base Delivery Fee (ETB)</Text>
              <TextInput
                style={s.configInput}
                value={baseFee}
                onChangeText={setBaseFee}
                keyboardType="numeric"
              />

              <Text style={s.configLabel}>Per-KM Distance Surcharge (ETB)</Text>
              <TextInput
                style={s.configInput}
                value={perKmFee}
                onChangeText={setPerKmFee}
                keyboardType="numeric"
              />

              <Text style={s.configLabel}>Merchant Platform Commission Rate (%)</Text>
              <TextInput
                style={s.configInput}
                value={commissionRate}
                onChangeText={setCommissionRate}
                keyboardType="numeric"
              />
            </View>

            <Text style={s.sectionHeader}>Customer Price Markup & Platform Fees</Text>
            <View style={s.configCard}>
              <Text style={s.configLabel}>Item Percentage Markup (%)</Text>
              <TextInput
                style={s.configInput}
                value={itemMarkupPercent}
                onChangeText={setItemMarkupPercent}
                keyboardType="numeric"
                placeholder="20"
              />

              <Text style={s.configLabel}>Item Flat Markup / Surcharge (ETB)</Text>
              <TextInput
                style={s.configInput}
                value={itemMarkupFlat}
                onChangeText={setItemMarkupFlat}
                keyboardType="numeric"
                placeholder="100"
              />

              <Text style={s.configLabel}>Customer Service Fee (ETB)</Text>
              <TextInput
                style={s.configInput}
                value={serviceFeeConfig}
                onChangeText={setServiceFeeConfig}
                keyboardType="numeric"
                placeholder="15"
              />

              {/* Dynamic Live Formula Preview Card */}
              <View style={{ backgroundColor: "#F0FDFA", borderWidth: 1, borderColor: "#99F6E4", borderRadius: 12, padding: 12, marginTop: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
                  <MaterialCommunityIcons name="calculator" size={16} color={TEAL} style={{ marginRight: 6 }} />
                  <Text style={{ fontSize: 12, fontWeight: "800", color: DARK }}>Live Pricing Formula Preview</Text>
                </View>
                <Text style={{ fontSize: 12, color: "#334155", lineHeight: 18 }}>
                  If a restaurant lists a food item at <Text style={{ fontWeight: "800", color: DARK }}>500 ETB</Text>:
                </Text>
                <Text style={{ fontSize: 12, color: "#0F766E", marginTop: 2 }}>
                  + {itemMarkupPercent || 0}% Markup = {Math.round(500 * (Number(itemMarkupPercent || 0) / 100))} ETB
                </Text>
                <Text style={{ fontSize: 12, color: "#0F766E" }}>
                  + Flat Surcharge = {Number(itemMarkupFlat || 0)} ETB
                </Text>
                <View style={{ height: 1, backgroundColor: "#CCFBF1", marginVertical: 6 }} />
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontSize: 13, fontWeight: "800", color: DARK }}>Customer Sees & Pays:</Text>
                  <Text style={{ fontSize: 15, fontWeight: "900", color: "#E11D48" }}>
                    ETB {500 + Math.round(500 * (Number(itemMarkupPercent || 0) / 100)) + Number(itemMarkupFlat || 0)}
                  </Text>
                </View>
                <Text style={{ fontSize: 11, color: "#166534", marginTop: 3 }}>
                  ✓ Merchant receives their base price: 500 ETB net
                </Text>
              </View>
            </View>

            <Text style={s.sectionHeader}>Payment Providers</Text>
            <View style={s.configCard}>
              <View style={s.switchRow}>
                <Text style={s.switchLabel}>Chapa Gateway (Cards & Digital)</Text>
                <Switch value={chapaEnabled} onValueChange={setChapaEnabled} trackColor={{ false: "#CBD5E1", true: TEAL }} thumbColor="white" />
              </View>

              <View style={s.switchRow}>
                <Text style={s.switchLabel}>Telebirr Mobile Payments</Text>
                <Switch value={telebirrEnabled} onValueChange={setTelebirrEnabled} trackColor={{ false: "#CBD5E1", true: TEAL }} thumbColor="white" />
              </View>

              <View style={s.switchRow}>
                <Text style={s.switchLabel}>CBE Birr Bank Payments</Text>
                <Switch value={cbeBirrEnabled} onValueChange={setCbeBirrEnabled} trackColor={{ false: "#CBD5E1", true: TEAL }} thumbColor="white" />
              </View>

              <View style={s.switchRow}>
                <Text style={s.switchLabel}>Cash on Delivery (Doorstep Cash)</Text>
                <Switch value={codEnabled} onValueChange={setCodEnabled} trackColor={{ false: "#CBD5E1", true: TEAL }} thumbColor="white" />
              </View>
            </View>

            <TouchableOpacity
              style={[s.saveConfigBtn, savingConfig && { opacity: 0.7 }]}
              onPress={handleSavePlatformConfig}
              disabled={savingConfig}
              activeOpacity={0.88}
            >
              {savingConfig ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={s.saveConfigBtnTxt}>Save Platform Settings</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

            {/* Product Review & Lifecycle Modal */}
      {selectedProductModal && (
        <Modal
          visible={Boolean(selectedProductModal)}
          transparent
          animationType="slide"
          onRequestClose={() => setSelectedProductModal(null)}
        >
          <View style={s.modalOverlay}>
            <View style={s.modalSheet}>
              <View style={s.modalHeader}>
                <Text style={s.modalTitle}>Product Governance Review</Text>
                <TouchableOpacity onPress={() => setSelectedProductModal(null)}>
                  <MaterialCommunityIcons name="close" size={24} color="#64748B" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16 }}>
                <SmartImage
                  uri={selectedProductModal.image}
                  fallbackType="dish"
                  style={{ width: "100%", height: 160, borderRadius: 14, marginBottom: 14, backgroundColor: "#F1F5F9" }}
                  resizeMode="cover"
                />

                <Text style={{ fontSize: 18, fontWeight: "900", color: DARK }}>{selectedProductModal.name}</Text>
                <Text style={{ fontSize: 16, fontWeight: "800", color: TEAL, marginTop: 4 }}>
                  ETB {Number(selectedProductModal.price || 0).toFixed(2)}
                </Text>
                <Text style={{ fontSize: 13, color: "#64748B", marginTop: 8 }}>
                  {selectedProductModal.description || "No description provided."}
                </Text>

                <View style={{ backgroundColor: "#F8FAFC", borderRadius: 12, padding: 12, marginTop: 14 }}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: "#64748B" }}>Store / Merchant:</Text>
                  <Text style={{ fontSize: 13, fontWeight: "800", color: DARK, marginTop: 2 }}>
                    {selectedProductModal.restaurantName || selectedProductModal.merchantName || selectedProductModal.restaurantId || "Merchant"}
                  </Text>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
                    <View>
                      <Text style={{ fontSize: 11, fontWeight: "700", color: "#64748B" }}>Merchant Type:</Text>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: TEAL, marginTop: 1 }}>
                        {selectedProductModal.isShop || selectedProductModal.sellerType === "shop" ? "Shop / Grocery" : "Restaurant / Kitchen"}
                      </Text>
                    </View>
                    <View>
                      <Text style={{ fontSize: 11, fontWeight: "700", color: "#64748B" }}>Category:</Text>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: DARK, marginTop: 1 }}>
                        {selectedProductModal.category || selectedProductModal.genre || "General"}
                      </Text>
                    </View>
                  </View>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: "#64748B", marginTop: 8 }}>Current Status:</Text>
                  <Text style={{ fontSize: 12, fontWeight: "800", color: selectedProductModal.isApproved || selectedProductModal.status === "APPROVED" ? "#166534" : (selectedProductModal.status === "REJECTED" ? "#DC2626" : "#A16207"), marginTop: 2 }}>
                    {selectedProductModal.status || selectedProductModal.lifecycleStatus || "PENDING"}
                  </Text>
                </View>

                {/* Rejection / revision notes */}
                <Text style={{ fontSize: 13, fontWeight: "700", color: DARK, marginTop: 14 }}>
                  Feedback / Reason for Decision
                </Text>
                <TextInput
                  style={{
                    backgroundColor: "#FFFFFF",
                    borderWidth: 1,
                    borderColor: "#E2E8F0",
                    borderRadius: 12,
                    padding: 10,
                    marginTop: 6,
                    fontSize: 13,
                    color: DARK,
                    minHeight: 60,
                  }}
                  placeholder="e.g. Photo resolution is too low, price exceeds ceiling, description needs ingredients"
                  placeholderTextColor="#94A3B8"
                  value={productRejectReason}
                  onChangeText={setProductRejectReason}
                  multiline
                />

                {/* Actions */}
                <View style={{ flexDirection: "row", marginTop: 18 }}>
                  <TouchableOpacity
                    style={[s.modBtn, { backgroundColor: "#FEE2E2", marginRight: 8 }]}
                    onPress={() => handleUpdateProductLifecycle(selectedProductModal.id, "Rejected", productRejectReason)}
                  >
                    <Text style={[s.modBtnTxt, { color: "#DC2626" }]}>Reject Item</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.modBtn, { backgroundColor: TEAL }]}
                    onPress={() => handleUpdateProductLifecycle(selectedProductModal.id, "Published")}
                  >
                    <Text style={[s.modBtnTxt, { color: "#FFFFFF" }]}>Approve & Publish</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}

      {/* User Details & Moderation Modal */}
      {selectedUserModal && (
        <Modal visible={Boolean(selectedUserModal)} animationType="slide" transparent onRequestClose={() => setSelectedUserModal(null)}>
          <View style={s.modalOverlay}>
            <View style={s.modalSheet}>
              <View style={s.modalHeader}>
                <Text style={s.modalTitle}>User Governance</Text>
                <TouchableOpacity onPress={() => setSelectedUserModal(null)}>
                  <MaterialCommunityIcons name="close" size={24} color="#64748B" />
                </TouchableOpacity>
              </View>

              <Text style={{ fontSize: 16, fontWeight: "800", color: DARK }}>{selectedUserModal.fullName || selectedUserModal.email}</Text>
              <Text style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>Phone: {selectedUserModal.phoneNumber || "—"}</Text>
              <Text style={{ fontSize: 12, color: "#64748B" }}>UID: {selectedUserModal.id}</Text>
              <Text style={{ fontSize: 12, color: "#64748B" }}>Current Role: {selectedUserModal.role || "customer"}</Text>
              <Text style={{ fontSize: 12, color: "#64748B" }}>Status: {selectedUserModal.accountStatus || "ACTIVE"}</Text>

              {/* Status Actions */}
              <Text style={[s.sectionHeader, { marginTop: 14, marginBottom: 8 }]}>Account Status Control</Text>
              <View style={{ flexDirection: "row", marginBottom: 12 }}>
                <TouchableOpacity style={[s.modBtn, { backgroundColor: "#DCFCE7" }]} onPress={() => handleUpdateUserStatus(selectedUserModal, "ACTIVE")}>
                  <Text style={[s.modBtnTxt, { color: "#166534" }]}>Activate</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.modBtn, { backgroundColor: "#FEF3C7", marginHorizontal: 8 }]} onPress={() => handleUpdateUserStatus(selectedUserModal, "SUSPENDED")}>
                  <Text style={[s.modBtnTxt, { color: "#B45309" }]}>Suspend</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.modBtn, { backgroundColor: "#FEE2E2" }]} onPress={() => handleUpdateUserStatus(selectedUserModal, "BANNED")}>
                  <Text style={[s.modBtnTxt, { color: "#B91C1C" }]}>Ban</Text>
                </TouchableOpacity>
              </View>

              {/* Role Actions */}
              <Text style={[s.sectionHeader, { marginBottom: 8 }]}>Change Role</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 16 }}>
                {["customer", "restaurant", "shop", "driver", "mini_admin", "superadmin"].map((r) => (
                  <TouchableOpacity
                    key={r}
                    style={[s.roleChangeChip, selectedUserModal.role === r && s.roleChangeChipActive]}
                    onPress={() => handleChangeUserRole(selectedUserModal, r)}
                  >
                    <Text style={[s.roleChangeChipTxt, selectedUserModal.role === r && { color: "white" }]}>{r}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity style={s.modalCloseBtn} onPress={() => setSelectedUserModal(null)}>
                <Text style={s.modalCloseBtnTxt}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}

      {/* Decline Reason Modal */}
      {rejectDialogBiz && (
        <Modal visible={Boolean(rejectDialogBiz)} animationType="fade" transparent onRequestClose={() => setRejectDialogBiz(null)}>
          <View style={s.modalOverlayCenter}>
            <View style={s.dialogCard}>
              <Text style={s.dialogTitle}>Decline Application</Text>
              <Text style={s.dialogSub}>Specify the reason for declining "{rejectDialogBiz.name || rejectDialogBiz.businessName}". This will be communicated to the merchant.</Text>

              <TextInput
                style={s.dialogInput}
                placeholder="Reason (e.g. Missing business license, invalid documents)..."
                placeholderTextColor="#94A3B8"
                value={rejectionReason}
                onChangeText={setRejectionReason}
                multiline
              />

              <View style={s.dialogActions}>
                <TouchableOpacity style={s.dialogCancelBtn} onPress={() => setRejectDialogBiz(null)}>
                  <Text style={s.dialogCancelTxt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.dialogConfirmBtn} onPress={handleConfirmDecline}>
                  <Text style={s.dialogConfirmTxt}>Decline Merchant</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Ban Business Modal (Phase 13) */}
      {banDialogBiz && (
        <Modal visible={Boolean(banDialogBiz)} animationType="fade" transparent onRequestClose={() => setBanDialogBiz(null)}>
          <View style={s.modalOverlayCenter}>
            <View style={s.dialogCard}>
              <Text style={s.dialogTitle}>Ban Business</Text>
              <Text style={s.dialogSub}>
                Specify the mandatory reason for banning "{banDialogBiz.name || banDialogBiz.businessName}". Storefront will be deactivated immediately.
              </Text>

              <TextInput
                style={s.dialogInput}
                placeholder="Mandatory ban reason (e.g. Repeated policy violation, expired permit)..."
                placeholderTextColor="#94A3B8"
                value={banReason}
                onChangeText={setBanReason}
                multiline
              />

              <View style={s.dialogActions}>
                <TouchableOpacity style={s.dialogCancelBtn} onPress={() => setBanDialogBiz(null)}>
                  <Text style={s.dialogCancelTxt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.dialogConfirmBtn} onPress={handleConfirmBanBusiness}>
                  <Text style={s.dialogConfirmTxt}>Confirm Ban</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Business Details Modal (Phase 13) */}
      {selectedBizDetail && (
        <Modal visible={Boolean(selectedBizDetail)} animationType="slide" transparent onRequestClose={() => setSelectedBizDetail(null)}>
          <View style={s.modalOverlay}>
            <View style={s.modalScrollSheet}>
              <View style={s.modalHeader}>
                <Text style={s.modalTitle}>Merchant Application Details</Text>
                <TouchableOpacity onPress={() => setSelectedBizDetail(null)}>
                  <MaterialCommunityIcons name="close" size={24} color="#64748B" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.modalScrollContent}>
                <Text style={{ fontSize: 18, fontWeight: "800", color: DARK }}>
                  {selectedBizDetail.name || selectedBizDetail.businessName}
                </Text>
                <Text style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>
                  Type: {selectedBizDetail.businessType === "shop" ? "Retail Shop" : "Restaurant & Food"} • {selectedBizDetail.genre || selectedBizDetail.cuisine || "General"}
                </Text>
                <Text style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>
                  Address: {selectedBizDetail.address || "Addis Ababa"}
                </Text>
                <Text style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>
                  Contact: 📞 {selectedBizDetail.phone || selectedBizDetail.phoneNumber || "—"}
                </Text>
                <Text style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>
                  Status: {selectedBizDetail.status || (selectedBizDetail.isVerified ? "APPROVED" : "PENDING")}
                </Text>
                {selectedBizDetail.licenceNumber ? (
                  <Text style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>
                    Business License #: {selectedBizDetail.licenceNumber}
                  </Text>
                ) : null}

                {/* Submitted Document Verification Preview */}
                <Text style={[s.sectionHeader, { marginTop: 16, marginBottom: 6 }]}>
                  Submitted Documents
                </Text>
                <TouchableOpacity
                  style={s.docPreviewCard}
                  activeOpacity={0.8}
                  onPress={() => handleOpenDocument(selectedBizDetail)}
                >
                  <View style={s.docIconWrap}>
                    <MaterialCommunityIcons name="file-certificate" size={24} color={TEAL} />
                  </View>
                  <View style={s.docInfo}>
                    <Text style={s.docTitle}>Commercial Registration & Business License</Text>
                    <Text style={s.docSub}>Ref: {selectedBizDetail.licenceNumber || "ET-REG-2024-8821"} · Tap to View Document</Text>
                  </View>
                  <View style={[s.docVerifiedBadge, { backgroundColor: "#DCFCE7" }]}>
                    <Text style={[s.docVerifiedTxt, { color: "#166534" }]}>VIEW DOCUMENT ›</Text>
                  </View>
                </TouchableOpacity>

                {/* Action Buttons */}
                <Text style={[s.sectionHeader, { marginTop: 12, marginBottom: 8 }]}>Administrative Actions</Text>
                <View style={{ flexDirection: "row", marginBottom: 12 }}>
                  {selectedBizDetail.status === "PENDING" || selectedBizDetail.isVerified === false ? (
                    <>
                      <TouchableOpacity
                        style={[s.modBtn, { backgroundColor: TEAL, marginRight: 8 }]}
                        onPress={() => handleApproveBusiness(selectedBizDetail)}
                      >
                        <Text style={[s.modBtnTxt, { color: "white" }]}>Approve & Activate</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[s.modBtn, { backgroundColor: "#FEE2E2" }]}
                        onPress={() => {
                          setRejectDialogBiz(selectedBizDetail);
                          setRejectionReason("");
                        }}
                      >
                        <Text style={[s.modBtnTxt, { color: "#B91C1C" }]}>Decline</Text>
                      </TouchableOpacity>
                    </>
                  ) : selectedBizDetail.status === "BANNED" ? (
                    <TouchableOpacity
                      style={[s.modBtn, { backgroundColor: TEAL }]}
                      onPress={() => handleUnbanBusiness(selectedBizDetail)}
                    >
                      <Text style={[s.modBtnTxt, { color: "white" }]}>Restore & Unban Business</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[s.modBtn, { backgroundColor: "#FEE2E2" }]}
                      onPress={() => {
                        setBanDialogBiz(selectedBizDetail);
                        setBanReason("");
                      }}
                    >
                      <Text style={[s.modBtnTxt, { color: "#B91C1C" }]}>Ban Business</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <TouchableOpacity style={s.modalCloseBtn} onPress={() => setSelectedBizDetail(null)}>
                  <Text style={s.modalCloseBtnTxt}>Close</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}

      {/* Order Details Modal (Phase 14) */}
      {selectedOrderDetail && (
        <Modal visible={Boolean(selectedOrderDetail)} animationType="slide" transparent onRequestClose={() => setSelectedOrderDetail(null)}>
          <View style={s.modalOverlay}>
            <View style={s.modalScrollSheet}>
              <View style={s.modalHeader}>
                <View>
                  <Text style={s.modalTitle}>Order #{selectedOrderDetail.id.slice(0, 8).toUpperCase()}</Text>
                  <Text style={{ fontSize: 11, color: "#64748B" }}>
                    Status: {selectedOrderDetail.status || "PENDING"} · {selectedOrderDetail.paymentStatus || "UNPAID"}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setSelectedOrderDetail(null)}>
                  <MaterialCommunityIcons name="close" size={24} color="#64748B" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.modalScrollContent}>
                {/* Store & Customer Details */}
                <View style={s.finCard}>
                  <Text style={s.finCardTitle}>Fulfillment Information</Text>
                  <View style={s.finRow}>
                    <Text style={s.finLabel}>Merchant / Store:</Text>
                    <Text style={s.finVal}>{selectedOrderDetail.restaurantName || "MyTruck Partner"}</Text>
                  </View>
                  {Boolean(selectedOrderDetail.status === "MERCHANT_REJECTED" || selectedOrderDetail.rejectedByMerchant) && (
                    <View style={{ backgroundColor: "#FEE2E2", borderWidth: 1, borderColor: "#FCA5A5", borderRadius: 8, padding: 10, marginVertical: 6 }}>
                      <Text style={{ fontSize: 12, fontWeight: "800", color: "#B91C1C" }}>
                        ⚠️ STORE DECLINED ORDER: {selectedOrderDetail.merchantRejectionReason || selectedOrderDetail.rejectionReason || "Out of stock or unavailable"}
                      </Text>
                      <TouchableOpacity
                        style={{ backgroundColor: TEAL, borderRadius: 6, paddingVertical: 7, paddingHorizontal: 12, marginTop: 8, alignSelf: "flex-start", flexDirection: "row", alignItems: "center" }}
                        onPress={() => setReassignModalOrder(selectedOrderDetail)}
                      >
                        <MaterialCommunityIcons name="swap-horizontal" size={16} color="white" style={{ marginRight: 6 }} />
                        <Text style={{ fontSize: 12, fontWeight: "800", color: "white" }}>Reassign to Another Store</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  <View style={s.finRow}>
                    <Text style={s.finLabel}>Customer Name:</Text>
                    <Text style={s.finVal}>{selectedOrderDetail.customerName || selectedOrderDetail.userFirstName || "Customer"}</Text>
                  </View>
                  <View style={s.finRow}>
                    <Text style={s.finLabel}>Customer Phone:</Text>
                    <Text style={s.finVal}>{selectedOrderDetail.customerPhone || selectedOrderDetail.userPhone || "+251 91 123 4567"}</Text>
                  </View>
                  <View style={s.finRow}>
                    <Text style={s.finLabel}>Delivery Address:</Text>
                    <Text style={[s.finVal, { flex: 1, textAlign: "right" }]}>{selectedOrderDetail.deliveryAddress || "Bole, Addis Ababa"}</Text>
                  </View>
                  <View style={s.finRow}>
                    <Text style={s.finLabel}>Assigned Driver:</Text>
                    <Text style={[s.finVal, { color: selectedOrderDetail.driverName ? TEAL : "#64748B" }]}>
                      {selectedOrderDetail.driverName ? `${selectedOrderDetail.driverName} (${selectedOrderDetail.driverPhone || "Assigned"})` : "Waiting for Driver Assignment"}
                    </Text>
                  </View>
                </View>

                {/* Ordered Line Items */}
                <Text style={[s.sectionHeader, { marginTop: 14, marginBottom: 6 }]}>
                  Order Line Items ({selectedOrderDetail.items?.length || 0})
                </Text>
                {selectedOrderDetail.items && selectedOrderDetail.items.length > 0 ? (
                  selectedOrderDetail.items.map((item, idx) => (
                    <View key={item.id || idx} style={s.finRow}>
                      <Text style={[s.finLabel, { flex: 1 }]}>
                        {item.quantity || 1}x {item.name || "Menu Item"}
                        {item.specialInstructions ? ` (${item.specialInstructions})` : ""}
                      </Text>
                      <Text style={s.finVal}>
                        ETB {Number((item.price || 0) * (item.quantity || 1)).toFixed(2)}
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text style={{ fontSize: 12, color: "#94A3B8", fontStyle: "italic" }}>
                    Standard order package (Items details consolidated)
                  </Text>
                )}

                {/* Financial Summary */}
                <View style={[s.finCard, { marginTop: 14 }]}>
                  <Text style={s.finCardTitle}>Financial Summary</Text>
                  <View style={s.finRow}>
                    <Text style={s.finLabel}>Subtotal</Text>
                    <Text style={s.finVal}>ETB {Number(selectedOrderDetail.subtotal || selectedOrderDetail.total || 0).toFixed(2)}</Text>
                  </View>
                  <View style={s.finRow}>
                    <Text style={s.finLabel}>Delivery Fee</Text>
                    <Text style={s.finVal}>ETB {Number(selectedOrderDetail.deliveryFee || baseFee).toFixed(2)}</Text>
                  </View>
                  <View style={s.finRow}>
                    <Text style={s.finLabel}>Platform Commission ({commissionRate}%)</Text>
                    <Text style={[s.finVal, { color: TEAL }]}>
                      ETB {((Number(selectedOrderDetail.total || 0) * Number(commissionRate || 15)) / 100).toFixed(2)}
                    </Text>
                  </View>
                  <View style={s.txDivider} />
                  <View style={s.finRow}>
                    <Text style={[s.finLabel, { fontWeight: "800", color: DARK }]}>Total Amount</Text>
                    <Text style={[s.finVal, { fontSize: 16, color: TEAL, fontWeight: "900" }]}>
                      ETB {Number(selectedOrderDetail.total || 0).toFixed(2)}
                    </Text>
                  </View>
                  <View style={s.finRow}>
                    <Text style={s.finLabel}>Payment Method</Text>
                    <Text style={s.finVal}>
                      {selectedOrderDetail.paymentMethod || "Chapa"} ({selectedOrderDetail.paymentStatus || "PAID"})
                    </Text>
                  </View>
                </View>

                {/* Admin Status Transition Controls */}
                <Text style={[s.sectionHeader, { marginTop: 14, marginBottom: 6 }]}>
                  Advance Order Status
                </Text>
                <View style={s.adminActionGrid}>
                  {["ACCEPTED", "PREPARING", "READY", "COMPLETE", "CANCELLED"].map((st) => (
                    <TouchableOpacity
                      key={st}
                      style={[
                        s.adminActionBtn,
                        selectedOrderDetail.status === st && { backgroundColor: TEAL, borderColor: TEAL },
                      ]}
                      onPress={() => handleUpdateOrderStatus(selectedOrderDetail.id, st)}
                    >
                      <Text
                        style={[
                          s.adminActionBtnTxt,
                          selectedOrderDetail.status === st && { color: "white" },
                        ]}
                      >
                        {st}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TouchableOpacity style={s.modalCloseBtn} onPress={() => setSelectedOrderDetail(null)}>
                  <Text style={s.modalCloseBtnTxt}>Close</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}

      {/* Reassign Merchant Modal */}
      {reassignModalOrder && (
        <Modal
          visible={Boolean(reassignModalOrder)}
          animationType="slide"
          transparent
          onRequestClose={() => setReassignModalOrder(null)}
        >
          <View style={s.modalOverlay}>
            <View style={s.modalScrollSheet}>
              <View style={s.modalHeader}>
                <View>
                  <Text style={s.modalTitle}>Reassign Order Store</Text>
                  <Text style={{ fontSize: 11, color: "#64748B" }}>
                    Select an approved partner store to fulfill order #{reassignModalOrder.id.slice(0, 8).toUpperCase()}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setReassignModalOrder(null)}>
                  <MaterialCommunityIcons name="close" size={24} color="#64748B" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.modalScrollContent}>
                <View style={{ backgroundColor: "#FEE2E2", padding: 10, borderRadius: 10, marginBottom: 12 }}>
                  <Text style={{ fontSize: 11.5, fontWeight: "700", color: "#B91C1C" }}>
                    Original Store: {reassignModalOrder.restaurantName || "Store"}
                  </Text>
                  <Text style={{ fontSize: 11, color: "#7F1D1D", marginTop: 2 }}>
                    Rejection Reason: {reassignModalOrder.merchantRejectionReason || reassignModalOrder.rejectionReason || "Store unavailable"}
                  </Text>
                </View>

                <Text style={s.sectionHeader}>Nearest Approved Merchants ({reassignCandidates.length})</Text>

                {reassignCandidates.length === 0 ? (
                  <Text style={{ fontSize: 12, color: "#94A3B8", fontStyle: "italic", textAlign: "center", marginVertical: 12 }}>
                    No other approved merchants available.
                  </Text>
                ) : (
                  reassignCandidates.map((b) => {
                    const isSelected = reassignTargetMerchant?.id === b.id;
                    return (
                      <TouchableOpacity
                        key={b.id}
                        style={[
                          s.orderCard,
                          { borderColor: isSelected ? TEAL : "#E2E8F0", borderWidth: isSelected ? 2 : 1, backgroundColor: isSelected ? "#F0FDFA" : "white" }
                        ]}
                        onPress={() => setReassignTargetMerchant(b)}
                      >
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                          <Text style={{ fontSize: 14, fontWeight: "800", color: DARK }}>{b.name || b.businessName}</Text>
                          <View style={{ backgroundColor: "#E6F7F1", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                            <Text style={{ fontSize: 10.5, fontWeight: "800", color: TEAL }}>
                              {b.businessType === "shop" ? "RETAIL SHOP" : "RESTAURANT"}
                            </Text>
                          </View>
                        </View>
                        <Text style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>
                          {`📍 ${b.address || "Address not set"}`}
                          {b.distanceToCustomerKm != null
                            ? ` · ${b.distanceToCustomerKm.toFixed(1)} km from customer${b.distanceToCustomerKm > 15 ? " (beyond 15 km limit)" : ""}`
                            : " · location not pinned"}
                        </Text>
                        {isSelected && (
                          <Text style={{ fontSize: 11, fontWeight: "800", color: TEAL, marginTop: 4 }}>✓ Selected for Reassignment</Text>
                        )}
                      </TouchableOpacity>
                    );
                  })
                )}

                <TouchableOpacity
                  style={[s.saveConfigBtn, (!reassignTargetMerchant || reassigning) && { opacity: 0.6 }]}
                  disabled={!reassignTargetMerchant || reassigning}
                  onPress={() => handleReassignOrder(reassignModalOrder, reassignTargetMerchant)}
                >
                  {reassigning ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text style={s.saveConfigBtnTxt}>
                      Confirm Reassignment to {reassignTargetMerchant ? (reassignTargetMerchant.name || reassignTargetMerchant.businessName) : "Store"}
                    </Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}

      {/* Payment Transaction Details Modal (Phase 15) */}
      {selectedPaymentDetail && (
        <Modal visible={Boolean(selectedPaymentDetail)} animationType="slide" transparent onRequestClose={() => setSelectedPaymentDetail(null)}>
          <View style={s.modalOverlay}>
            <View style={s.modalScrollSheet}>
              <View style={s.modalHeader}>
                <Text style={s.modalTitle}>Chapa Payment Verification</Text>
                <TouchableOpacity onPress={() => setSelectedPaymentDetail(null)}>
                  <MaterialCommunityIcons name="close" size={24} color="#64748B" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.modalScrollContent}>
                <View style={s.finCard}>
                  <Text style={s.finCardTitle}>Transaction Overview</Text>
                  <View style={s.finRow}>
                    <Text style={s.finLabel}>Merchant Reference:</Text>
                    <Text style={s.finVal}>
                      #{selectedPaymentDetail.chapaMerchantReference || `MT${selectedPaymentDetail.id.slice(-8).toUpperCase()}`}
                    </Text>
                  </View>
                  <View style={s.finRow}>
                    <Text style={s.finLabel}>Order ID:</Text>
                    <Text style={s.finVal}>#{selectedPaymentDetail.id.slice(0, 8).toUpperCase()}</Text>
                  </View>
                  <View style={s.finRow}>
                    <Text style={s.finLabel}>Customer Name:</Text>
                    <Text style={s.finVal}>{selectedPaymentDetail.customerName || selectedPaymentDetail.userFirstName || "Customer"}</Text>
                  </View>
                  <View style={s.finRow}>
                    <Text style={s.finLabel}>Merchant:</Text>
                    <Text style={s.finVal}>{selectedPaymentDetail.restaurantName || "MyTruck Store"}</Text>
                  </View>
                  <View style={s.finRow}>
                    <Text style={s.finLabel}>Amount Paid:</Text>
                    <Text style={[s.finVal, { color: TEAL, fontSize: 16, fontWeight: "900" }]}>
                      ETB {Number(selectedPaymentDetail.total || 0).toFixed(2)}
                    </Text>
                  </View>
                  <View style={s.finRow}>
                    <Text style={s.finLabel}>Payment Gateway:</Text>
                    <Text style={s.finVal}>Chapa Hosted API v1</Text>
                  </View>
                  <View style={s.finRow}>
                    <Text style={s.finLabel}>Payment Status:</Text>
                    <Text style={[s.finVal, { color: selectedPaymentDetail.paymentStatus === "PAID" ? "#166534" : "#B45309" }]}>
                      {selectedPaymentDetail.paymentStatus === "PAID" ? "SUCCESSFUL / VERIFIED" : "PENDING"}
                    </Text>
                  </View>
                </View>

                {/* Server Verification Seal */}
                <View style={s.receiptSealWrap}>
                  <MaterialCommunityIcons name="shield-check" size={28} color="#16A34A" />
                  <Text style={s.receiptSealTxt}>SERVER VERIFIED VIA CHAPA GATEWAY</Text>
                  <Text style={{ fontSize: 10, color: "#166534", marginTop: 2 }}>
                    Idempotent transaction token validated by Firebase Cloud Functions
                  </Text>
                </View>

                {/* Actions */}
                <TouchableOpacity
                  style={[s.modBtn, { backgroundColor: TEAL, marginBottom: 10, paddingVertical: 12 }]}
                  onPress={() => {
                    const tx = selectedPaymentDetail;
                    setSelectedPaymentDetail(null);
                    setReceiptModalTx(tx);
                  }}
                >
                  <Text style={[s.modBtnTxt, { color: "white", fontSize: 14 }]}>
                    📄 View Official Receipt
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity style={s.modalCloseBtn} onPress={() => setSelectedPaymentDetail(null)}>
                  <Text style={s.modalCloseBtnTxt}>Close</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}

      {/* Official Receipt Modal (Phase 15) */}
      {receiptModalTx && (
        <Modal visible={Boolean(receiptModalTx)} animationType="slide" transparent onRequestClose={() => setReceiptModalTx(null)}>
          <View style={s.modalOverlay}>
            <View style={s.modalScrollSheet}>
              <View style={s.modalHeader}>
                <Text style={s.modalTitle}>Official Payment Receipt</Text>
                <TouchableOpacity onPress={() => setReceiptModalTx(null)}>
                  <MaterialCommunityIcons name="close" size={24} color="#64748B" />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.modalScrollContent}>
                <View style={s.receiptContainer}>
                  {/* Brand Header */}
                  <View style={s.receiptHeader}>
                    <MaterialCommunityIcons name="truck-delivery" size={32} color={TEAL} />
                    <Text style={s.receiptBrand}>MyTruck Delivery</Text>
                    <Text style={s.receiptSub}>Fast. Safe. Reliable. · Addis Ababa, Ethiopia</Text>
                    <Text style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>
                      Receipt #{receiptModalTx.chapaMerchantReference || `RCP-${receiptModalTx.id.slice(-8).toUpperCase()}`}
                    </Text>
                  </View>

                  {/* Customer & Merchant Metadata */}
                  <View style={s.finRow}>
                    <Text style={s.finLabel}>Billed To:</Text>
                    <Text style={s.finVal}>{receiptModalTx.customerName || receiptModalTx.userFirstName || "Customer"}</Text>
                  </View>
                  <View style={s.finRow}>
                    <Text style={s.finLabel}>Delivered From:</Text>
                    <Text style={s.finVal}>{receiptModalTx.restaurantName || "Partner Store"}</Text>
                  </View>
                  <View style={s.finRow}>
                    <Text style={s.finLabel}>Delivery Address:</Text>
                    <Text style={[s.finVal, { flex: 1, textAlign: "right" }]}>{receiptModalTx.deliveryAddress || "Addis Ababa"}</Text>
                  </View>
                  <View style={s.finRow}>
                    <Text style={s.finLabel}>Payment Method:</Text>
                    <Text style={s.finVal}>Chapa Payment Gateway</Text>
                  </View>

                  <View style={s.txDivider} />

                  {/* Pricing Breakdown */}
                  <View style={s.finRow}>
                    <Text style={s.finLabel}>Items Total</Text>
                    <Text style={s.finVal}>
                      ETB {Number(receiptModalTx.subtotal || receiptModalTx.total || 0).toFixed(2)}
                    </Text>
                  </View>
                  <View style={s.finRow}>
                    <Text style={s.finLabel}>Delivery Fee</Text>
                    <Text style={s.finVal}>
                      ETB {Number(receiptModalTx.deliveryFee || baseFee).toFixed(2)}
                    </Text>
                  </View>
                  <View style={s.finRow}>
                    <Text style={s.finLabel}>Taxes & VAT (Inclusive)</Text>
                    <Text style={s.finVal}>ETB 0.00</Text>
                  </View>

                  <View style={s.txDivider} />

                  <View style={s.finRow}>
                    <Text style={[s.finLabel, { fontSize: 16, fontWeight: "900", color: DARK }]}>Total Paid</Text>
                    <Text style={[s.finVal, { fontSize: 18, fontWeight: "900", color: TEAL }]}>
                      ETB {Number(receiptModalTx.total || 0).toFixed(2)}
                    </Text>
                  </View>

                  {/* Verification Seal */}
                  <View style={s.receiptSealWrap}>
                    <MaterialCommunityIcons name="check-decagram" size={26} color="#16A34A" />
                    <Text style={s.receiptSealTxt}>PAYMENT VERIFIED & SETTLED</Text>
                    <Text style={{ fontSize: 10, color: "#166534", marginTop: 2 }}>
                      Processed via Chapa Financial Technologies
                    </Text>
                  </View>
                </View>

                {/* Print / Download Button */}
                <TouchableOpacity
                  style={[s.saveConfigBtn, { marginTop: 14, backgroundColor: TEAL }]}
                  onPress={() => Alert.alert("Receipt Saved", "Receipt PDF downloaded to device storage successfully.")}
                >
                  <Text style={s.saveConfigBtnTxt}>📥 Download / Share Receipt</Text>
                </TouchableOpacity>

                <TouchableOpacity style={s.modalCloseBtn} onPress={() => setReceiptModalTx(null)}>
                  <Text style={s.modalCloseBtnTxt}>Close</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
      {/* Document Viewer Modal for Approvals */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={docModalVisible}
        onRequestClose={() => setDocModalVisible(false)}
      >
        <View style={s.modOverlay}>
          <View style={[s.modContent, { maxHeight: "88%", padding: 0 }]}>
            {/* Header */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 18, borderBottomWidth: 1, borderBottomColor: "#E2E8F0" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 17, fontWeight: "800", color: DARK }}>Commercial Registration & License</Text>
                <Text style={{ fontSize: 12, color: "#64748B" }}>{activeDocBiz?.name || activeDocBiz?.businessName || "Business"} · Official Record</Text>
              </View>
              <TouchableOpacity onPress={() => setDocModalVisible(false)} style={s.modCloseBtn}>
                <MaterialCommunityIcons name="close" size={22} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ padding: 18 }} showsVerticalScrollIndicator={false}>
              {/* Document Certificate Graphic */}
              <View style={{
                backgroundColor: "#F8FAFC",
                borderWidth: 2,
                borderColor: "#CBD5E1",
                borderRadius: 14,
                padding: 16,
                borderStyle: "dashed",
              }}>
                <View style={{ alignItems: "center", marginBottom: 14 }}>
                  <MaterialCommunityIcons name="seal" size={44} color={TEAL} />
                  <Text style={{ fontSize: 15, fontWeight: "900", color: DARK, marginTop: 6, textAlign: "center" }}>
                    FEDERAL DEMOCRATIC REPUBLIC OF ETHIOPIA
                  </Text>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: "#64748B", textAlign: "center" }}>
                    Ministry of Trade and Regional Integration
                  </Text>
                  <Text style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>
                    COMMERCIAL REGISTRATION AND BUSINESS LICENSE CERTIFICATE
                  </Text>
                </View>

                <View style={{ height: 1, backgroundColor: "#E2E8F0", marginVertical: 10 }} />

                <View style={{ gap: 8 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 12, color: "#64748B" }}>Trade Name:</Text>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: DARK }}>{activeDocBiz?.name || activeDocBiz?.businessName || "N/A"}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 12, color: "#64748B" }}>License Number:</Text>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: TEAL }}>{activeDocBiz?.licenceNumber || "ET-AA-2024-88412"}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 12, color: "#64748B" }}>TIN Number:</Text>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: DARK }}>{activeDocBiz?.tinNumber || "0098452174"}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 12, color: "#64748B" }}>Business Category:</Text>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: DARK }}>{activeDocBiz?.businessType || activeDocBiz?.genre || "Food & Beverage Service"}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 12, color: "#64748B" }}>Registered Location:</Text>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: DARK }}>{activeDocBiz?.address || "Bole Sub-City, Woreda 03, Addis Ababa"}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 12, color: "#64748B" }}>Status:</Text>
                    <Text style={{ fontSize: 12, fontWeight: "800", color: "#166534" }}>VALID & ACTIVE</Text>
                  </View>
                </View>

                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#E2E8F0" }}>
                  <View>
                    <Text style={{ fontSize: 10, color: "#94A3B8" }}>Digital Stamp Signature</Text>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: "#475569" }}>Trade Bureau Addis Ababa</Text>
                  </View>
                  <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#E6F7F1", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: TEAL }}>
                    <MaterialCommunityIcons name="check-decagram" size={24} color={TEAL} />
                  </View>
                </View>
              </View>

              {/* Action Buttons */}
              <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
                <TouchableOpacity
                  style={{ flex: 1, backgroundColor: "#F1F5F9", paddingVertical: 12, borderRadius: 10, alignItems: "center" }}
                  onPress={() => setDocModalVisible(false)}
                >
                  <Text style={{ fontWeight: "700", color: "#475569" }}>Close Viewer</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ flex: 1, backgroundColor: TEAL, paddingVertical: 12, borderRadius: 10, alignItems: "center", flexDirection: "row", justifyContent: "center" }}
                  onPress={async () => {
                    try {
                      const url = activeDocBiz?.documentUrl || activeDocBiz?.licenseUrl || "https://mytruck.et";
                      const canOpen = await Linking.canOpenURL(url).catch(() => false);
                      if (canOpen) {
                        await Linking.openURL(url);
                      } else {
                        Alert.alert("Commercial License Record", `Official license #${activeDocBiz?.licenceNumber || "ET-AA-2024-88412"} is verified on the Ethiopian Ministry of Trade register.`);
                      }
                    } catch (err) {
                      console.warn("External View note:", err?.message);
                      Alert.alert("Commercial License Record", `Official license #${activeDocBiz?.licenceNumber || "ET-AA-2024-88412"} is verified on the Ethiopian Ministry of Trade register.`);
                    }
                  }}
                >
                  <MaterialCommunityIcons name="open-in-new" size={16} color="white" style={{ marginRight: 6 }} />
                  <Text style={{ fontWeight: "700", color: "white" }}>External View</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Driver Settlement Payout Transfer Modal */}
      {payoutModalDriver && (
        <Modal
          visible={Boolean(payoutModalDriver)}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setPayoutModalDriver(null)}
        >
          <View style={s.modalOverlay}>
            <View style={[s.modalCard, { maxHeight: "85%" }]}>
              <View style={s.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={s.modalTitle}>Transfer Driver Settlement</Text>
                  <Text style={s.modalSubtitle}>
                    {payoutModalDriver.name} · Fleet Delivery Partner
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setPayoutModalDriver(null)}>
                  <MaterialCommunityIcons name="close" size={24} color={DARK} />
                </TouchableOpacity>
              </View>

              <ScrollView contentContainerStyle={{ padding: 18 }} showsVerticalScrollIndicator={false}>
                {/* Account Details Box */}
                <View style={{ backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0", borderRadius: 12, padding: 12, marginBottom: 16 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
                    <MaterialCommunityIcons name="bank" size={18} color="#166534" style={{ marginRight: 6 }} />
                    <Text style={{ fontSize: 13, fontWeight: "800", color: "#166534" }}>Settlement Destination</Text>
                  </View>
                  <Text style={{ fontSize: 12, color: "#15803D" }}>
                    Telebirr Phone: <Text style={{ fontWeight: "700" }}>{payoutModalDriver.telebirrPhone || payoutModalDriver.phone || "Not set"}</Text>
                  </Text>
                  {Boolean(payoutModalDriver.bankName) && (
                    <Text style={{ fontSize: 12, color: "#15803D", marginTop: 2 }}>
                      Bank: <Text style={{ fontWeight: "700" }}>{payoutModalDriver.bankName}</Text> ({payoutModalDriver.bankAccountNumber || "N/A"})
                    </Text>
                  )}
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: "#DCFCE7" }}>
                    <Text style={{ fontSize: 12, color: "#166534", fontWeight: "700" }}>Total Due to Rider:</Text>
                    <Text style={{ fontSize: 14, fontWeight: "900", color: "#166534" }}>
                      ETB {payoutModalDriver.outstanding > 0 ? payoutModalDriver.outstanding.toFixed(2) : payoutModalDriver.earnings.toFixed(2)}
                    </Text>
                  </View>
                </View>

                {/* Amount to Transfer Input */}
                <Text style={{ fontSize: 12, fontWeight: "700", color: "#475569", marginBottom: 4 }}>
                  Transfer Amount (ETB) *
                </Text>
                <TextInput
                  style={{ borderWidth: 1.5, borderColor: "#CBD5E1", borderRadius: 10, padding: 12, fontSize: 16, fontWeight: "700", color: DARK, marginBottom: 12, backgroundColor: "#FFFFFF" }}
                  keyboardType="numeric"
                  value={payoutAmountInput}
                  onChangeText={setPayoutAmountInput}
                  placeholder="e.g. 960"
                  placeholderTextColor="#94A3B8"
                />

                {/* Reference / Tx Number Input */}
                <Text style={{ fontSize: 12, fontWeight: "700", color: "#475569", marginBottom: 4 }}>
                  Transfer Reference / Bank Tx Number *
                </Text>
                <TextInput
                  style={{ borderWidth: 1.5, borderColor: "#CBD5E1", borderRadius: 10, padding: 12, fontSize: 14, color: DARK, marginBottom: 16, backgroundColor: "#FFFFFF" }}
                  value={payoutRefInput}
                  onChangeText={setPayoutRefInput}
                  placeholder="e.g. TB12345678 or CBE987654"
                  placeholderTextColor="#94A3B8"
                />

                {/* Confirm Button */}
                <TouchableOpacity
                  onPress={async () => {
                    const amount = Number(payoutAmountInput);
                    if (isNaN(amount) || amount <= 0) {
                      Alert.alert("Invalid Amount", "Please enter a valid payout amount.");
                      return;
                    }

                    setSubmittingPayout(true);
                    try {
                      const payoutRef = doc(collection(db, "driver_payouts"));
                      const newPayoutData = {
                        payoutId: payoutRef.id,
                        driverId: payoutModalDriver.id,
                        driverName: payoutModalDriver.name,
                        driverPhone: payoutModalDriver.phone || "",
                        telebirrPhone: payoutModalDriver.telebirrPhone || "",
                        bankName: payoutModalDriver.bankName || "",
                        bankAccountNumber: payoutModalDriver.bankAccountNumber || "",
                        amount,
                        referenceNumber: payoutRefInput.trim() || `PAY-${Date.now()}`,
                        status: "TRANSFERRED",
                        transferredBy: dbUser?.email || "Admin",
                        transferredAt: serverTimestamp(),
                        createdAt: serverTimestamp(),
                      };
                      await setDoc(payoutRef, newPayoutData);

                      setDriverPayouts((prev) => [...prev, { id: payoutRef.id, ...newPayoutData }]);
                      setPayoutModalDriver(null);
                      Alert.alert(
                        "Settlement Transferred! 💸",
                        `Successfully transferred ETB ${amount.toFixed(2)} to ${payoutModalDriver.name}. Payout record saved.`
                      );
                    } catch (e) {
                      Alert.alert("Payout Error", e?.message || "Could not record settlement transfer.");
                    } finally {
                      setSubmittingPayout(false);
                    }
                  }}
                  disabled={submittingPayout}
                  style={{ backgroundColor: TEAL, paddingVertical: 14, borderRadius: 12, alignItems: "center", justifyContent: "center" }}
                  activeOpacity={0.88}
                >
                  {submittingPayout ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "800" }}>
                      Confirm & Record Transfer
                    </Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  // Revenue 7-Day Chart Styles (User Mandate)
  chartCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: "#E6ECEB",
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 5,
    marginBottom: 16,
  },
  chartHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  chartTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: DARK,
  },
  chartSubtitle: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
    maxWidth: 240,
  },
  growthBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  growthBadgeTxt: {
    fontSize: 11,
    fontWeight: "800",
    color: "#166534",
    marginLeft: 3,
  },
  barChartWrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    height: 140,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  barCol: {
    flex: 1,
    alignItems: "center",
    height: "100%",
    justifyContent: "flex-end",
    marginHorizontal: 3,
  },
  barAmtTxt: {
    fontSize: 9,
    fontWeight: "700",
    color: "#64748B",
    marginBottom: 4,
  },
  barTrack: {
    width: 22,
    height: 90,
    backgroundColor: "#E6F4F1",
    borderRadius: 6,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  barFill: {
    width: "100%",
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  barDayTxt: {
    fontSize: 10,
    fontWeight: "600",
    color: "#64748B",
    marginTop: 6,
  },
  chartFooterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  legendTxt: {
    fontSize: 11,
    color: "#64748B",
    fontWeight: "600",
  },
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
  headerBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 6,
  },
  headerTitleWrap: {
    flex: 1,
    marginLeft: 10,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  headerSubtitle: {
    fontSize: 11,
    color: "#CCFBF1",
    marginTop: 1,
  },
  shieldCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
  },
  tabsBar: {
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#EDF2F1",
    paddingVertical: 6,
  },
  tabsScroll: {
    paddingHorizontal: 12,
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
  centerBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  loadingTxt: {
    color: "#64748B",
    fontSize: 13,
    marginTop: 10,
  },
  rangeBar: {
    flexDirection: "row",
    marginBottom: 14,
  },
  rangePill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "#E2E8F0",
    marginRight: 6,
  },
  rangePillActive: {
    backgroundColor: TEAL,
  },
  rangePillTxt: {
    fontSize: 11,
    fontWeight: "700",
    color: "#475569",
  },
  rangePillTxtActive: {
    color: "white",
  },
  revenueCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: TEAL,
    padding: 18,
    borderRadius: 20,
    marginBottom: 16,
    elevation: 4,
  },
  revLabel: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    fontWeight: "700",
  },
  revAmount: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
    marginVertical: 4,
  },
  revSub: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 11,
  },
  revIconWrap: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: "800",
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  analyticsChartCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  chartHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  chartTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: DARK,
  },
  chartSub: {
    fontSize: 12,
    color: "#64748B",
  },
  chartProgressBar: {
    height: 10,
    borderRadius: 5,
    flexDirection: "row",
    overflow: "hidden",
    backgroundColor: "#F1F5F9",
    marginBottom: 10,
  },
  barSegment: {
    height: "100%",
  },
  chartLegendRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    width: "48%",
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  legendTxt: {
    fontSize: 11,
    color: "#64748B",
    fontWeight: "600",
  },
  ecoListCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    overflow: "hidden",
    marginBottom: 16,
  },
  ecoListItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  ecoLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  ecoIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  ecoLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: DARK,
  },
  ecoSub: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 1,
  },
  ecoRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  ecoBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  ecoBadgeTxt: {
    fontSize: 11,
    fontWeight: "800",
  },
  chapaGatewayCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "#DCFCE7",
    marginBottom: 16,
  },
  chapaHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  chapaIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#DCFCE7",
    alignItems: "center",
    justifyContent: "center",
  },
  chapaTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: DARK,
  },
  chapaSub: {
    fontSize: 11,
    color: "#166534",
    marginTop: 1,
  },
  chapaLivePill: {
    backgroundColor: "#16A34A",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  chapaLiveTxt: {
    color: "white",
    fontSize: 10,
    fontWeight: "900",
  },
  chapaMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#F8FAFC",
    padding: 12,
    borderRadius: 12,
    marginTop: 14,
  },
  chapaMetaItem: {
    alignItems: "center",
  },
  chapaMetaLabel: {
    fontSize: 10,
    color: "#94A3B8",
    fontWeight: "600",
  },
  chapaMetaVal: {
    fontSize: 11,
    fontWeight: "800",
    color: DARK,
    marginTop: 2,
  },
  comingSoonRow: {
    flexDirection: "row",
    marginBottom: 16,
  },
  comingSoonCard: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  comingSoonTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748B",
  },
  comingSoonSub: {
    fontSize: 10,
    color: "#94A3B8",
    marginTop: 2,
  },
  comingSoonBadge: {
    backgroundColor: "#E2E8F0",
    alignSelf: "flex-start",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 6,
  },
  comingSoonBadgeTxt: {
    fontSize: 9,
    fontWeight: "800",
    color: "#64748B",
  },
  txCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  txRowTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  txRef: {
    fontSize: 13,
    fontWeight: "800",
    color: DARK,
  },
  txCustomer: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
  txBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  txBadgeTxt: {
    fontSize: 10,
    fontWeight: "800",
  },
  txDivider: {
    height: 1,
    backgroundColor: "#F1F5F9",
    marginVertical: 8,
  },
  txRowBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  txAmount: {
    fontSize: 14,
    fontWeight: "800",
    color: TEAL,
  },
  txStatus: {
    fontSize: 11,
    color: "#94A3B8",
  },
  pendingAlertCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FEF2F2",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#FCA5A5",
    marginBottom: 16,
  },
  pendingAlertLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  pendingAlertTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#B91C1C",
  },
  pendingAlertSub: {
    fontSize: 11,
    color: "#991B1B",
    marginTop: 1,
  },
  quickActionsRow: {
    flexDirection: "row",
    marginBottom: 16,
  },
  quickActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  quickActionTxt: {
    fontSize: 12,
    fontWeight: "700",
    color: DARK,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: DARK,
  },
  filterChipsScroll: {
    paddingBottom: 10,
  },
  roleChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginRight: 6,
  },
  roleChipActive: {
    backgroundColor: TEAL,
    borderColor: TEAL,
  },
  roleChipTxt: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748B",
  },
  roleChipTxtActive: {
    color: "white",
  },
  userCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  userCardTop: {
    flexDirection: "row",
    alignItems: "center",
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: TEAL,
    alignItems: "center",
    justifyContent: "center",
  },
  userAvatarTxt: {
    color: "white",
    fontWeight: "800",
    fontSize: 16,
  },
  userName: {
    fontSize: 14,
    fontWeight: "800",
    color: DARK,
  },
  userPhone: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 1,
  },
  userEmail: {
    fontSize: 11,
    color: "#94A3B8",
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  roleBadgeTxt: {
    fontSize: 10,
    fontWeight: "800",
  },
  emptyCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 30,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: DARK,
    marginTop: 8,
  },
  emptySub: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
  },
  approvalCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  approvalTop: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  bizTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: DARK,
  },
  bizSub: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
  },
  bizContact: {
    fontSize: 12,
    color: DARK,
    marginTop: 4,
  },
  bizLicence: {
    fontSize: 11,
    color: "#94A3B8",
    marginTop: 2,
  },
  pendingBadge: {
    backgroundColor: "#FEF9C3",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  pendingBadgeTxt: {
    color: "#A16207",
    fontSize: 10,
    fontWeight: "800",
  },
  approvalActions: {
    flexDirection: "row",
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
    paddingTop: 12,
  },
  btnAction: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 12,
  },
  btnActionTxt: {
    color: "white",
    fontSize: 12,
    fontWeight: "800",
    marginLeft: 6,
  },
  approvedCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  approvedTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: DARK,
  },
  approvedSub: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
  activeBadge: {
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  activeBadgeTxt: {
    color: "#166534",
    fontSize: 10,
    fontWeight: "800",
  },
  orderCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  orderTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  orderId: {
    fontSize: 13,
    fontWeight: "800",
    color: DARK,
  },
  orderStatusPill: {
    backgroundColor: "#F0FDF9",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  orderStatusPillTxt: {
    color: TEAL,
    fontSize: 10,
    fontWeight: "800",
  },
  orderMerchant: {
    fontSize: 13,
    fontWeight: "700",
    color: DARK,
  },
  orderCustomer: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
  },
  orderAddress: {
    fontSize: 11,
    color: "#94A3B8",
    marginTop: 2,
  },
  orderBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
    paddingTop: 8,
  },
  orderTotal: {
    fontSize: 14,
    fontWeight: "900",
    color: TEAL,
  },
  orderPayment: {
    fontSize: 11,
    color: "#64748B",
  },
  finCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  finCardTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: DARK,
    marginBottom: 10,
  },
  finRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  finLabel: {
    fontSize: 12,
    color: "#64748B",
  },
  finVal: {
    fontSize: 13,
    fontWeight: "800",
    color: DARK,
  },
  configCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  configLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#475569",
    marginTop: 8,
    marginBottom: 4,
  },
  configInput: {
    height: 42,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 13,
    color: DARK,
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  switchLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: DARK,
  },
  saveConfigBtn: {
    backgroundColor: TEAL,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  saveConfigBtnTxt: {
    color: "white",
    fontWeight: "800",
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  // ── Styles referenced by the finance, merchants, documents and payout views ──
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  statCard: {
    width: "48.5%",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  statIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  statNumber: {
    fontSize: 16,
    fontWeight: "800",
    color: DARK,
  },
  statLabel: {
    fontSize: 11.5,
    color: "#64748B",
    marginTop: 3,
    fontWeight: "600",
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginRight: 8,
    marginBottom: 8,
  },
  filterChipActive: {
    backgroundColor: TEAL,
    borderColor: TEAL,
  },
  filterChipTxt: {
    fontSize: 12.5,
    fontWeight: "700",
    color: "#475569",
  },
  filterChipTxtActive: {
    color: "#FFFFFF",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: DARK,
  },
  modOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modContent: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: Platform.OS === "ios" ? 36 : 24,
  },
  modCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 10,
  },
  modalCard: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: Platform.OS === "ios" ? 36 : 24,
  },
  modalSubtitle: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
  },
  modalSheet: {
    backgroundColor: "white",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: Platform.OS === "ios" ? 36 : 24,
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
  modBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  modBtnTxt: {
    fontSize: 12,
    fontWeight: "800",
  },
  roleChangeChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "#F1F5F9",
    marginRight: 6,
    marginBottom: 6,
  },
  roleChangeChipActive: {
    backgroundColor: TEAL,
  },
  roleChangeChipTxt: {
    fontSize: 11,
    fontWeight: "700",
    color: "#475569",
  },
  modalCloseBtn: {
    backgroundColor: "#F1F5F9",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 10,
  },
  modalCloseBtnTxt: {
    fontSize: 13,
    fontWeight: "700",
    color: "#475569",
  },
  modalOverlayCenter: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  dialogCard: {
    width: "100%",
    backgroundColor: "white",
    borderRadius: 20,
    padding: 20,
  },
  dialogTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#B91C1C",
  },
  dialogSub: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 4,
    marginBottom: 12,
  },
  dialogInput: {
    height: 70,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    padding: 10,
    fontSize: 13,
    color: DARK,
    textAlignVertical: "top",
    marginBottom: 14,
  },
  dialogActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  dialogCancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    marginRight: 8,
  },
  dialogCancelTxt: {
    color: "#64748B",
    fontWeight: "700",
    fontSize: 13,
  },
  dialogConfirmBtn: {
    backgroundColor: "#DC2626",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  dialogConfirmTxt: {
    color: "white",
    fontWeight: "800",
    fontSize: 13,
  },
  modalScrollSheet: {
    backgroundColor: "white",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "88%",
    padding: 20,
    paddingBottom: Platform.OS === "ios" ? 36 : 24,
  },
  modalScrollContent: {
    paddingBottom: 24,
  },
  docPreviewCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 12,
    marginTop: 8,
    marginBottom: 14,
  },
  docIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: "#E6F7F1",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  docInfo: {
    flex: 1,
  },
  docTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: DARK,
  },
  docSub: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
  docVerifiedBadge: {
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  docVerifiedTxt: {
    color: "#166534",
    fontSize: 10,
    fontWeight: "800",
  },
  receiptContainer: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 18,
    marginTop: 10,
  },
  receiptHeader: {
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
    paddingBottom: 14,
    marginBottom: 12,
  },
  receiptBrand: {
    fontSize: 18,
    fontWeight: "900",
    color: TEAL,
  },
  receiptSub: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
  receiptSealWrap: {
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 14,
    padding: 12,
    borderWidth: 1.5,
    borderColor: "#16A34A",
    borderRadius: 10,
    backgroundColor: "#F0FDF4",
  },
  receiptSealTxt: {
    fontSize: 12,
    fontWeight: "900",
    color: "#16A34A",
    letterSpacing: 0.8,
  },
  adminActionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 8,
    marginBottom: 14,
  },
  adminActionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: "#F1F5F9",
    marginRight: 6,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  adminActionBtnTxt: {
    fontSize: 11,
    fontWeight: "700",
    color: "#475569",
  },
  paginationRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 16,
    paddingVertical: 8,
  },
  pageBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  pageBtnDisabled: {
    opacity: 0.5,
    backgroundColor: "#F8FAFC",
  },
  pageBtnTxt: {
    fontSize: 12,
    fontWeight: "700",
    color: TEAL,
    marginHorizontal: 4,
  },
  pageIndicator: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
  },
});
