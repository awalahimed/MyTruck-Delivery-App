import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Modal,
  TextInput,
  StyleSheet,
  BackHandler,
  Linking,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useNavigation } from "@react-navigation/native";
import * as Location from "expo-location";
import * as ImagePicker from "expo-image-picker";
import { UserAuth } from "../contexts/AuthContext";
import { db, app } from "../firebase";
import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  setDoc,
  doc,
  onSnapshot,
  orderBy,
  limit,
  serverTimestamp,
  runTransaction,
  arrayUnion,
} from "firebase/firestore";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import NotificationBell from "../components/ui/NotificationBell";
import SharedMapView from "../components/SharedMapView";
import { notifyCustomer } from "../services/orderNotifications";
import SmartImage from "../components/ui/SmartImage";

const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";
const BG = "#F5FAF9";

const STATUS_BADGE = {
  PREPARING: { label: "Being Prepared", bg: "#E0E7FF", text: "#3730A3" },
  READY: { label: "Ready for Pickup", bg: "#FEF9C3", text: "#A16207" },
  DRIVERACCEPTED: { label: "Pickup In Progress", bg: "#DCFCE7", text: "#166534" },
  DRIVERPICKEDUP: { label: "Out for Delivery", bg: "#DBEAFE", text: "#1E40AF" },
  COMPLETE: { label: "Delivered", bg: "#D1FAE5", text: "#065F46" },
  PENDING: { label: "Pending", bg: "#FEE2E2", text: "#991B1B" },
};

const TABS = [
  { id: "available", label: "Available Deliveries", icon: "truck-fast-outline" },
  { id: "active", label: "Active Mission", icon: "navigation-variant-outline" },
  { id: "earnings", label: "Earnings & Trips", icon: "cash-multiple" },
  { id: "profile", label: "Driver Profile", icon: "card-account-details-outline" },
];

// Orders drivers can claim: still cooking (claim early, arrive as it's packed) or ready.
const CLAIMABLE_STATUSES = ["PREPARING", "READY"];
// Statuses where this driver owns the order
const DRIVER_ACTIVE_STATUSES = ["PREPARING", "READY", "DRIVERACCEPTED", "DRIVERPICKEDUP"];

const tsMillis = (t) => (t?.toMillis ? t.toMillis() : t?.seconds ? t.seconds * 1000 : 0);

/* ── Proximity dispatch (works without Cloud Functions) ─────────────────
 * Each claimable order opens in widening rings around its pickup point,
 * measured from when dispatch started:
 *   0–45s  → drivers within 3 km     45–90s → within 7 km     90s+ → everyone
 * Drivers who don't share location only see orders once they reach "everyone",
 * so nothing is ever stranded. A driver who released or passed on an order
 * doesn't see it again for 5 minutes.
 */
const DISPATCH_WAVES = [
  { untilSec: 45, maxKm: 3 },
  { untilSec: 90, maxKm: 7 },
];
const REOFFER_AFTER_DECLINE_MS = 5 * 60 * 1000;

const distanceKmBetween = (aLat, aLng, bLat, bLng) => {
  const nums = [aLat, aLng, bLat, bLng].map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [lat1, lng1, lat2, lng2] = nums;
  const toRad = (d) => (d * Math.PI) / 180;
  const h =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};

const dispatchStartMs = (o) =>
  tsMillis(o.dispatchStartedAt) || tsMillis(o.preparingAt) || tsMillis(o.readyAt) || tsMillis(o.updatedAt) || tsMillis(o.createdAt);

/** Max distance (km) at which this order is visible right now; Infinity = everyone. */
const visibleRadiusKm = (o, nowMs) => {
  const ageSec = (nowMs - dispatchStartMs(o)) / 1000;
  const wave = DISPATCH_WAVES.find((w) => ageSec < w.untilSec);
  return wave ? wave.maxKm : Infinity;
};

/** Order is waiting at the merchant for this driver (claimed while cooking, or ready). */
const isAwaitingPickup = (o) => Boolean(o) && ["PREPARING", "READY", "DRIVERACCEPTED"].includes(o.status);

export default function DriverDashboard() {
  const navigation = useNavigation();
  const { user, dbUser, signOutUser } = UserAuth();

  const [activeTab, setActiveTab] = useState("available");
  const [isOnline, setIsOnline] = useState(dbUser?.isOnline === true);
  const [availableOrders, setAvailableOrders] = useState([]);
  const [activeOrder, setActiveOrder] = useState(null);
  const [completedOrders, setCompletedOrders] = useState([]);
  const [earnings, setEarnings] = useState({ count: 0, total: 0 });
  const [earningsRange, setEarningsRange] = useState("Today");
  const [loadingAvailable, setLoadingAvailable] = useState(false);
  const [loadingActive, setLoadingActive] = useState(true);
  const [activeError, setActiveError] = useState("");
  // Real road distance/time for the leg the driver is on now (from Google Directions)
  const [missionRoute, setMissionRoute] = useState(null);
  const [activeRetry, setActiveRetry] = useState(0);
  const [pickingUp, setPickingUp] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [gpsActive, setGpsActive] = useState(false);
  const [rawOpenOrders, setRawOpenOrders] = useState([]);
  const [driverPos, setDriverPos] = useState(
    Number.isFinite(Number(dbUser?.driverLat)) && Number.isFinite(Number(dbUser?.driverLng)) && dbUser?.driverLat
      ? { latitude: Number(dbUser.driverLat), longitude: Number(dbUser.driverLng) }
      : null
  );
  const [nowMs, setNowMs] = useState(Date.now());

  // Modals state
  const [otpModalVisible, setOtpModalVisible] = useState(false);
  const [enteredOtp, setEnteredOtp] = useState("");
  const [otpError, setOtpError] = useState("");
  const [rejectModalVisible, setRejectModalVisible] = useState(false);
  const [rejectReason, setRejectReason] = useState("Vehicle breakdown or mechanical issue");

  // Driver Settlement & Profile Completion State matching user mandate
  const [driverPhone, setDriverPhone] = useState(dbUser?.workingPhone || dbUser?.phoneNumber || dbUser?.phone || "");
  const [driverTelebirr, setDriverTelebirr] = useState(dbUser?.telebirrPhone || "");
  const [driverBank, setDriverBank] = useState(dbUser?.bankName || "Commercial Bank of Ethiopia (CBE)");
  const [driverAccount, setDriverAccount] = useState(dbUser?.accountNumber || "");
  const [driverPhotoUri, setDriverPhotoUri] = useState(dbUser?.image || dbUser?.profileImage || "");
  const [savingDriverProfile, setSavingDriverProfile] = useState(false);

  useEffect(() => {
    if (dbUser?.workingPhone || dbUser?.phoneNumber || dbUser?.phone) {
      setDriverPhone(dbUser.workingPhone || dbUser.phoneNumber || dbUser.phone);
    }
    if (dbUser?.telebirrPhone) setDriverTelebirr(dbUser.telebirrPhone);
    if (dbUser?.bankName) setDriverBank(dbUser.bankName);
    if (dbUser?.accountNumber) setDriverAccount(dbUser.accountNumber);
    if (dbUser?.image || dbUser?.profileImage) setDriverPhotoUri(dbUser.image || dbUser.profileImage);
  }, [dbUser]);

  const isProfileIncomplete = useMemo(() => {
    const hasPhone = Boolean(dbUser?.workingPhone || dbUser?.phoneNumber || dbUser?.phone);
    const hasTelebirr = Boolean(dbUser?.telebirrPhone);
    const hasBank = Boolean(dbUser?.bankName);
    const hasAccount = Boolean(dbUser?.accountNumber);
    const hasPhoto = Boolean(dbUser?.image || dbUser?.profileImage);
    return !hasPhone || !hasTelebirr || !hasBank || !hasAccount || !hasPhoto;
  }, [dbUser]);

  const ALL_ETHIOPIAN_BANKS = [
    "Commercial Bank of Ethiopia (CBE)",
    "Awash Bank",
    "Dashen Bank",
    "Bank of Abyssinia (BOA)",
    "Wegagen Bank",
    "Hibret Bank",
    "Nib International Bank",
    "Cooperative Bank of Oromia (Coopbank)",
    "Lion International Bank",
    "Zemen Bank",
    "Oromia Bank",
    "Berhan Bank",
    "Bunna Bank",
    "Abay Bank",
    "Addis International Bank",
    "Enat Bank",
    "Global Bank Ethiopia",
    "Sinqee Bank",
    "Tsedey Bank",
    "Amhara Bank",
    "Gadaa Bank",
    "Hijra Bank",
    "ZamZam Bank",
    "Rammis Bank",
    "Sidama Bank",
  ];

  const pickDriverPhoto = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Permission Required", "Please allow photo library access to upload your profile picture.");
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.3,
        base64: true,
      });
      if (!res.canceled && res.assets?.[0]) {
        const asset = res.assets[0];
        if (asset.base64 && asset.base64.length > 600000) {
          Alert.alert("Photo Too Large", "Please choose a smaller photo or crop it closer to your face.");
          return;
        }
        if (asset.base64) {
          setDriverPhotoUri(`data:image/jpeg;base64,${asset.base64}`);
        } else if (asset.uri) {
          setDriverPhotoUri(asset.uri);
        }
      }
    } catch (e) {
      Alert.alert("Notice", "Could not pick image.");
    }
  };

  const handleSaveDriverProfile = async () => {
    if (!user?.uid) return;
    if (!driverPhone.trim()) {
      Alert.alert("Required", "Please provide your working phone number.");
      return;
    }
    if (!driverTelebirr.trim()) {
      Alert.alert("Required", "Please provide your Telebirr phone number for instant fare payouts.");
      return;
    }
    if (!driverAccount.trim()) {
      Alert.alert("Required", "Please enter your bank account number.");
      return;
    }
    setSavingDriverProfile(true);
    try {
      // phoneNumber/phone identify the account (login, lookups) — never overwrite them here
      const updates = {
        workingPhone: driverPhone.trim(),
        telebirrPhone: driverTelebirr.trim(),
        bankName: driverBank,
        accountNumber: driverAccount.trim(),
        image: driverPhotoUri || null,
        profileImage: driverPhotoUri || null,
        updatedAt: serverTimestamp(),
      };
      await updateDoc(doc(db, "user", user.uid), updates);
      await setDoc(doc(db, "drivers", user.uid), {
        id: user.uid,
        ...updates,
      }, { merge: true }).catch(() => {});

      Alert.alert("Profile Updated ✓", "Your settlement information and profile picture have been saved successfully!");
    } catch (e) {
      Alert.alert("Save Error", e?.message || "Could not save profile.");
    } finally {
      setSavingDriverProfile(false);
    }
  };

  const pollRef = useRef(null);

  // Intercept hardware back button to prevent accidental app exit
  useEffect(() => {
    const onBackPress = () => {
      if (otpModalVisible) {
        setOtpModalVisible(false);
        return true;
      }
      if (rejectModalVisible) {
        setRejectModalVisible(false);
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
  }, [otpModalVisible, rejectModalVisible, navigation]);

  // Stream live GPS coordinates to Firestore while on active delivery
  useEffect(() => {
    let watcher = null;
    let isSubscribed = true;
    if (activeOrder && activeOrder.id && DRIVER_ACTIVE_STATUSES.includes(activeOrder.status)) {
      (async () => {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === "granted" && isSubscribed) {
            setGpsActive(true);
            watcher = await Location.watchPositionAsync(
              {
                accuracy: Location.Accuracy.High,
                timeInterval: 4000,
                distanceInterval: 6,
              },
              (loc) => {
                if (loc?.coords?.latitude && loc?.coords?.longitude) {
                  setDriverPos({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
                  updateDoc(doc(db, "orders", activeOrder.id), {
                    driverLat: loc.coords.latitude,
                    driverLng: loc.coords.longitude,
                    driverHeading: loc.coords.heading || 0,
                    driverSpeed: loc.coords.speed || 0,
                    driverLocationUpdatedAt: serverTimestamp(),
                  }).catch(() => {});
                }
              }
            );
          }
        } catch (e) {
          console.warn("DriverDashboard GPS stream note:", e?.message);
        }
      })();
    } else {
      setGpsActive(false);
    }
    return () => {
      isSubscribed = false;
      if (watcher?.remove) watcher.remove();
    };
  }, [activeOrder?.id, activeOrder?.status]);

  // Toggle online status
  // Share the driver's position while online so dispatch can offer the nearest orders.
  const reportDriverLocation = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") return;
      const loc =
        (await Location.getLastKnownPositionAsync({ maxAge: 60000 })) ||
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      if (!loc?.coords) return;
      setDriverPos({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      await updateDoc(doc(db, "user", user.uid), {
        driverLat: loc.coords.latitude,
        driverLng: loc.coords.longitude,
        driverLocationUpdatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn("DriverDashboard: location report note:", e?.message);
    }
  }, [user?.uid]);

  const toggleOnline = async (value) => {
    setIsOnline(value);
    try {
      if (value) {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          Alert.alert(
            "Location Needed",
            "Allow location access so MyTruck can send you the deliveries closest to you. You can still accept orders from the open list."
          );
        }
      }
      await updateDoc(doc(db, "user", user.uid), {
        isOnline: value,
        updatedAt: serverTimestamp(),
      });
      if (value) reportDriverLocation();
    } catch (e) {
      Alert.alert("Could not update status", e?.message || "Try again.");
      setIsOnline(!value);
    }
  };

  // A new leg (store -> customer) has its own road distance; drop the old figures
  useEffect(() => {
    setMissionRoute(null);
  }, [activeOrder?.id, activeOrder?.status]);

  // Live list of claimable orders while online
  useEffect(() => {
    if (!isOnline) {
      setRawOpenOrders([]);
      return;
    }
    setLoadingAvailable(true);
    const q = query(collection(db, "orders"), where("status", "in", CLAIMABLE_STATUSES), limit(50));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = [];
        snap.forEach((d) => {
          const data = d.data();
          if (!data.driverId) list.push({ id: d.id, ...data });
        });
        setRawOpenOrders(list);
        setLoadingAvailable(false);
      },
      (e) => {
        console.warn("DriverDashboard: available orders listener note:", e?.message);
        setLoadingAvailable(false);
      }
    );
    return unsub;
  }, [isOnline]);

  // Heartbeat: keep location fresh every 25s while online
  useEffect(() => {
    if (!isOnline) return;
    reportDriverLocation();
    pollRef.current = setInterval(reportDriverLocation, 25000);
    return () => clearInterval(pollRef.current);
  }, [isOnline, reportDriverLocation]);

  // Tick once a second only while some offer is counting down (drives countdown + expiry)
  const hasLiveOffer = rawOpenOrders.some((o) => o.offeredDriverId && tsMillis(o.offerExpiresAt) > nowMs);
  const hasWideningOrder = rawOpenOrders.some(
    (o) =>
      visibleRadiusKm(o, nowMs) !== Infinity ||
      ((o.declinedDriverIds || []).includes(user?.uid) && nowMs - dispatchStartMs(o) < REOFFER_AFTER_DECLINE_MS)
  );
  const tickMs = hasLiveOffer ? 1000 : hasWideningOrder ? 5000 : 0;
  useEffect(() => {
    setNowMs(Date.now());
    if (!tickMs) return;
    const tick = setInterval(() => setNowMs(Date.now()), tickMs);
    return () => clearInterval(tick);
  }, [tickMs, rawOpenOrders]);

  // Matching: exclusive offers (Cloud Function) > proximity rings > open pool.
  useEffect(() => {
    const visible = rawOpenOrders
      .map((o) => ({
        ...o,
        pickupDistanceKm: driverPos
          ? distanceKmBetween(
              driverPos.latitude,
              driverPos.longitude,
              o.restaurantLat ?? o.pickupCoords?.latitude,
              o.restaurantLng ?? o.pickupCoords?.longitude
            )
          : null,
        offerSecondsLeft:
          o.offeredDriverId === user?.uid ? Math.max(0, Math.ceil((tsMillis(o.offerExpiresAt) - nowMs) / 1000)) : 0,
      }))
      .filter((o) => {
        // A live exclusive offer to someone else hides the order
        const offerLive = Boolean(o.offeredDriverId) && tsMillis(o.offerExpiresAt) > nowMs;
        if (offerLive) return o.offeredDriverId === user?.uid;
        // I released / passed on it recently
        if ((o.declinedDriverIds || []).includes(user?.uid) && nowMs - dispatchStartMs(o) < REOFFER_AFTER_DECLINE_MS) return false;
        // Proximity rings
        const radius = visibleRadiusKm(o, nowMs);
        if (radius === Infinity) return true;
        return o.pickupDistanceKm != null && o.pickupDistanceKm <= radius;
      })
      .sort((a, b) => {
        if ((b.offerSecondsLeft > 0) !== (a.offerSecondsLeft > 0)) return b.offerSecondsLeft > 0 ? 1 : -1;
        // Closest pickup first (unknown distance last), then the order that has waited longest
        const da = a.pickupDistanceKm ?? Number.POSITIVE_INFINITY;
        const dbk = b.pickupDistanceKm ?? Number.POSITIVE_INFINITY;
        if (Math.abs(da - dbk) > 0.3) return da - dbk;
        return dispatchStartMs(a) - dispatchStartMs(b);
      });
    setAvailableOrders(visible);
  }, [rawOpenOrders, nowMs, user?.uid, driverPos]);

  // Pull-to-refresh: the list itself is live, so just refresh our location
  const fetchAvailable = useCallback(async () => {
    await reportDriverLocation();
  }, [reportDriverLocation]);

  // Listen for active delivery in real-time
  // (No orderBy: the project has no composite index for driverId+status+updatedAt,
  //  which made this listener fail silently and the Active Mission tab stay empty.
  //  Equality + "in" filters need no composite index; newest is picked here.)
  useEffect(() => {
    if (!user?.uid) return;
    setLoadingActive(true);
    setActiveError("");
    const q = query(
      collection(db, "orders"),
      where("driverId", "==", user.uid),
      where("status", "in", DRIVER_ACTIVE_STATUSES)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const mine = [];
        snap.forEach((d) => mine.push({ id: d.id, ...d.data() }));
        // Most advanced first (on the road beats waiting), then most recently updated
        const rank = { DRIVERPICKEDUP: 3, DRIVERACCEPTED: 2, READY: 2, PREPARING: 1 };
        mine.sort(
          (a, b) =>
            (rank[b.status] || 0) - (rank[a.status] || 0) ||
            tsMillis(b.updatedAt || b.driverAcceptedAt) - tsMillis(a.updatedAt || a.driverAcceptedAt)
        );
        setActiveOrder(mine[0] || null);
        setLoadingActive(false);
      },
      (e) => {
        console.warn("DriverDashboard: active order listener error:", e?.message);
        setActiveError(e?.message || "Could not load your active delivery.");
        setLoadingActive(false);
      }
    );
    return unsub;
  }, [user?.uid, activeRetry]);

  // Earnings summary and completed orders history with authoritative 20% platform cut
  const fetchEarnings = useCallback(async () => {
    if (!user?.uid) return;
    try {
      const [snap, payoutSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, "orders"),
            where("driverId", "==", user.uid),
            where("status", "==", "COMPLETE"),
            limit(500)
          )
        ),
        getDocs(
          query(
            collection(db, "driver_payouts"),
            where("driverId", "==", user.uid)
          )
        ).catch(() => ({ forEach: () => {} })),
      ]);

      let totalEarned = 0;
      let onlineEarned = 0; // MyTruck owes the driver these (customer paid online)
      let cashHeld = 0;     // COD: cash collected minus the driver's own share — owed to MyTruck
      let totalKmAllTime = 0;
      let todayKm = 0;
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const history = [];
      snap.forEach((d) => {
        const data = { id: d.id, ...d.data() };
        // Rider earns deliveryFee minus 20% company cut (80% of delivery fee)
        const dFee = Number(data.deliveryFee || 50);
        const riderNet = Number(data.driverEarnings != null ? data.driverEarnings : (dFee * 0.80));
        const distKm = Number(data.deliveryDistanceKm || data.distanceKm || 0);
        totalEarned += riderNet;
        const isCash = data.paymentMethod !== "CHAPA";
        if (isCash) {
          const collected = Number(data.cashCollectedAmount != null ? data.cashCollectedAmount : data.total || 0);
          cashHeld += Math.max(0, collected - riderNet);
        } else {
          onlineEarned += riderNet;
        }
        totalKmAllTime += distKm;
        // Track today's km
        const ts = data.deliveredAt?.seconds
          ? data.deliveredAt.seconds * 1000
          : data.updatedAt?.seconds ? data.updatedAt.seconds * 1000 : 0;
        if (ts >= todayStart.getTime()) todayKm += distKm;
        history.push({ ...data, riderNet });
      });

      let totalTransferred = 0;
      let cashHandedIn = 0;
      payoutSnap.forEach((p) => {
        const pData = p.data();
        if (pData.status === "TRANSFERRED" || pData.status === "COMPLETED" || pData.status === "PAID") {
          totalTransferred += Number(pData.amount || 0);
        } else if (pData.status === "CASH_RECEIVED") {
          cashHandedIn += Number(pData.amount || 0); // COD cash the driver already gave MyTruck
        }
      });

      // Positive: MyTruck owes the driver. Negative: the driver owes MyTruck (cash still held).
      const netSettlement = onlineEarned - totalTransferred - cashHeld + cashHandedIn;
      cashHeld = Math.max(0, cashHeld - cashHandedIn);

      history.sort((a, b) => {
        const tA = a.deliveredAt?.toMillis ? a.deliveredAt.toMillis() : (a.updatedAt?.seconds ? a.updatedAt.seconds * 1000 : 0);
        const tB = b.deliveredAt?.toMillis ? b.deliveredAt.toMillis() : (b.updatedAt?.seconds ? b.updatedAt.seconds * 1000 : 0);
        return tB - tA;
      });

      setEarnings({
        count: snap.size,
        total: Number(totalEarned.toFixed(2)),
        totalTransferred: Number(totalTransferred.toFixed(2)),
        cashHeld: Number(cashHeld.toFixed(2)),
        netSettlement: Number(netSettlement.toFixed(2)),
        totalKmAllTime: Number(totalKmAllTime.toFixed(1)),
        todayKm: Number(todayKm.toFixed(1)),
      });
      setCompletedOrders(history);
    } catch (e) {
      console.warn("DriverDashboard: earnings fetch note:", e?.message);
    }
  }, [user?.uid]);

  useEffect(() => {
    fetchEarnings();
  }, [fetchEarnings]);

  // Date-range filtered view of completedOrders (client-side)
  const rangeFilteredOrders = useMemo(() => {
    const now = Date.now();
    const getTs = (o) => {
      if (o.deliveredAt?.toMillis) return o.deliveredAt.toMillis();
      if (o.deliveredAt?.seconds) return o.deliveredAt.seconds * 1000;
      if (o.updatedAt?.toMillis) return o.updatedAt.toMillis();
      if (o.updatedAt?.seconds) return o.updatedAt.seconds * 1000;
      if (o.createdAt?.toMillis) return o.createdAt.toMillis();
      if (o.createdAt?.seconds) return o.createdAt.seconds * 1000;
      return 0;
    };
    if (earningsRange === "Today") {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      return completedOrders.filter((o) => getTs(o) >= start.getTime());
    }
    if (earningsRange === "Yesterday") {
      const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
      const startYest = new Date(startToday); startYest.setDate(startYest.getDate() - 1);
      return completedOrders.filter((o) => { const t = getTs(o); return t >= startYest.getTime() && t < startToday.getTime(); });
    }
    if (earningsRange === "Last 7 Days") {
      return completedOrders.filter((o) => getTs(o) >= now - 7 * 86400000);
    }
    if (earningsRange === "Last 30 Days") {
      return completedOrders.filter((o) => getTs(o) >= now - 30 * 86400000);
    }
    return completedOrders; // All Time
  }, [completedOrders, earningsRange]);

  const rangeEarnings = useMemo(() => {
    let total = 0;
    let totalKm = 0;
    rangeFilteredOrders.forEach((o) => {
      const dFee = Number(o.deliveryFee || 50);
      total += Number(o.driverEarnings != null ? o.driverEarnings : o.riderNet != null ? o.riderNet : dFee * 0.80);
      totalKm += Number(o.deliveryDistanceKm || o.distanceKm || 0);
    });
    return {
      count: rangeFilteredOrders.length,
      total: Number(total.toFixed(2)),
      totalKm: Number(totalKm.toFixed(1)),
    };
  }, [rangeFilteredOrders]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchAvailable(), fetchEarnings()]);
    setRefreshing(false);
  }, [fetchAvailable, fetchEarnings]);

  // Accept available delivery. Transaction so two drivers can't claim the same order.
  const acceptOrder = async (orderId) => {
    if (activeOrder) {
      Alert.alert("Finish Current Delivery", "Complete or release your active delivery before accepting another.");
      return;
    }
    try {
      const claimedStatus = await runTransaction(db, async (tx) => {
        const ref = doc(db, "orders", orderId);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("This order is no longer available.");
        const o = snap.data();
        if (o.driverId) throw new Error("Another driver already accepted this order.");
        if (!CLAIMABLE_STATUSES.includes(o.status)) throw new Error("This order is no longer available.");
        if (o.offeredDriverId && o.offeredDriverId !== user.uid && tsMillis(o.offerExpiresAt) > Date.now()) {
          throw new Error("This order is currently offered to a closer driver.");
        }
        // Claimed while cooking: stays PREPARING until the merchant marks it ready
        const nextStatus = o.status === "READY" ? "DRIVERACCEPTED" : o.status;
        tx.update(ref, {
          driverId: user.uid,
          driverName: `${dbUser?.firstName || "Driver"} ${dbUser?.lastName || ""}`.trim(),
          driverPhone: dbUser?.workingPhone || dbUser?.phone || dbUser?.phoneNumber || dbUser?.mobileNumber || "",
          status: nextStatus,
          driverAcceptedAt: serverTimestamp(),
          offeredDriverId: null,
          offerExpiresAt: null,
          updatedAt: serverTimestamp(),
        });
        return nextStatus;
      });
      const claimed = rawOpenOrders.find((o) => o.id === orderId) || { id: orderId };
      notifyCustomer(
        claimed,
        "Driver Assigned 🛵",
        `${dbUser?.firstName || "Your driver"} will deliver your order${claimedStatus === "PREPARING" ? " as soon as it's ready" : ""}.`
      );
      Alert.alert(
        "Order Accepted! 🚗",
        claimedStatus === "PREPARING"
          ? "The merchant is still preparing it. Head to the pickup location — it should be ready when you arrive."
          : "Proceed to the pickup location."
      );
      setActiveTab("active");
    } catch (e) {
      Alert.alert("Could not accept order", e?.message || "Try again.");
    }
  };

  // Pass on an order offered to me so the next-closest driver gets it
  const passOffer = async (orderId) => {
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, "orders", orderId);
        const snap = await tx.get(ref);
        if (!snap.exists() || snap.data().offeredDriverId !== user.uid) return;
        tx.update(ref, {
          offeredDriverId: null,
          offerExpiresAt: null,
          declinedDriverIds: arrayUnion(user.uid),
        });
      });
    } catch (e) {
      Alert.alert("Error", e?.message || "Could not pass on this order.");
    }
  };

  // Pickup: only the assigned driver, only once the merchant has marked it ready
  const updateOrderStatus = async (orderId, newStatus) => {
    if (newStatus !== "DRIVERPICKEDUP" || pickingUp) return;
    setPickingUp(true);
    try {
      const picked = await runTransaction(db, async (tx) => {
        const ref = doc(db, "orders", orderId);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("Order not found.");
        const o = snap.data();
        if (o.driverId !== user.uid) throw new Error("This order is no longer assigned to you.");
        if (o.status === "PREPARING") throw new Error("The merchant hasn't marked this order ready yet.");
        if (!["READY", "DRIVERACCEPTED"].includes(o.status)) throw new Error("This order can't be picked up right now.");
        tx.update(ref, {
          status: "DRIVERPICKEDUP",
          pickedUpAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        return { id: snap.id, ...o };
      });
      notifyCustomer(picked, "On the Way 🛵", "Your driver picked up your order and is heading to you. Have your delivery PIN ready.");
      Alert.alert(
        "Pickup Confirmed ✓",
        picked.paymentStatus === "PAID"
          ? "Head to the customer. This order is already paid online."
          : `Head to the customer and collect ETB ${Number(picked.total || 0).toFixed(2)} in cash.`
      );
    } catch (e) {
      Alert.alert("Update Error", e?.message || "Could not update delivery status.");
    } finally {
      setPickingUp(false);
    }
  };

  const handleCompletePress = () => {
    setEnteredOtp("");
    setOtpError("");
    setOtpModalVisible(true);
  };

  const handleVerifyOtpAndComplete = async () => {
    const clean = enteredOtp.trim();
    if (!/^\d{4}$/.test(clean)) {
      setOtpError("Please enter the 4-digit PIN provided by customer.");
      return;
    }
    if (!activeOrder?.id || completing) return;
    setCompleting(true);

    try {
      // PIN is checked against the live order inside the transaction; there is no bypass code.
      const done = await runTransaction(db, async (tx) => {
        const ref = doc(db, "orders", activeOrder.id);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("Order not found.");
        const o = snap.data();
        if (o.driverId !== user.uid) throw new Error("This order is no longer assigned to you.");
        if (o.status !== "DRIVERPICKEDUP") throw new Error("Confirm pickup before completing the delivery.");
        const expected = String(o.deliveryOtp || "").trim();
        if (!expected) throw new Error("This order has no delivery PIN. Contact MyTruck support to complete it.");
        if (clean !== expected) {
          const err = new Error("Incorrect PIN. Please ask the customer to confirm their 4-digit code.");
          err.code = "BAD_PIN";
          throw err;
        }
        const isCash = o.paymentMethod !== "CHAPA" && o.paymentStatus !== "PAID";
        tx.update(ref, {
          status: "COMPLETE",
          deliveredAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          // Cash on Delivery: the driver collected the full order total at handover
          ...(isCash
            ? { paymentStatus: "PAID", cashCollected: true, cashCollectedAmount: Number(o.total || 0), paidAt: serverTimestamp() }
            : {}),
        });
        return { id: snap.id, ...o, isCash };
      });

      setOtpModalVisible(false);
      notifyCustomer(done, "Delivered 🎉", "Your order was delivered. Enjoy, and thanks for using MyTruck!");
      Alert.alert(
        "Delivery Finalized! 🎉",
        done.isCash
          ? `Handover verified. Cash collected: ETB ${Number(done.total || 0).toFixed(2)}.`
          : "Handover verified. Earnings credited."
      );
      setActiveTab("earnings");
      fetchEarnings();
    } catch (e) {
      if (e?.code === "BAD_PIN") {
        setOtpError(e.message);
        return;
      }
      setOtpModalVisible(false);
      Alert.alert("Delivery Completion Error", e?.message || "Could not complete delivery.");
    } finally {
      setCompleting(false);
    }
  };

  const handleRejectAssignment = async () => {
    if (!activeOrder?.id) return;
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, "orders", activeOrder.id);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("Order not found.");
        const o = snap.data();
        if (o.driverId !== user.uid) throw new Error("This order is no longer assigned to you.");
        if (o.status === "DRIVERPICKEDUP") {
          throw new Error("You already picked this order up. Please deliver it or contact MyTruck support.");
        }
        tx.update(ref, {
          // Back to the merchant's current stage so the order re-enters dispatch
          status: o.status === "PREPARING" ? "PREPARING" : "READY",
          driverId: null,
          driverName: null,
          driverPhone: null,
          driverLat: null,
          driverLng: null,
          driverAcceptedAt: null,
          declinedDriverIds: arrayUnion(user.uid),
          dispatchStartedAt: serverTimestamp(),
          driverRejectedAt: serverTimestamp(),
          driverRejectReason: rejectReason,
          updatedAt: serverTimestamp(),
        });
      });
      setRejectModalVisible(false);
      notifyCustomer(activeOrder, "Finding a New Driver", "Your previous driver couldn't make it. We're assigning another driver now.");
      Alert.alert("Assignment Released", "The order has been returned to the available dispatch queue.");
      setActiveTab("available");
    } catch (e) {
      setRejectModalVisible(false);
      Alert.alert("Error", e?.message || "Could not release order.");
    }
  };

  // Turn-by-turn directions in Google Maps (app if installed, otherwise browser)
  const openDirections = (lat, lng, label) => {
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln) || la === 0) {
      Alert.alert("Location Unavailable", `${label || "This place"} has no map location. Use the address or call instead.`);
      return;
    }
    const url = `https://www.google.com/maps/dir/?api=1&destination=${la},${ln}&travelmode=driving`;
    Linking.openURL(url).catch(() => Alert.alert("Maps Unavailable", "Could not open maps on this phone."));
  };

  const makeCall = (phone) => {
    if (!phone) {
      Alert.alert("Contact Unavailable", "Phone number is not available.");
      return;
    }
    Linking.openURL(`tel:${phone}`).catch(() => {
      Alert.alert("Call Unavailable", `Could not initiate call to ${phone}`);
    });
  };

  const sendSms = (phone) => {
    if (!phone) {
      Alert.alert("Contact Unavailable", "Phone number is not available.");
      return;
    }
    Linking.openURL(`sms:${phone}`).catch(() => {
      Alert.alert("SMS Unavailable", `Could not open SMS for ${phone}`);
    });
  };

  const driverFullName = `${dbUser?.firstName || "Driver"} ${dbUser?.lastName || ""}`.trim();

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

          {/* Title & Logistics Terminal Info */}
          <View style={s.headerTitleWrap}>
            <Text style={s.headerTitle} numberOfLines={1}>
              {driverFullName}
            </Text>
            <View style={s.headerSubtitleRow}>
              <View style={[s.dutyPill, isOnline ? s.dutyOnline : s.dutyOffline]}>
                <Text style={[s.dutyTxt, isOnline ? s.dutyTxtOnline : s.dutyTxtOffline]}>
                  {isOnline ? "ON DUTY" : "OFFLINE"}
                </Text>
              </View>
              <Text style={s.headerSubtitle}>Carrier Logistics Terminal</Text>
            </View>
          </View>

          {/* Top Right Actions: Notification + Online Switch */}
          <View style={s.headerRightActions}>
            <NotificationBell
              style={s.notificationCircle}
              iconColor="#FFFFFF"
              badgeColor={ORANGE}
            />
            <View style={s.onlineSwitchWrap}>
              <Switch
                value={isOnline}
                onValueChange={toggleOnline}
                trackColor={{ false: "#64748B", true: "#22C55E" }}
                thumbColor="#FFFFFF"
              />
            </View>
          </View>
        </View>
      </View>

      {/* Horizontal Segmented Tabs Bar */}
      <View style={s.tabsBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabsScroll}>
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            let badgeCount = null;
            if (tab.id === "available" && isOnline) badgeCount = availableOrders.length;
            if (tab.id === "active" && activeOrder) badgeCount = "1";

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
        {/* Live GPS Broadcast Indicator when active */}
        {Boolean(gpsActive && activeOrder) && (
          <View style={s.gpsBanner}>
            <MaterialCommunityIcons name="crosshairs-gps" size={20} color="#166534" />
            <Text style={s.gpsBannerTxt}>Live GPS Broadcasting Active (Customer & Dispatch)</Text>
          </View>
        )}

        {/* Profile Incomplete Warning Banner matching User Mandate */}
        {isProfileIncomplete && (
          <View style={{ backgroundColor: "#FEF3C7", borderWidth: 1.5, borderColor: "#FCD34D", borderRadius: 14, padding: 14, marginBottom: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
              <MaterialCommunityIcons name="alert" size={20} color="#B45309" style={{ marginRight: 6 }} />
              <Text style={{ fontSize: 13, fontWeight: "900", color: "#B45309" }}>Action Required: Complete Settlement Profile</Text>
            </View>
            <Text style={{ fontSize: 12, color: "#78350F", lineHeight: 17 }}>
              To receive active delivery dispatches and instant daily payouts, please provide your working phone number, Telebirr phone number, preferred Ethiopian bank and account number, and driver profile photo.
            </Text>
            <TouchableOpacity
              style={{ backgroundColor: "#B45309", paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, alignSelf: "flex-start", marginTop: 10, flexDirection: "row", alignItems: "center" }}
              onPress={() => setActiveTab("profile")}
            >
              <MaterialCommunityIcons name="pencil" size={14} color="white" style={{ marginRight: 5 }} />
              <Text style={{ fontSize: 12, fontWeight: "800", color: "white" }}>Complete Profile Details ›</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Executive KPI Stats Cards Row */}
        <View style={s.kpiRow}>
          <View style={s.kpiCard}>
            <View style={[s.kpiIconBox, { backgroundColor: "#E6F7F1" }]}>
              <MaterialCommunityIcons name="check-circle-outline" size={20} color={TEAL} />
            </View>
            <Text style={s.kpiValue}>{earnings.count}</Text>
            <Text style={s.kpiLabel}>Trips Done</Text>
          </View>

          <View style={s.kpiCard}>
            <View style={[s.kpiIconBox, { backgroundColor: "#F0FDF9" }]}>
              <MaterialCommunityIcons name="map-marker-distance" size={20} color={TEAL} />
            </View>
            <Text style={s.kpiValue}>{(earnings.todayKm || 0).toFixed(1)}</Text>
            <Text style={s.kpiLabel}>km Today</Text>
          </View>

          <View style={s.kpiCard}>
            <View style={[s.kpiIconBox, { backgroundColor: "#FFEDD5" }]}>
              <MaterialCommunityIcons name="truck-fast-outline" size={20} color={ORANGE} />
            </View>
            <Text style={s.kpiValue}>{isOnline ? availableOrders.length : 0}</Text>
            <Text style={s.kpiLabel}>Queue Ready</Text>
          </View>

          <View style={s.kpiCard}>
            <View style={[s.kpiIconBox, { backgroundColor: "#EFF6FF" }]}>
              <MaterialCommunityIcons name="star-outline" size={20} color="#2563EB" />
            </View>
            <Text style={s.kpiValue}>4.9 ★</Text>
            <Text style={s.kpiLabel}>Rating</Text>
          </View>
        </View>

        {/* TAB 1: AVAILABLE DELIVERIES QUEUE */}
        {activeTab === "available" && (
          <View>
            {!isOnline ? (
              <View style={s.offlineBannerCard}>
                <MaterialCommunityIcons name="power-standby" size={48} color="#94A3B8" />
                <Text style={s.offlineTitle}>You are currently Offline</Text>
                <Text style={s.offlineSub}>
                  Switch your duty status to Online above to receive real-time delivery requests in your zone.
                </Text>
                <TouchableOpacity
                  onPress={() => toggleOnline(true)}
                  style={s.goOnlineBtn}
                  activeOpacity={0.8}
                >
                  <MaterialCommunityIcons name="flash" size={18} color="#FFFFFF" />
                  <Text style={s.goOnlineBtnTxt}>Go Online Now</Text>
                </TouchableOpacity>
              </View>
            ) : loadingAvailable ? (
              <View style={s.emptyCenter}>
                <ActivityIndicator size="large" color={TEAL} />
                <Text style={s.emptySub}>Scanning dispatch network for ready packages…</Text>
              </View>
            ) : availableOrders.length === 0 ? (
              <View style={s.emptyCard}>
                <MaterialCommunityIcons name="inbox-outline" size={54} color="#CBD5E1" />
                <Text style={s.emptyTitle}>No Orders Nearby Yet</Text>
                <Text style={s.emptySub}>
                  {driverPos
                    ? "You're online. New orders reach the closest drivers first, then widen — keep the app open to see them."
                    : "You're online, but location is off — you'll only see orders after nearby drivers had first chance. Turn on location to get priority."}
                </Text>
              </View>
            ) : (
              availableOrders.map((order) => {
                const orderRef = order.id ? `#MT-${order.id.slice(-6).toUpperCase()}` : "#MT-ORDER";
                const dFee = Number(order.deliveryFee || 60);
                const riderNet = Number(order.driverEarnings != null ? order.driverEarnings : (dFee * 0.80)).toFixed(0);
                const pickupLoc = order.pickupAddress || order.restaurantAddress || "Restaurant Store Location";
                const dropLoc = order.dropoffAddress || order.deliveryAddress || order.userAddress || "Customer Delivery Address";
                const distKm = order.deliveryDistanceKm || 3.2;
                const etaMins = order.deliveryEtaMinutes || 20;

                const isMyOffer = order.offerSecondsLeft > 0;
                const stage = STATUS_BADGE[order.status] || STATUS_BADGE.READY;

                return (
                  <View key={order.id} style={[s.deliveryCard, isMyOffer && { borderWidth: 2, borderColor: ORANGE }]}>
                    {isMyOffer && (
                      <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#FFF7ED", borderRadius: 10, padding: 8, marginBottom: 10 }}>
                        <MaterialCommunityIcons name="map-marker-radius" size={18} color={ORANGE} />
                        <Text style={{ flex: 1, marginLeft: 8, fontSize: 12, fontWeight: "700", color: "#9A3412" }}>
                          {"Offered to you — you're the closest driver"}
                          {order.offeredDriverDistanceKm != null ? ` (${Number(order.offeredDriverDistanceKm).toFixed(1)} km)` : ""}
                        </Text>
                        <Text style={{ fontSize: 13, fontWeight: "800", color: ORANGE }}>{`${order.offerSecondsLeft}s`}</Text>
                      </View>
                    )}
                    <View style={{ alignSelf: "flex-start", backgroundColor: stage.bg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginBottom: 8 }}>
                      <Text style={{ fontSize: 10.5, fontWeight: "800", color: stage.text }}>
                        {order.status === "PREPARING" ? "BEING PREPARED · CLAIM EARLY" : "READY FOR PICKUP"}
                      </Text>
                    </View>
                    {/* Delivery Card Top Header */}
                    <View style={s.deliveryCardHeader}>
                      <View style={{ flexDirection: "row", alignItems: "center" }}>
                        <SmartImage
                          uri={order.restaurantImage}
                          fallbackType="restaurant"
                          style={s.merchantThumb}
                        />
                        <View style={{ marginLeft: 10 }}>
                          <Text style={s.merchantName} numberOfLines={1}>
                            {order.restaurantName || "Partner Restaurant"}
                          </Text>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <Text style={s.deliveryRefText}>{orderRef}</Text>
                            {order.isIntercity && (
                              <View style={{ backgroundColor: "#EFF6FF", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 }}>
                                <Text style={{ fontSize: 9.5, fontWeight: "800", color: "#2563EB" }}>🛣️ INTERCITY</Text>
                              </View>
                            )}
                          </View>
                        </View>
                      </View>
                      <View style={s.fareBadge}>
                        <Text style={s.fareLabel}>Your Net</Text>
                        <Text style={s.fareValue}>ETB {riderNet}</Text>
                      </View>
                    </View>

                    {/* Route Details Box */}
                    <View style={s.routeBox}>
                      <View style={s.routeRow}>
                        <View style={[s.routeDot, { backgroundColor: TEAL }]} />
                        <View style={{ flex: 1, marginLeft: 10 }}>
                          <Text style={s.routeLabel}>PICKUP FROM</Text>
                          <Text style={s.routeAddress} numberOfLines={1}>
                            {pickupLoc}
                          </Text>
                        </View>
                      </View>

                      <View style={s.routeDottedLine} />

                      <View style={s.routeRow}>
                        <View style={[s.routeDot, { backgroundColor: ORANGE }]} />
                        <View style={{ flex: 1, marginLeft: 10 }}>
                          <Text style={s.routeLabel}>DELIVER TO</Text>
                          <Text style={s.routeAddress} numberOfLines={1}>
                            {dropLoc}
                          </Text>
                        </View>
                      </View>

                      {/* Distance & Duration Strip */}
                      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: "#F1F5F9" }}>
                        <Text style={{ fontSize: 11, color: "#64748B", fontWeight: "600" }}>
                          📍 Pickup: <Text style={{ color: DARK, fontWeight: "700" }}>{order.pickupDistanceKm != null ? `${order.pickupDistanceKm.toFixed(1)} km away` : "—"}</Text>
                          {"  ·  "}Trip: <Text style={{ color: DARK, fontWeight: "700" }}>{`${distKm} km`}</Text>
                        </Text>
                        <Text style={{ fontSize: 11, color: "#64748B", fontWeight: "600" }}>
                          ⏱️ Est. Time: <Text style={{ color: DARK, fontWeight: "700" }}>{etaMins} mins</Text>
                        </Text>
                      </View>
                    </View>

                    {/* Action Buttons */}
                    <TouchableOpacity
                      onPress={() => acceptOrder(order.id)}
                      style={s.acceptBtn}
                      activeOpacity={0.8}
                    >
                      <MaterialCommunityIcons name="check" size={18} color="#FFFFFF" />
                      <Text style={s.acceptBtnTxt}>Accept Delivery</Text>
                    </TouchableOpacity>
                    {isMyOffer && (
                      <TouchableOpacity onPress={() => passOffer(order.id)} style={{ alignItems: "center", paddingVertical: 10 }} activeOpacity={0.7}>
                        <Text style={{ fontSize: 12.5, fontWeight: "700", color: "#64748B" }}>Pass — offer to the next driver</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })
            )}
          </View>
        )}

        {/* TAB 2: ACTIVE MISSION */}
        {activeTab === "active" && (
          <View>
            {loadingActive ? (
              <View style={s.emptyCenter}>
                <ActivityIndicator size="large" color={TEAL} />
                <Text style={s.emptySub}>Retrieving active mission details…</Text>
              </View>
            ) : activeError ? (
              <View style={s.emptyCard}>
                <MaterialCommunityIcons name="wifi-alert" size={54} color="#F59E0B" />
                <Text style={s.emptyTitle}>Couldn't Load Your Delivery</Text>
                <Text style={s.emptySub}>Check your connection and try again.</Text>
                <TouchableOpacity onPress={() => setActiveRetry((n) => n + 1)} style={s.emptyActionBtn}>
                  <Text style={s.emptyActionBtnTxt}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : !activeOrder ? (
              <View style={s.emptyCard}>
                <MaterialCommunityIcons name="truck-check-outline" size={54} color="#CBD5E1" />
                <Text style={s.emptyTitle}>No Active Delivery Right Now</Text>
                <Text style={s.emptySub}>
                  Accept an order from the 'Available Deliveries' tab to initiate live navigation and pickup.
                </Text>
                <TouchableOpacity
                  onPress={() => setActiveTab("available")}
                  style={s.emptyActionBtn}
                >
                  <Text style={s.emptyActionBtnTxt}>Browse Available Orders</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={s.activeMissionCard}>
                {/* Mission Header */}
                <View style={s.missionHeaderRow}>
                  <View>
                    <Text style={s.missionRefText}>
                      MISSION #{activeOrder.id ? activeOrder.id.slice(-6).toUpperCase() : "ACTIVE"}
                    </Text>
                    <Text style={s.missionStatusText}>
                      {activeOrder.status === "PREPARING"
                        ? "Phase 1: Head to Pickup — Food Being Prepared"
                        : isAwaitingPickup(activeOrder)
                          ? "Phase 1: Proceed to Pickup"
                          : "Phase 2: Out for Customer Delivery"}
                    </Text>
                  </View>
                  <View
                    style={[
                      s.statusPill,
                      { backgroundColor: STATUS_BADGE[activeOrder.status]?.bg || "#E0E7FF" },
                    ]}
                  >
                    <Text
                      style={[
                        s.statusTxt,
                        { color: STATUS_BADGE[activeOrder.status]?.text || "#3730A3" },
                      ]}
                    >
                      {STATUS_BADGE[activeOrder.status]?.label || activeOrder.status}
                    </Text>
                  </View>
                </View>

                {/* Live mission map: your position, the store and the customer, with the real road route */}
                {(() => {
                  const pickup = {
                    latitude: Number(activeOrder.restaurantLat ?? activeOrder.pickupCoords?.latitude),
                    longitude: Number(activeOrder.restaurantLng ?? activeOrder.pickupCoords?.longitude),
                    title: activeOrder.restaurantName || "Store",
                  };
                  const dropoff = {
                    latitude: Number(activeOrder.deliveryLat ?? activeOrder.deliveryCoords?.latitude),
                    longitude: Number(activeOrder.deliveryLng ?? activeOrder.deliveryCoords?.longitude),
                    title: "Customer",
                  };
                  const toStore = isAwaitingPickup(activeOrder);
                  return (
                    <View style={{ height: 260, marginHorizontal: 16, marginBottom: 12, borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: "#E2E8F0" }}>
                      <SharedMapView
                        mode="route"
                        origin={pickup}
                        destination={dropoff}
                        routeFrom={driverPos || null}
                        routeTo={toStore ? pickup : dropoff}
                        driverLocation={driverPos ? { ...driverPos, title: "You" } : null}
                        onRouteInfo={setMissionRoute}
                        showControls={false}
                      />
                    </View>
                  );
                })()}

                {/* Pickup Details Section */}
                <View style={s.missionSection}>
                  <View style={s.sectionHeader}>
                    <MaterialCommunityIcons name="storefront" size={18} color={TEAL} />
                    <Text style={s.sectionTitle}>Merchant Pickup Point</Text>
                  </View>
                  <Text style={s.sectionName}>{activeOrder.restaurantName || "Partner Store"}</Text>
                  <Text style={s.sectionAddress}>{activeOrder.pickupAddress || activeOrder.restaurantAddress || "Addis Ababa"}</Text>

                  <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                    {isAwaitingPickup(activeOrder) && (
                      <TouchableOpacity
                        onPress={() =>
                          openDirections(
                            activeOrder.restaurantLat ?? activeOrder.pickupCoords?.latitude,
                            activeOrder.restaurantLng ?? activeOrder.pickupCoords?.longitude,
                            activeOrder.restaurantName
                          )
                        }
                        style={[s.sectionCallBtn, { flex: 1, backgroundColor: "#E6F7F1", borderColor: TEAL }]}
                        activeOpacity={0.8}
                      >
                        <MaterialCommunityIcons name="navigation-variant" size={16} color={TEAL} />
                        <Text style={[s.sectionCallBtnTxt, { color: TEAL, fontWeight: "800" }]}>Navigate to Store</Text>
                      </TouchableOpacity>
                    )}
                    {Boolean(activeOrder.restaurantPhone) && (
                      <TouchableOpacity
                        onPress={() => makeCall(activeOrder.restaurantPhone)}
                        style={[s.sectionCallBtn, { flex: 1 }]}
                        activeOpacity={0.8}
                      >
                        <MaterialCommunityIcons name="phone" size={14} color={TEAL} />
                        <Text style={s.sectionCallBtnTxt}>Call Store</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {activeOrder.pickupLocationVerified === false && (
                    <Text style={{ fontSize: 11, color: "#B45309", marginTop: 6 }}>
                      This store hasn't pinned its exact location yet — confirm the address by phone.
                    </Text>
                  )}
                </View>

                {/* Drop-off Details Section with Prominent Customer Contact */}
                {(() => {
                  const custName = activeOrder.customerName || `${activeOrder.userFirstName || ""} ${activeOrder.userLastName || ""}`.trim() || "Customer";
                  const custPhone = activeOrder.customerPhone || activeOrder.userPhoneNumber || activeOrder.phone || "";
                  const dropAddress = activeOrder.dropoffAddress || activeOrder.deliveryAddress || activeOrder.userAddress || "Standard delivery address";
                  // Road figures for the current leg when the map has them; otherwise the stored estimate
                  const tripDistance = missionRoute ? missionRoute.distanceKm : activeOrder.deliveryDistanceKm != null ? activeOrder.deliveryDistanceKm : "—";
                  const tripEta = missionRoute ? missionRoute.etaMinutes : activeOrder.deliveryEtaMinutes != null ? activeOrder.deliveryEtaMinutes : "—";
                  const legLabel = isAwaitingPickup(activeOrder) ? "to store" : "to customer";
                  const deliveryFeeVal = Number(activeOrder.deliveryFee || 60);
                  const commVal = Number(activeOrder.deliveryCommission != null ? activeOrder.deliveryCommission : (deliveryFeeVal * 0.20));
                  const riderEarningsVal = Number(activeOrder.driverEarnings != null ? activeOrder.driverEarnings : (deliveryFeeVal - commVal));

                  return (
                    <>
                      <View style={s.missionSection}>
                        <View style={s.sectionHeader}>
                          <MaterialCommunityIcons name="map-marker-account" size={18} color={ORANGE} />
                          <Text style={s.sectionTitle}>Customer Drop-off Point & Contact</Text>
                        </View>
                        <Text style={s.sectionName}>{custName}</Text>
                        <Text style={s.sectionAddress}>{dropAddress}</Text>

                        {/* Customer Phone Highlight */}
                        <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#F8FAFC", padding: 10, borderRadius: 10, marginVertical: 8, borderWidth: 1, borderColor: "#E2E8F0" }}>
                          <MaterialCommunityIcons name="phone-classic" size={18} color={TEAL} style={{ marginRight: 8 }} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 11, color: "#64748B", fontWeight: "600" }}>Customer Phone Number</Text>
                            <Text style={{ fontSize: 14, fontWeight: "800", color: DARK }}>
                              {custPhone || "Phone not provided"}
                            </Text>
                          </View>
                        </View>

                        {activeOrder.status === "DRIVERPICKEDUP" && (
                          <TouchableOpacity
                            onPress={() =>
                              openDirections(
                                activeOrder.deliveryLat ?? activeOrder.deliveryCoords?.latitude,
                                activeOrder.deliveryLng ?? activeOrder.deliveryCoords?.longitude,
                                "The customer"
                              )
                            }
                            style={[s.sectionCallBtn, { backgroundColor: "#E6F7F1", borderColor: TEAL, marginBottom: 6 }]}
                            activeOpacity={0.8}
                          >
                            <MaterialCommunityIcons name="navigation-variant" size={16} color={TEAL} />
                            <Text style={[s.sectionCallBtnTxt, { color: TEAL, fontWeight: "800" }]}>Navigate to Customer</Text>
                          </TouchableOpacity>
                        )}

                        {/* Customer Contact Actions: Call & SMS */}
                        {Boolean(custPhone) && (
                          <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                            <TouchableOpacity
                              onPress={() => makeCall(custPhone)}
                              style={[s.sectionCallBtn, { flex: 1, backgroundColor: "#E6F7F1", borderColor: TEAL }]}
                              activeOpacity={0.8}
                            >
                              <MaterialCommunityIcons name="phone" size={16} color={TEAL} />
                              <Text style={[s.sectionCallBtnTxt, { color: TEAL, fontWeight: "800" }]}>Call Customer</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              onPress={() => sendSms(custPhone)}
                              style={[s.sectionCallBtn, { flex: 1, backgroundColor: "#FFF7ED", borderColor: ORANGE }]}
                              activeOpacity={0.8}
                            >
                              <MaterialCommunityIcons name="message-text-outline" size={16} color={ORANGE} />
                              <Text style={[s.sectionCallBtnTxt, { color: ORANGE, fontWeight: "800" }]}>SMS Customer</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>

                      {/* Order Distance & Logistics Details */}
                      <View style={{ backgroundColor: "#FFFFFF", borderRadius: 14, padding: 12, marginHorizontal: 16, marginBottom: 12, borderWidth: 1, borderColor: "#E2E8F0" }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <Text style={{ fontSize: 12, fontWeight: "700", color: "#475569" }}>Route & Logistics</Text>
                          {activeOrder.isIntercity && (
                            <View style={{ backgroundColor: "#EFF6FF", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
                              <Text style={{ fontSize: 10, fontWeight: "800", color: "#2563EB" }}>🛣️ INTERCITY DISPATCH</Text>
                            </View>
                          )}
                        </View>
                        <View style={{ flexDirection: "row", justifyContent: "space-around", paddingTop: 4 }}>
                          <View style={{ alignItems: "center" }}>
                            <Text style={{ fontSize: 14, fontWeight: "800", color: TEAL }}>{tripDistance} km</Text>
                            <Text style={{ fontSize: 11, color: "#64748B" }}>{`Distance ${legLabel}${missionRoute ? " (by road)" : ""}`}</Text>
                          </View>
                          <View style={{ width: 1, backgroundColor: "#E2E8F0" }} />
                          <View style={{ alignItems: "center" }}>
                            <Text style={{ fontSize: 14, fontWeight: "800", color: ORANGE }}>{tripEta} mins</Text>
                            <Text style={{ fontSize: 11, color: "#64748B" }}>{missionRoute ? "Travel time (by road)" : "Est. duration"}</Text>
                          </View>
                        </View>
                      </View>

                      {/* Mission Financial Breakdown (Authoritative 20% cut) */}
                      <View style={s.missionFinancialRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.missionFinLabel}>Your Net Delivery Earnings (80%)</Text>
                          <Text style={[s.missionFinAmt, { color: "#166534" }]}>
                            ETB {riderEarningsVal.toFixed(2)}
                          </Text>
                          <Text style={{ fontSize: 10.5, color: "#64748B", marginTop: 2 }}>
                            Delivery Fare: ETB {deliveryFeeVal.toFixed(2)} · Platform Cut (20%): -ETB {commVal.toFixed(2)}
                          </Text>
                        </View>
                        <View style={s.paymentStatusBadge}>
                          <Text style={s.paymentStatusBadgeTxt}>
                            {activeOrder.paymentStatus === "PAID"
                              ? "PAID ONLINE"
                              : `COD: Collect ETB ${Number(activeOrder.total || 0).toFixed(2)}`}
                          </Text>
                        </View>
                      </View>
                    </>
                  );
                })()}

                {/* Mission Actions */}
                <View style={s.missionActionsWrap}>
                  {isAwaitingPickup(activeOrder) && (
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <TouchableOpacity
                        onPress={() => updateOrderStatus(activeOrder.id, "DRIVERPICKEDUP")}
                        disabled={activeOrder.status === "PREPARING" || pickingUp}
                        style={[
                          s.primaryActionBtn,
                          { backgroundColor: activeOrder.status === "PREPARING" ? "#94A3B8" : ORANGE },
                          pickingUp && { opacity: 0.7 },
                        ]}
                        activeOpacity={0.8}
                      >
                        {pickingUp ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
                        <MaterialCommunityIcons
                          name={activeOrder.status === "PREPARING" ? "chef-hat" : "package-variant-closed"}
                          size={18}
                          color="#FFFFFF"
                        />
                        <Text style={s.primaryActionBtnTxt}>
                          {activeOrder.status === "PREPARING"
                            ? "Waiting for Merchant to Mark Ready"
                            : "Confirm Pickup from Merchant"}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => setRejectModalVisible(true)}
                        style={s.releaseBtn}
                        activeOpacity={0.8}
                      >
                        <MaterialCommunityIcons name="close-circle-outline" size={18} color="#DC2626" />
                      </TouchableOpacity>
                    </View>
                  )}

                  {activeOrder.status === "DRIVERPICKEDUP" && (
                    <TouchableOpacity
                      onPress={handleCompletePress}
                      style={[s.primaryActionBtn, { backgroundColor: TEAL }]}
                      activeOpacity={0.8}
                    >
                      <MaterialCommunityIcons name="shield-key" size={20} color="#FFFFFF" />
                      <Text style={s.primaryActionBtnTxt}>Complete Delivery (Verify Customer PIN)</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}
          </View>
        )}

        {/* TAB 3: EARNINGS & COMPLETED TRIPS */}
        {activeTab === "earnings" && (
          <View>
            {/* Date Range Filter Pills */}
            <View style={{ flexDirection: "row", paddingHorizontal: 16, paddingVertical: 10, gap: 8, flexWrap: "wrap" }}>
              {["Today", "Yesterday", "Last 7 Days", "Last 30 Days", "All Time"].map((r) => (
                <TouchableOpacity
                  key={r}
                  onPress={() => setEarningsRange(r)}
                  style={{
                    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
                    backgroundColor: earningsRange === r ? TEAL : "#E8F5F2",
                    borderWidth: 1, borderColor: earningsRange === r ? TEAL : "#C7E8E0",
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: "700", color: earningsRange === r ? "#FFF" : TEAL }}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.earningsHeroCard}>
              <Text style={s.earningsHeroSub}>{earningsRange} Earnings (After 20% Cut)</Text>
              <Text style={s.earningsHeroAmt}>ETB {rangeEarnings.total.toFixed(2)}</Text>
              <Text style={{ fontSize: 11, color: "#E6F7F1", marginTop: 2, marginBottom: 12, textAlign: "center" }}>
                80% Net of Delivery Fares · 20% Company Commission Deducted
              </Text>

              {/* Daily KM + Earnings summary stats */}
              <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
                <View style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 12, padding: 12, alignItems: "center" }}>
                  <MaterialCommunityIcons name="map-marker-distance" size={22} color="#A7F3D0" />
                  <Text style={{ fontSize: 20, fontWeight: "900", color: "#FFFFFF", marginTop: 4 }}>
                    {rangeEarnings.totalKm.toFixed(1)}
                  </Text>
                  <Text style={{ fontSize: 10.5, color: "#CCFBF1", fontWeight: "600", marginTop: 1 }}>km Traveled</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 12, padding: 12, alignItems: "center" }}>
                  <MaterialCommunityIcons name="cash-multiple" size={22} color="#FEF08A" />
                  <Text style={{ fontSize: 20, fontWeight: "900", color: "#FFFFFF", marginTop: 4 }}>
                    {rangeEarnings.total.toFixed(0)}
                  </Text>
                  <Text style={{ fontSize: 10.5, color: "#FEF3C7", fontWeight: "600", marginTop: 1 }}>ETB Earned</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 12, padding: 12, alignItems: "center" }}>
                  <MaterialCommunityIcons name="truck-check-outline" size={22} color="#BAE6FD" />
                  <Text style={{ fontSize: 20, fontWeight: "900", color: "#FFFFFF", marginTop: 4 }}>
                    {rangeEarnings.count}
                  </Text>
                  <Text style={{ fontSize: 10.5, color: "#BAE6FD", fontWeight: "600", marginTop: 1 }}>Deliveries</Text>
                </View>
              </View>

              {/* Settlement Balances Grid */}
              <View style={{ flexDirection: "row", backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 12, padding: 10, marginBottom: 12 }}>
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text style={{ fontSize: 11, color: "#CCFBF1", fontWeight: "600" }}>Transferred to You</Text>
                  <Text style={{ fontSize: 14, fontWeight: "800", color: "#FFFFFF", marginTop: 2 }}>
                    ETB {Number(earnings.totalTransferred || 0).toFixed(2)}
                  </Text>
                </View>
                <View style={{ width: 1, backgroundColor: "rgba(255,255,255,0.2)" }} />
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text style={{ fontSize: 11, color: "#FEF3C7", fontWeight: "600" }}>Cash to Hand In</Text>
                  <Text style={{ fontSize: 14, fontWeight: "800", color: "#FEF08A", marginTop: 2 }}>
                    {`ETB ${Number(earnings.cashHeld || 0).toFixed(2)}`}
                  </Text>
                </View>
              </View>
              <View style={{ backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 12, padding: 10, marginBottom: 12, alignItems: "center" }}>
                <Text style={{ fontSize: 11, color: "#CCFBF1", fontWeight: "600" }}>
                  {Number(earnings.netSettlement || 0) >= 0 ? "MyTruck Owes You" : "You Owe MyTruck"}
                </Text>
                <Text style={{ fontSize: 16, fontWeight: "900", color: "#FFFFFF", marginTop: 2 }}>
                  {`ETB ${Math.abs(Number(earnings.netSettlement || 0)).toFixed(2)}`}
                </Text>
                <Text style={{ fontSize: 10.5, color: "#CCFBF1", marginTop: 2, textAlign: "center" }}>
                  Online-paid earnings − payouts received − cash you collected for MyTruck
                </Text>
              </View>

              <View style={s.earningsStatsRow}>
                <View style={s.earningsStatBox}>
                  <Text style={s.earningsStatNum}>{rangeEarnings.totalKm.toFixed(1)}</Text>
                  <Text style={s.earningsStatLabel}>km Traveled</Text>
                </View>
                <View style={s.earningsStatBox}>
                  <Text style={s.earningsStatNum}>80%</Text>
                  <Text style={s.earningsStatLabel}>Your Split</Text>
                </View>
                <View style={s.earningsStatBox}>
                  <Text style={s.earningsStatNum}>Telebirr</Text>
                  <Text style={s.earningsStatLabel}>Settled by Admin</Text>
                </View>
              </View>
            </View>

            <Text style={s.historyTitle}>Completed Delivery History</Text>
            {rangeFilteredOrders.length === 0 ? (
              <View style={s.emptyCard}>
                <MaterialCommunityIcons name="history" size={48} color="#CBD5E1" />
                <Text style={s.emptyTitle}>No Completed Deliveries Yet</Text>
                <Text style={s.emptySub}>Your verified deliveries and earnings breakdown will appear here.</Text>
              </View>
            ) : (
              rangeFilteredOrders.map((ord) => {
                const fareAmt = Number(ord.deliveryFee || 50);
                const riderNetAmt = Number(ord.driverEarnings != null ? ord.driverEarnings : ord.riderNet != null ? ord.riderNet : fareAmt * 0.80);
                const commAmt = Number(ord.deliveryCommission != null ? ord.deliveryCommission : fareAmt * 0.20);
                const distKm = Number(ord.deliveryDistanceKm || ord.distanceKm || 0);
                const deliveredDate = ord.deliveredAt?.seconds
                  ? new Date(ord.deliveredAt.seconds * 1000).toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                  : ord.updatedAt?.seconds
                  ? new Date(ord.updatedAt.seconds * 1000).toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                  : "Completed";

                return (
                  <View key={ord.id} style={s.historyCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.historyStoreName}>{ord.restaurantName || "Partner Merchant"}</Text>
                      <Text style={s.historyDate}>{deliveredDate}</Text>
                      {/* Distance traveled for this delivery */}
                      {distKm > 0 && (
                        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 3, gap: 4 }}>
                          <MaterialCommunityIcons name="map-marker-distance" size={12} color="#179B83" />
                          <Text style={{ fontSize: 10.5, color: "#179B83", fontWeight: "600" }}>
                            {distKm.toFixed(1)} km traveled
                          </Text>
                        </View>
                      )}
                      <Text style={{ fontSize: 10.5, color: "#64748B", marginTop: 2 }}>
                        Fare: ETB {fareAmt.toFixed(2)} · Cut (20%): -ETB {commAmt.toFixed(2)}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={[s.historyAmt, { color: "#166534" }]}>+ ETB {riderNetAmt.toFixed(2)}</Text>
                      <View style={s.historyBadge}>
                        <Text style={s.historyBadgeTxt}>COMPLETED</Text>
                      </View>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}

        {/* TAB 4: DRIVER PROFILE & SETTINGS */}
        {activeTab === "profile" && (
          <View>
            <View style={s.driverProfileCard}>
              <View style={s.driverAvatarWrap}>
                <SmartImage
                  uri={driverPhotoUri || dbUser?.image || dbUser?.profileImage}
                  fallbackType="driver"
                  style={s.driverAvatar}
                  resizeMode="cover"
                />
              </View>
              <Text style={s.driverCardName}>{driverFullName}</Text>
              <Text style={s.driverCardRole}>Certified MyTruck Logistics Driver</Text>

              <TouchableOpacity
                style={{ marginTop: 8, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: "#E6F7F1", flexDirection: "row", alignItems: "center", alignSelf: "center" }}
                onPress={pickDriverPhoto}
              >
                <MaterialCommunityIcons name="camera" size={16} color={TEAL} style={{ marginRight: 6 }} />
                <Text style={{ fontSize: 12, fontWeight: "800", color: TEAL }}>Change Profile Picture</Text>
              </TouchableOpacity>

              <View style={s.driverMetaGrid}>
                <View style={s.driverMetaItem}>
                  <MaterialCommunityIcons name="phone" size={16} color={TEAL} />
                  <Text style={s.driverMetaTxt}>{driverPhone || "N/A"}</Text>
                </View>
                <View style={s.driverMetaItem}>
                  <MaterialCommunityIcons name="motorbike" size={16} color={TEAL} />
                  <Text style={s.driverMetaTxt}>Motorcycle / Van</Text>
                </View>
                <View style={s.driverMetaItem}>
                  <MaterialCommunityIcons name="card-bulleted-outline" size={16} color={TEAL} />
                  <Text style={s.driverMetaTxt}>Verified License</Text>
                </View>
                <View style={s.driverMetaItem}>
                  <MaterialCommunityIcons name="map-marker-radius" size={16} color={TEAL} />
                  <Text style={s.driverMetaTxt}>{dbUser?.city || "Ethiopia"}</Text>
                </View>
              </View>
            </View>

            {/* Mandatory Settlement Profile Form matching User Mandate */}
            <View style={{ backgroundColor: "white", borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: "#E2E8F0" }}>
              <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
                <MaterialCommunityIcons name="bank-transfer" size={22} color={TEAL} style={{ marginRight: 8 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: "800", color: DARK }}>Settlement & Payout Profile</Text>
                  <Text style={{ fontSize: 11, color: "#64748B" }}>Required for daily delivery fare transfers</Text>
                </View>
              </View>

              <Text style={{ fontSize: 12, fontWeight: "700", color: "#475569", marginBottom: 4 }}>Working Phone Number *</Text>
              <TextInput
                style={{ backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: DARK, marginBottom: 10 }}
                placeholder="e.g. 0911223344"
                placeholderTextColor="#94A3B8"
                value={driverPhone}
                onChangeText={setDriverPhone}
                keyboardType="phone-pad"
              />

              <Text style={{ fontSize: 12, fontWeight: "700", color: "#475569", marginBottom: 4 }}>Telebirr Phone Number * (Instant Payouts)</Text>
              <TextInput
                style={{ backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: DARK, marginBottom: 10 }}
                placeholder="e.g. 0911000000"
                placeholderTextColor="#94A3B8"
                value={driverTelebirr}
                onChangeText={setDriverTelebirr}
                keyboardType="phone-pad"
              />

              <Text style={{ fontSize: 12, fontWeight: "700", color: "#475569", marginBottom: 4 }}>Preferred Settlement Bank * (All Ethiopian Banks)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                {ALL_ETHIOPIAN_BANKS.map((b) => (
                  <TouchableOpacity
                    key={b}
                    onPress={() => setDriverBank(b)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 7,
                      borderRadius: 10,
                      backgroundColor: driverBank === b ? TEAL : "#F1F5F9",
                      marginRight: 8,
                    }}
                  >
                    <Text style={{ fontSize: 11.5, fontWeight: "700", color: driverBank === b ? "#FFFFFF" : "#475569" }}>
                      {b}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={{ fontSize: 12, fontWeight: "700", color: "#475569", marginBottom: 4 }}>Bank Account Number *</Text>
              <TextInput
                style={{ backgroundColor: "#F8FAFC", borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: DARK, marginBottom: 12 }}
                placeholder="e.g. 1000123456789"
                placeholderTextColor="#94A3B8"
                value={driverAccount}
                onChangeText={setDriverAccount}
                keyboardType="numeric"
              />

              <TouchableOpacity
                style={[{ backgroundColor: TEAL, paddingVertical: 14, borderRadius: 12, alignItems: "center" }, savingDriverProfile && { opacity: 0.7 }]}
                onPress={handleSaveDriverProfile}
                disabled={savingDriverProfile}
              >
                {savingDriverProfile ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={{ fontSize: 14, fontWeight: "800", color: "white" }}>Save Settlement Details</Text>
                )}
              </TouchableOpacity>
            </View>


            {/* Sign Out Button */}
            <TouchableOpacity
              onPress={() => {
                Alert.alert(
                  "Sign Out",
                  "Are you sure you want to sign out of your driver terminal?",
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
              <Text style={s.signOutBtnTxt}>Sign Out of Driver Terminal</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Customer Delivery Confirmation PIN Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={otpModalVisible}
        onRequestClose={() => setOtpModalVisible(false)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <View style={s.modalIconCircle}>
              <MaterialCommunityIcons name="shield-key" size={32} color={TEAL} />
            </View>
            <Text style={s.modalTitle}>Enter Customer PIN</Text>
            <Text style={s.modalSubtitle}>
              Ask the customer for the 4-digit confirmation PIN shown on their order tracking screen to finalize handover.
            </Text>

            <TextInput
              style={s.otpInput}
              placeholder="• • • •"
              placeholderTextColor="#94A3B8"
              keyboardType="number-pad"
              maxLength={4}
              value={enteredOtp}
              onChangeText={(val) => {
                setEnteredOtp(val);
                setOtpError("");
              }}
              autoFocus
            />

            {Boolean(otpError) && <Text style={s.errorText}>{otpError}</Text>}

            <View style={s.modalBtnRow}>
              <TouchableOpacity
                style={s.cancelBtn}
                onPress={() => setOtpModalVisible(false)}
              >
                <Text style={s.cancelBtnTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.verifyBtn}
                onPress={handleVerifyOtpAndComplete}
                disabled={completing}
              >
                <Text style={s.verifyBtnTxt}>{completing ? "Verifying…" : "Verify & Complete"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Reject Assignment Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={rejectModalVisible}
        onRequestClose={() => setRejectModalVisible(false)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Release Assignment</Text>
            <Text style={s.modalSubtitle}>
              Select the reason you are unable to fulfill this order so it can be immediately re-assigned to other carriers.
            </Text>

            {[
              "Vehicle breakdown or mechanical issue",
              "Excessive distance or unreachable area",
              "Customer or merchant unreachable",
              "Personal emergency",
            ].map((reason) => {
              const sel = rejectReason === reason;
              return (
                <TouchableOpacity
                  key={reason}
                  style={[s.reasonPill, sel && s.reasonPillActive]}
                  onPress={() => setRejectReason(reason)}
                >
                  <MaterialCommunityIcons
                    name={sel ? "radiobox-marked" : "radiobox-blank"}
                    size={18}
                    color={sel ? TEAL : "#94A3B8"}
                  />
                  <Text style={[s.reasonTxt, sel && s.reasonTxtActive]}>{reason}</Text>
                </TouchableOpacity>
              );
            })}

            <View style={s.modalBtnRow}>
              <TouchableOpacity
                style={s.cancelBtn}
                onPress={() => setRejectModalVisible(false)}
              >
                <Text style={s.cancelBtnTxt}>Keep Order</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.verifyBtn, { backgroundColor: "#DC2626" }]}
                onPress={handleRejectAssignment}
              >
                <Text style={s.verifyBtnTxt}>Confirm Release</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  dutyPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  dutyOnline: {
    backgroundColor: "#DCFCE7",
  },
  dutyOffline: {
    backgroundColor: "#FEF9C3",
  },
  dutyTxt: {
    fontSize: 9,
    fontWeight: "800",
  },
  dutyTxtOnline: {
    color: "#166534",
  },
  dutyTxtOffline: {
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
  onlineSwitchWrap: {
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    borderRadius: 20,
    padding: 2,
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
  gpsBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    marginBottom: 12,
  },
  gpsBannerTxt: {
    fontSize: 11,
    fontWeight: "700",
    color: "#166534",
    marginLeft: 6,
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
    fontSize: 13,
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
  offlineBannerCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginTop: 10,
  },
  offlineTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: DARK,
    marginTop: 12,
  },
  offlineSub: {
    fontSize: 12,
    color: "#64748B",
    textAlign: "center",
    marginTop: 4,
    lineHeight: 18,
    maxWidth: 280,
  },
  goOnlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: TEAL,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    marginTop: 16,
  },
  goOnlineBtnTxt: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
    marginLeft: 6,
  },
  deliveryCard: {
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
  deliveryCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
    paddingBottom: 10,
    marginBottom: 10,
  },
  merchantThumb: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: "#F1F5F9",
  },
  merchantName: {
    fontSize: 14,
    fontWeight: "800",
    color: DARK,
    maxWidth: 160,
  },
  deliveryRefText: {
    fontSize: 10,
    color: "#94A3B8",
    marginTop: 1,
  },
  fareBadge: {
    alignItems: "flex-end",
  },
  fareLabel: {
    fontSize: 9,
    color: "#64748B",
    fontWeight: "700",
  },
  fareValue: {
    fontSize: 15,
    fontWeight: "900",
    color: TEAL,
  },
  routeBox: {
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  routeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  routeDottedLine: {
    width: 2,
    height: 14,
    backgroundColor: "#CBD5E1",
    marginLeft: 4,
    marginVertical: 2,
  },
  routeLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: "#94A3B8",
  },
  routeAddress: {
    fontSize: 12,
    fontWeight: "600",
    color: DARK,
    marginTop: 1,
  },
  acceptBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: TEAL,
    paddingVertical: 12,
    borderRadius: 12,
  },
  acceptBtnTxt: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
    marginLeft: 6,
  },
  activeMissionCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 16,
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    borderWidth: 1,
    borderColor: "#EDF2F1",
  },
  missionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
    paddingBottom: 12,
    marginBottom: 12,
  },
  missionRefText: {
    fontSize: 14,
    fontWeight: "900",
    color: DARK,
  },
  missionStatusText: {
    fontSize: 11,
    color: TEAL,
    fontWeight: "700",
    marginTop: 2,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusTxt: {
    fontSize: 10,
    fontWeight: "800",
  },
  missionSection: {
    backgroundColor: "#F8FAFC",
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: "#64748B",
    marginLeft: 6,
  },
  sectionName: {
    fontSize: 14,
    fontWeight: "800",
    color: DARK,
  },
  sectionAddress: {
    fontSize: 12,
    color: "#475569",
    marginTop: 2,
    lineHeight: 16,
  },
  sectionCallBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    marginTop: 8,
  },
  sectionCallBtnTxt: {
    fontSize: 11,
    fontWeight: "700",
    color: TEAL,
    marginLeft: 4,
  },
  missionFinancialRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
    marginBottom: 10,
  },
  missionFinLabel: {
    fontSize: 11,
    color: "#64748B",
  },
  missionFinAmt: {
    fontSize: 16,
    fontWeight: "900",
    color: TEAL,
  },
  paymentStatusBadge: {
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  paymentStatusBadgeTxt: {
    color: "#166534",
    fontSize: 10,
    fontWeight: "800",
  },
  missionActionsWrap: {
    marginTop: 6,
  },
  primaryActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 14,
  },
  primaryActionBtnTxt: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
    marginLeft: 6,
  },
  releaseBtn: {
    width: 48,
    backgroundColor: "#FEE2E2",
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  earningsHeroCard: {
    backgroundColor: DARK,
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
  },
  earningsHeroSub: {
    fontSize: 12,
    color: "#A7F3D0",
    fontWeight: "700",
  },
  earningsHeroAmt: {
    fontSize: 28,
    fontWeight: "900",
    color: "#FFFFFF",
    marginTop: 4,
  },
  earningsStatsRow: {
    flexDirection: "row",
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.15)",
    gap: 8,
  },
  earningsStatBox: {
    flex: 1,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    padding: 10,
    borderRadius: 12,
  },
  earningsStatNum: {
    fontSize: 14,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  earningsStatLabel: {
    fontSize: 10,
    color: "#94A3B8",
    marginTop: 2,
  },
  historyTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: DARK,
    marginBottom: 10,
  },
  historyCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#EDF2F1",
  },
  historyStoreName: {
    fontSize: 13,
    fontWeight: "700",
    color: DARK,
  },
  historyDate: {
    fontSize: 11,
    color: "#94A3B8",
    marginTop: 2,
  },
  historyAmt: {
    fontSize: 13,
    fontWeight: "800",
    color: TEAL,
  },
  historyBadge: {
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    marginTop: 2,
  },
  historyBadgeTxt: {
    fontSize: 8,
    fontWeight: "800",
    color: "#166534",
  },
  driverProfileCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 20,
    alignItems: "center",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#EDF2F1",
  },
  driverAvatarWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    overflow: "hidden",
    borderWidth: 3,
    borderColor: TEAL,
    marginBottom: 10,
  },
  driverAvatar: {
    width: "100%",
    height: "100%",
  },
  driverCardName: {
    fontSize: 18,
    fontWeight: "800",
    color: DARK,
  },
  driverCardRole: {
    fontSize: 12,
    color: TEAL,
    fontWeight: "700",
    marginTop: 2,
    marginBottom: 16,
  },
  driverMetaGrid: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  driverMetaItem: {
    flexDirection: "row",
    alignItems: "center",
    width: "48%",
    backgroundColor: "#F8FAFC",
    padding: 10,
    borderRadius: 10,
  },
  driverMetaTxt: {
    fontSize: 11,
    fontWeight: "600",
    color: DARK,
    marginLeft: 6,
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
    maxWidth: 280,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(11, 42, 38, 0.65)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 24,
    alignItems: "center",
    elevation: 8,
  },
  modalIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#E6F7F1",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: DARK,
    textAlign: "center",
  },
  modalSubtitle: {
    fontSize: 12,
    color: "#64748B",
    textAlign: "center",
    marginTop: 6,
    lineHeight: 18,
  },
  otpInput: {
    width: "80%",
    height: 52,
    borderWidth: 2,
    borderColor: TEAL,
    borderRadius: 14,
    marginTop: 18,
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: 10,
    textAlign: "center",
    color: DARK,
    backgroundColor: "#F8FAFC",
  },
  errorText: {
    color: "#DC2626",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 8,
    textAlign: "center",
  },
  modalBtnRow: {
    flexDirection: "row",
    marginTop: 20,
    gap: 12,
    width: "100%",
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
  },
  cancelBtnTxt: {
    fontWeight: "700",
    color: "#475569",
    fontSize: 13,
  },
  verifyBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: TEAL,
    alignItems: "center",
  },
  verifyBtnTxt: {
    fontWeight: "800",
    color: "#FFFFFF",
    fontSize: 13,
  },
  reasonPill: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginTop: 8,
  },
  reasonPillActive: {
    borderColor: TEAL,
    backgroundColor: "#E6F7F1",
  },
  reasonTxt: {
    fontSize: 12,
    color: "#475569",
    marginLeft: 10,
    flex: 1,
  },
  reasonTxtActive: {
    color: DARK,
    fontWeight: "700",
  },
});
