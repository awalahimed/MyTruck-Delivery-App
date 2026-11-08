import React, { useEffect, useState, useRef, useMemo } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  Linking,
  Alert,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  Modal,
} from "react-native";
import { WebView } from "react-native-webview";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import { doc, onSnapshot, getDoc, updateDoc, serverTimestamp, runTransaction } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import SharedMapView from "../components/SharedMapView";
import { StatusBar } from "expo-status-bar";
import { ArrowLeftIcon, XMarkIcon } from "react-native-heroicons/outline";
import { StarIcon } from "react-native-heroicons/solid";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { db, app } from "../firebase";
import { notifyMerchant } from "../services/orderNotifications";
import { MAP_TILE_URL, isWithinEthiopia } from "../utils/mapService";
import BackButton from "../components/ui/BackButton";

const { width } = Dimensions.get("window");
const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";

// High quality cropped assets from attached designs
const DRIVER_AVATAR = require("../assets/cropped/driver_avatar.png");
const TRACK_MAP_ROUTE = require("../assets/cropped/track_map_route.png");

export default function PreparingOrderScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const orderId = route.params?.id || route.params?.orderId;

  const [order, setOrder] = useState(null);
  const [routeInfo, setRouteInfo] = useState({ distanceKm: null, etaMinutes: null });

  const restaurantCoord = useMemo(() => ({
    latitude:
      Number(order?.restaurantLat) && isWithinEthiopia(order?.restaurantLat, order?.restaurantLng)
        ? Number(order.restaurantLat)
        : 8.992,
    longitude:
      Number(order?.restaurantLng) && isWithinEthiopia(order?.restaurantLat, order?.restaurantLng)
        ? Number(order.restaurantLng)
        : 38.752,
    title: order?.restaurantName || order?.items?.[0]?.restaurantTitle || "Restaurant / Pickup",
    address: order?.restaurantAddress || order?.restaurantLocation || "Bole Road, Addis Ababa",
  }), [order?.restaurantLat, order?.restaurantLng, order?.restaurantName, order?.items, order?.restaurantAddress, order?.restaurantLocation]);

  const deliveryCoord = useMemo(() => ({
    latitude:
      Number(order?.deliveryLat) && isWithinEthiopia(order?.deliveryLat, order?.deliveryLng)
        ? Number(order.deliveryLat)
        : 8.978,
    longitude:
      Number(order?.deliveryLng) && isWithinEthiopia(order?.deliveryLat, order?.deliveryLng)
        ? Number(order.deliveryLng)
        : 38.775,
    title: order?.deliveryName || (order?.customerName ? `${order.customerName} (Delivery)` : "Customer Delivery"),
    address: order?.deliveryAddress || order?.customerAddress || "Delivery Address, Addis Ababa",
  }), [order?.deliveryLat, order?.deliveryLng, order?.deliveryName, order?.customerName, order?.deliveryAddress, order?.customerAddress]);

  // Derive active driver location from live order, or dynamically position along active corridor
  const activeDriverLocation = useMemo(() => {
    if (order?.driverLat && order?.driverLng && isWithinEthiopia(order?.driverLat, order?.driverLng)) {
      return {
        latitude: Number(order.driverLat),
        longitude: Number(order.driverLng),
        title: order?.driverName ? `Courier (${order.driverName})` : "Delivery Courier (🛵)",
        status: order?.status,
      };
    }
    // Dynamic corridor position between restaurant and customer
    const rLat = restaurantCoord.latitude;
    const rLng = restaurantCoord.longitude;
    const dLat = deliveryCoord.latitude;
    const dLng = deliveryCoord.longitude;
    const isTransit = ["PICKED_UP", "OUT_FOR_DELIVERY", "IN_TRANSIT", "DELIVERING"].includes(
      String(order?.status || "").toUpperCase()
    );
    const ratio = isTransit ? 0.6 : 0.25;
    return {
      latitude: Number((rLat + (dLat - rLat) * ratio).toFixed(6)),
      longitude: Number((rLng + (dLng - rLng) * ratio).toFixed(6)),
      title: order?.driverName ? `Courier (${order.driverName})` : "Delivery Courier (🛵)",
      status: order?.status,
    };
  }, [order?.driverLat, order?.driverLng, order?.driverName, order?.status, restaurantCoord, deliveryCoord]);

  // Listen to live order from Firestore if orderId provided
  useEffect(() => {
    if (!orderId) return;
    const cleanId = String(orderId).trim();
    if (!cleanId) return;
    const unsub = onSnapshot(doc(db, "orders", cleanId), (snap) => {
      if (snap.exists()) {
        const d = snap.data();
        setOrder({ id: snap.id, ...d });
      }
    }, (err) => {
      console.warn("PreparingOrderScreen order listener notice:", err?.message);
    });
    return unsub;
  }, [orderId]);

  const handleCall = () => {
    const phone = order?.driverPhone;
    if (!phone) {
      Alert.alert("Contact Driver", "Your driver's phone number isn't available yet.");
      return;
    }
    Linking.openURL(`tel:${phone}`).catch(() => {
      Alert.alert("Contact Driver", `Call ${phone}`);
    });
  };

  const handleChat = () => {
    const phone = order?.driverPhone;
    if (!phone) {
      Alert.alert("Chat", "Your driver's phone number isn't available yet.");
      return;
    }
    const cleanPhone = phone.replace(/\D/g, "");
    Linking.openURL(`https://wa.me/${cleanPhone}`).catch(() => {
      Alert.alert("Chat", `Message ${phone}`);
    });
  };

  const [verifying, setVerifying] = useState(false);
  const [payingNow, setPayingNow] = useState(false);

  const initialCheckoutUrl = route.params?.initialCheckoutUrl;
  const autoLaunchChapa = route.params?.autoLaunchChapa;
  const [chapaModalVisible, setChapaModalVisible] = useState(false);
  const [activeCheckoutUrl, setActiveCheckoutUrl] = useState(initialCheckoutUrl || null);

  // ── Customer cancellation ────────────────────────────────────────────
  // Allowed only before the merchant accepts and before a driver is assigned.
  const CUSTOMER_CANCELLABLE = ["AWAITING_PAYMENT", "PENDING", "AWAITING_MERCHANT", "MERCHANT_REJECTED"];
  const [cancelling, setCancelling] = useState(false);
  const canCancel = Boolean(order) && CUSTOMER_CANCELLABLE.includes(order.status) && !order.driverId;

  const cancelOrder = async (reason) => {
    if (!orderId) return;
    setCancelling(true);
    try {
      const result = await runTransaction(db, async (tx) => {
        const ref = doc(db, "orders", String(orderId).trim());
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("Order not found.");
        const o = snap.data();
        // Re-check against the live order: the store may have accepted it a moment ago
        if (!CUSTOMER_CANCELLABLE.includes(o.status) || o.driverId) {
          throw new Error("The store has already accepted this order, so it can no longer be cancelled here. Please contact support.");
        }
        const paid = o.paymentStatus === "PAID";
        tx.update(ref, {
          status: "CANCELLED",
          cancelledBy: "CUSTOMER",
          cancelReason: reason,
          cancelledAt: serverTimestamp(),
          ...(paid ? { refundStatus: "REQUESTED", refundAmount: Number(o.total || 0) } : {}),
          updatedAt: serverTimestamp(),
        });
        return { paid, storeSawIt: o.status !== "AWAITING_PAYMENT", order: { id: snap.id, ...o } };
      });
      if (result.storeSawIt) {
        notifyMerchant(result.order, "Order Cancelled ❌", "The customer cancelled this order before it was accepted. No action needed.");
      }
      setChapaModalVisible(false);
      Alert.alert(
        "Order Cancelled",
        result.paid
          ? "Your order was cancelled. Your Chapa payment will be refunded by MyTruck support to the original payment method."
          : "Your order was cancelled. You have not been charged."
      );
    } catch (e) {
      Alert.alert("Could Not Cancel", e?.message || "Please try again.");
    } finally {
      setCancelling(false);
    }
  };

  const confirmCancel = () => {
    const pick = (reason) => () => cancelOrder(reason);
    Alert.alert(
      "Cancel this order?",
      order?.paymentStatus === "PAID"
        ? "The store hasn't accepted it yet. Your payment will be refunded."
        : "The store hasn't accepted it yet, so you won't be charged.",
      [
        { text: "Keep Order", style: "cancel" },
        { text: "Ordered by mistake", onPress: pick("Ordered by mistake") },
        { text: "Taking too long", onPress: pick("Taking too long") },
        { text: "Other reason", style: "destructive", onPress: pick("Other") },
      ]
    );
  };

  useEffect(() => {
    if (autoLaunchChapa && initialCheckoutUrl) {
      setActiveCheckoutUrl(initialCheckoutUrl);
      setChapaModalVisible(true);
    }
  }, [autoLaunchChapa, initialCheckoutUrl]);

  const handlePayNowWithChapa = async () => {
    if (!orderId) {
      Alert.alert("Order Information", "No active order found to pay for.");
      return;
    }
    const cleanOrderId = String(orderId).trim();
    setPayingNow(true);

    try {
      // Always generate a fresh checkout session to avoid Chapa "Retry failed" lock
      let checkoutUrl = null;
      const txRef = `MT${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

      // Chapa is initialized server-side (functions/index.js) so the secret key never ships in the app.
      try {
        const startCheckout = httpsCallable(getFunctions(app), "createChapaCheckout");
        const res = await startCheckout({
          orderIds: [cleanOrderId],
          txRef,
          amount: Number(order?.total || 100),
          email: order?.customerEmail || "customer@gmail.com",
          currency: "ETB",
          returnUrl: "https://checkout.chapa.co/checkout/payment-receipt",
        });
        checkoutUrl = res?.data?.checkoutUrl;
      } catch (cfErr) {
        console.warn("createChapaCheckout error:", cfErr?.message);
      }

      if (checkoutUrl) {
        await updateDoc(doc(db, "orders", cleanOrderId), {
          chapaCheckoutUrl: checkoutUrl,
        }).catch(() => {});
        setActiveCheckoutUrl(checkoutUrl);
        setChapaModalVisible(true);
      } else {
        Alert.alert(
          "Chapa Checkout",
          "Could not initialize Chapa checkout. Please ensure your internet connection is active, or tap Check Payment Status."
        );
      }
    } catch (err) {
      console.warn("handlePayNowWithChapa note:", err?.message);
      Alert.alert(
        "Chapa Payment",
        err?.message || "Could not launch Chapa checkout. If you completed payment, tap Check Payment Status."
      );
    } finally {
      setPayingNow(false);
    }
  };

  const handleVerifyChapa = async () => {
    if (!orderId) {
      Alert.alert("Order Information", "No active order ID to verify.");
      return;
    }
    const cleanOrderId = String(orderId).trim();
    setVerifying(true);

    try {
      // 1. First check if Firestore document was already fulfilled as PAID by backend or webhook
      const snap = await getDoc(doc(db, "orders", cleanOrderId));
      if (snap.exists() && snap.data()?.paymentStatus === "PAID") {
        setChapaModalVisible(false);
        setOrder((prev) => ({ ...(prev || {}), ...snap.data() }));
        Alert.alert(
          "Payment Confirmed",
          "Your payment has been successfully received and verified! The restaurant is preparing your order."
        );
        setVerifying(false);
        return;
      }

      // 2. Query secure backend Cloud Function
      let data = null;
      try {
        const fn = httpsCallable(getFunctions(app), "verifyChapaPayment");
        const res = await fn({
          orderId: cleanOrderId,
          tx_ref: order?.chapaMerchantReference || "",
        });
        data = res?.data;
      } catch (cfErr) {
        console.warn("verifyChapaPayment CF note:", cfErr?.message);
      }

      if (data?.verified || data?.paymentStatus === "PAID") {
        setChapaModalVisible(false);
        setOrder((prev) => ({ ...(prev || {}), paymentStatus: "PAID", status: "PENDING" }));
        Alert.alert(
          "Payment Confirmed",
          "Your payment was confirmed by Chapa! The restaurant has received your order."
        );
        setVerifying(false);
        return;
      }

      if (data?.paymentStatus === "FAILED") {
        Alert.alert(
          "Payment Unsuccessful",
          "The transaction was not completed. You can retry paying with Chapa.",
          [
            { text: "Dismiss", style: "cancel" },
            { text: "Retry Payment", onPress: () => handlePayNowWithChapa() },
          ]
        );
        setVerifying(false);
        return;
      }

      // 4. Payment still pending confirmation with bank / mobile wallet
      Alert.alert(
        "Payment In Progress",
        "Payment is currently processing with your bank or mobile wallet. If you authorized via Telebirr or CBE Birr, please allow 15-30 seconds and tap 'Check Payment Status' again.",
        [
          { text: "OK", style: "cancel" },
          {
            text: "Pay Now with Chapa",
            onPress: () => handlePayNowWithChapa(),
          },
        ]
      );
    } catch (err) {
      console.warn("handleVerifyChapa error:", err?.message);
      Alert.alert(
        "Payment Processing",
        "Payment confirmation is currently updating. Please allow a few moments and tap Check Payment Status."
      );
    } finally {
      setVerifying(false);
    }
  };

  const handleClose = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("HomeTab");
  };

  return (
    <View style={s.root}>
      <StatusBar style="light" backgroundColor={TEAL} />

      {/* Enhanced Teal Header matching My Orders */}
      <View style={s.headerOuter}>
        <SafeAreaView edges={["top"]} style={s.safeTop}>
          <View style={s.topHeader}>
            <BackButton fallbackRoute="HomeTab" iconColor="white" />

            <View style={s.headerCenter}>
              <Text style={s.headerTitle}>Track Order</Text>
              <Text style={s.headerSub} numberOfLines={1}>
                {orderId ? `Order #${String(orderId).slice(-6).toUpperCase()} · Live Tracking` : "Live Delivery Tracking"}
              </Text>
            </View>

            <TouchableOpacity
              onPress={handleClose}
              style={s.headerIconBtn}
              activeOpacity={0.8}
              accessibilityLabel="Close tracking"
            >
              <XMarkIcon size={20} color="white" />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>

      <ScrollView
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Interactive Map Area with Store, Route, Driver Bike, and Destination */}
        <View style={s.mapContainer}>
          <SharedMapView
            style={StyleSheet.absoluteFillObject}
            initialRegion={{
              latitude: (restaurantCoord.latitude + deliveryCoord.latitude) / 2,
              longitude: (restaurantCoord.longitude + deliveryCoord.longitude) / 2,
              latitudeDelta: Math.max(0.04, Math.abs(restaurantCoord.latitude - deliveryCoord.latitude) * 1.6),
              longitudeDelta: Math.max(0.04, Math.abs(restaurantCoord.longitude - deliveryCoord.longitude) * 1.6),
            }}
            mode="route"
            origin={restaurantCoord}
            destination={deliveryCoord}
            driverLocation={activeDriverLocation}
            orderStatus={order?.status}
            onRouteInfo={(info) => {
              if (
                info &&
                (info.distanceKm !== routeInfo.distanceKm ||
                  info.etaMinutes !== routeInfo.etaMinutes)
              ) {
                setRouteInfo(info);
              }
            }}
            showControls={true}
          />
        </View>

        {/* Real Road Route & Distance Badge with Intercity Support */}
        {(() => {
          const distVal = routeInfo.distanceKm || order?.deliveryDistanceKm || null;
          const etaVal = routeInfo.etaMinutes || order?.deliveryEtaMinutes || null;
          if (!distVal && !etaVal) return null;

          return (
            <View style={s.routeMetricCard}>
              <View style={s.metricItem}>
                <MaterialCommunityIcons name="road-variant" size={20} color={TEAL} />
                <View style={{ marginLeft: 8 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={s.metricVal}>{distVal} km</Text>
                    {Boolean(order?.isIntercity) && (
                      <View style={{ backgroundColor: "#EFF6FF", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 }}>
                        <Text style={{ fontSize: 9.5, fontWeight: "800", color: "#2563EB" }}>🛣️ INTERCITY</Text>
                      </View>
                    )}
                  </View>
                  <Text style={s.metricLbl}>Road Distance</Text>
                </View>
              </View>
              <View style={s.metricDivider} />
              <View style={s.metricItem}>
                <MaterialCommunityIcons name="clock-fast" size={20} color={ORANGE} />
                <View style={{ marginLeft: 8 }}>
                  <Text style={s.metricVal}>{etaVal} mins</Text>
                  <Text style={s.metricLbl}>Est. Duration</Text>
                </View>
              </View>
            </View>
          );
        })()}

        {/* Pickup & Destination Locations Card */}
        <View style={{ backgroundColor: "#FFFFFF", borderRadius: 16, padding: 14, marginHorizontal: 16, marginTop: 12, borderWidth: 1, borderColor: "#E2E8F0" }}>
          {/* Pickup Point */}
          <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "#E6F7F1", alignItems: "center", justifyContent: "center", marginTop: 2 }}>
              <MaterialCommunityIcons name="storefront" size={16} color={TEAL} />
            </View>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={{ fontSize: 11, fontWeight: "700", color: "#64748B", textTransform: "uppercase" }}>Pickup Location</Text>
              <Text style={{ fontSize: 13, fontWeight: "800", color: DARK }}>{order?.restaurantName || "Partner Restaurant"}</Text>
              <Text style={{ fontSize: 11.5, color: "#64748B", marginTop: 1 }}>{order?.pickupAddress || order?.restaurantAddress || "Addis Ababa"}</Text>
            </View>
          </View>

          {/* Dotted separator */}
          <View style={{ width: 2, height: 16, backgroundColor: "#CBD5E1", marginLeft: 13, marginVertical: 3 }} />

          {/* Drop-off Point */}
          <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: "#FFF7ED", alignItems: "center", justifyContent: "center", marginTop: 2 }}>
              <MaterialCommunityIcons name="home-map-marker" size={16} color={ORANGE} />
            </View>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={{ fontSize: 11, fontWeight: "700", color: "#64748B", textTransform: "uppercase" }}>Delivery Destination</Text>
              <Text style={{ fontSize: 13, fontWeight: "800", color: DARK }}>{order?.customerName || "Your Delivery Address"}</Text>
              <Text style={{ fontSize: 11.5, color: "#64748B", marginTop: 1 }}>{order?.dropoffAddress || order?.deliveryAddress || "Addis Ababa"}</Text>
            </View>
          </View>
        </View>

        {/* 4-digit delivery PIN: shown once the store accepts, for Cash on Delivery and paid orders */}
        {Boolean(order?.deliveryOtp) &&
          (order?.paymentStatus === "PAID" || order?.paymentMethod !== "CHAPA") &&
          ["ACCEPTED", "PREPARING", "READY", "DRIVERACCEPTED", "DRIVERPICKEDUP"].includes(order?.status) && (
          <View style={s.otpCard}>
            <View style={s.otpHeader}>
              <MaterialCommunityIcons name="shield-check" size={20} color={TEAL} />
              <Text style={s.otpTitle}>Delivery Confirmation PIN</Text>
            </View>
            <Text style={s.otpDesc}>
              {order?.paymentMethod === "CHAPA"
                ? "Share this 4-digit code with your driver upon arrival to confirm the handover."
                : `Pay ETB ${Number(order?.total || 0).toFixed(2)} in cash, then share this 4-digit code with your driver to confirm the handover.`}
            </Text>
            <View style={s.otpDigitsRow}>
              {String(order.deliveryOtp)
                .slice(0, 4)
                .split("")
                .map((digit, i) => (
                  <View key={i} style={s.otpBox}>
                    <Text style={s.otpText}>{digit}</Text>
                  </View>
                ))}
            </View>
          </View>
        )}

        {/* Unpaid Warning Banner if customer left checkout without paying */}
        {order?.paymentMethod === "CHAPA" && order?.paymentStatus !== "PAID" && order?.status !== "CANCELLED" && (
          <View style={s.unpaidOrderBanner}>
            <View style={s.unpaidIconWrap}>
              <MaterialCommunityIcons name="credit-card-clock-outline" size={24} color="#B45309" />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={s.unpaidBannerTitle}>Payment Incomplete (Unpaid)</Text>
              <Text style={s.unpaidBannerSub}>
                Your order is currently on hold. Kitchen preparation will begin as soon as your payment is confirmed.
              </Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                <TouchableOpacity
                  style={s.unpaidActionPay}
                  onPress={handlePayNowWithChapa}
                  activeOpacity={0.85}
                >
                  <Text style={s.unpaidActionPayTxt}>Pay Now with Chapa</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.unpaidActionCheck}
                  onPress={handleVerifyChapa}
                  activeOpacity={0.85}
                >
                  <Text style={s.unpaidActionCheckTxt}>Check Status</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Status Pill matching Image 1 */}
        <View style={s.statusPillCard}>
          <View style={s.statusPinCircle}>
            <MaterialCommunityIcons name="map-marker" size={20} color="white" />
          </View>
          <View style={s.statusTextWrap}>
            <Text style={s.statusTitle}>
              {order?.status === "COMPLETE" || order?.status === "DELIVERED"
                ? "Order Delivered"
                : order?.status === "CANCELLED"
                ? "Order Cancelled"
                : order?.paymentMethod === "CHAPA" && order?.paymentStatus !== "PAID"
                ? "Awaiting Online Payment"
                : order?.status === "DRIVERPICKEDUP" || order?.status === "ON_THE_WAY"
                ? "Your order is on the way"
                : order?.status === "DRIVERACCEPTED" || order?.status === "READY"
                ? "Driver is picking up your order"
                : order?.status === "ACCEPTED" || order?.status === "PREPARING"
                ? "Restaurant is preparing your order"
                : "Order Placed & Awaiting Confirmation"}
            </Text>
            <Text style={s.statusSubtitle}>
              {order?.status === "COMPLETE" || order?.status === "DELIVERED"
                ? "Delivered successfully! Enjoy your meal."
                : order?.status === "CANCELLED"
                ? order?.refundStatus === "REQUESTED"
                  ? "Cancelled · refund in progress"
                  : "This order was cancelled"
                : order?.paymentMethod === "CHAPA" && order?.paymentStatus !== "PAID"
                ? "Please complete payment via Telebirr, CBE, or Card to begin preparation."
                : order?.status === "DRIVERPICKEDUP" || order?.status === "ON_THE_WAY"
                ? "Driver is heading to your location"
                : order?.status === "DRIVERACCEPTED" || order?.status === "READY"
                ? "Your driver is at or heading to the store"
                : order?.status === "ACCEPTED" || order?.status === "PREPARING"
                ? order?.driverId
                  ? "Kitchen is preparing your items · driver already assigned"
                  : "Kitchen is preparing your items"
                : "Your order details have been safely received"}
            </Text>
          </View>
        </View>

        {canCancel && (
          <TouchableOpacity
            onPress={confirmCancel}
            disabled={cancelling}
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", marginHorizontal: 16, marginBottom: 12, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: "#FCA5A5", backgroundColor: "#FFF5F5" }}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            {cancelling ? (
              <ActivityIndicator size="small" color="#DC2626" />
            ) : (
              <>
                <MaterialCommunityIcons name="close-circle-outline" size={18} color="#DC2626" style={{ marginRight: 6 }} />
                <Text style={{ fontSize: 13, fontWeight: "700", color: "#DC2626" }}>Cancel Order</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Customer Information Card (Phase 3.1 - Non-clickable info with icons) */}
        <View style={s.customerCard}>
          <View style={s.customerHeaderRow}>
            <MaterialCommunityIcons name="account-outline" size={18} color={TEAL} />
            <Text style={s.customerHeaderTitle}>Customer Information</Text>
          </View>
          <View style={s.customerDetailsBody}>
            <Text style={s.customerNameTxt}>
              {order?.customerName || order?.userFirstName || "Valued Customer"}
            </Text>
            <View style={s.contactInfoRow}>
              <MaterialCommunityIcons name="phone-outline" size={14} color="#64748B" />
              <Text style={s.contactNonClickableTxt}>
                {order?.customerPhone || order?.userPhoneNumber || "—"}
              </Text>
            </View>
            <View style={[s.contactInfoRow, { marginTop: 4 }]}>
              <MaterialCommunityIcons name="whatsapp" size={14} color="#16A34A" />
              <Text style={s.contactNonClickableTxt}>
                {order?.customerWhatsApp || order?.customerPhone || "—"}
              </Text>
            </View>
          </View>
        </View>

        {/* Store Rejection Banner */}
        {Boolean(order?.status === "MERCHANT_REJECTED") && (
          <View style={{ backgroundColor: "#FEE2E2", borderWidth: 1, borderColor: "#FCA5A5", borderRadius: 14, padding: 14, marginHorizontal: 16, marginBottom: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
              <MaterialCommunityIcons name="alert-circle" size={20} color="#B91C1C" style={{ marginRight: 6 }} />
              <Text style={{ fontSize: 13, fontWeight: "800", color: "#B91C1C" }}>Store Update</Text>
            </View>
            <Text style={{ fontSize: 12, color: "#7F1D1D", lineHeight: 17 }}>
              {order?.restaurantName || "The store"} could not fulfill this order ({order?.merchantRejectionReason || "Item out of stock"}).
              Our operations team is currently reassigning your order to an alternative partner store.
            </Text>
          </View>
        )}

        {/* Driver Card (Phase 3.2) */}
        {order?.status === "CANCELLED" ? null : order?.driverName || order?.driverId ? (
          <View style={s.driverCard}>
            <Image
              source={order.driverImage ? { uri: order.driverImage } : DRIVER_AVATAR}
              style={s.driverAvatar}
              resizeMode="cover"
            />
            <View style={s.driverInfo}>
              <Text style={s.driverName}>
                {order.driverName || "Your driver"}
              </Text>
              <View style={s.ratingRow}>
                <StarIcon size={14} color="#FBBF24" />
                <Text style={s.ratingText}>{`MyTruck driver · ${order.vehiclePlate || "Motorbike"}`}</Text>
              </View>
            </View>

            {/* Action Buttons: Phone & WhatsApp Chat */}
            <View style={s.contactBtnsRow}>
              <TouchableOpacity
                onPress={handleCall}
                style={s.phoneCallBtn}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons name="phone" size={20} color={TEAL} />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleChat}
                style={s.chatBtn}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons name="chat-processing" size={20} color="white" />
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          /* Waiting for Driver State */
          <View style={s.waitingDriverCard}>
            <View style={s.waitingIconWrap}>
              <MaterialCommunityIcons name="motorbike" size={24} color={TEAL} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={s.waitingTitle}>Assigning Delivery Partner</Text>
              <Text style={s.waitingSub}>
                Matching nearest driver near {order?.restaurantName || "the store"}...
              </Text>
            </View>
            <View style={s.waitingBadge}>
              <Text style={s.waitingBadgeTxt}>DISPATCHING</Text>
            </View>
          </View>
        )}

        {/* Order Status Timeline matching Image 1 */}
        <View style={s.timelineCard}>
          {(order?.status === "CANCELLED"
            ? [
                { title: "Order placed", time: "Submitted", done: true, active: false },
                {
                  title: "Order cancelled",
                  time: order?.cancelReason ? `Reason: ${order.cancelReason}` : "Cancelled",
                  done: false,
                  active: true,
                  isAlert: true,
                },
              ]
            : order?.paymentMethod === "CHAPA" && order?.paymentStatus !== "PAID"
            ? [
                {
                  title: "Order placed",
                  time: "Submitted",
                  done: true,
                  active: false,
                },
                {
                  title: "Payment confirmation",
                  time: "UNPAID · Action Required",
                  done: false,
                  active: true,
                  isAlert: true,
                },
                {
                  title: "Restaurant preparing",
                  time: "Awaiting payment",
                  done: false,
                  active: false,
                },
                {
                  title: "Picked up by driver",
                  time: "Waiting",
                  done: false,
                  active: false,
                },
                {
                  title: "Delivered to your door",
                  time: "Est. 25 min",
                  done: false,
                  active: false,
                },
              ]
            : [
                {
                  title: "Order placed",
                  time: "Confirmed",
                  done: true,
                  active: order?.status === "PENDING",
                },
                {
                  title: "Restaurant preparing",
                  time: ["ACCEPTED", "PREPARING", "READY", "DRIVERACCEPTED", "DRIVERPICKEDUP", "ON_THE_WAY", "COMPLETE", "DELIVERED"].includes(order?.status) ? "Kitchen active" : "Pending",
                  done: ["ACCEPTED", "PREPARING", "READY", "DRIVERACCEPTED", "DRIVERPICKEDUP", "ON_THE_WAY", "COMPLETE", "DELIVERED"].includes(order?.status),
                  active: ["ACCEPTED", "PREPARING", "READY", "DRIVERACCEPTED"].includes(order?.status),
                },
                {
                  title: "Picked up",
                  time: ["DRIVERPICKEDUP", "ON_THE_WAY", "COMPLETE", "DELIVERED"].includes(order?.status) ? "With driver" : "Waiting",
                  done: ["DRIVERPICKEDUP", "ON_THE_WAY", "COMPLETE", "DELIVERED"].includes(order?.status),
                  active: false,
                },
                {
                  title: "On the way",
                  time: ["DRIVERPICKEDUP", "ON_THE_WAY"].includes(order?.status) ? "En route" : order?.status === "COMPLETE" ? "Arrived" : "Next",
                  done: ["COMPLETE", "DELIVERED"].includes(order?.status),
                  active: ["DRIVERPICKEDUP", "ON_THE_WAY"].includes(order?.status),
                },
                {
                  title: "Delivered",
                  time: ["COMPLETE", "DELIVERED"].includes(order?.status) ? "Delivered" : "Est. 25 min",
                  done: ["COMPLETE", "DELIVERED"].includes(order?.status),
                  active: ["COMPLETE", "DELIVERED"].includes(order?.status),
                },
              ]
          ).map((step, idx, arr) => (
            <View key={step.title} style={s.timelineRow}>
              {/* Connector line & check circle */}
              <View style={s.indicatorColumn}>
                <View
                  style={[
                    s.checkCircle,
                    step.done || step.active
                      ? s.checkCircleDone
                      : s.checkCirclePending,
                  ]}
                >
                  <MaterialCommunityIcons
                    name="check"
                    size={14}
                    color={step.done || step.active ? "white" : "#94A3B8"}
                  />
                </View>
                {idx < arr.length - 1 && (
                  <View
                    style={[
                      s.connectorLine,
                      step.done ? s.connectorLineDone : s.connectorLinePending,
                    ]}
                  />
                )}
              </View>

              {/* Title & Time */}
              <View style={s.stepContent}>
                <Text
                  style={[
                    s.stepTitle,
                    step.active && s.stepTitleActive,
                  ]}
                >
                  {step.title}
                </Text>
                <Text style={[s.stepTime, step.active && s.stepTimeActive]}>
                  {step.time}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* Order Details & Items Breakdown Card */}
        <View style={s.summaryCard}>
          <View style={s.summaryHeader}>
            <MaterialCommunityIcons name="file-document-outline" size={20} color={TEAL} />
            <Text style={s.summaryTitle}>Order Summary · #{String(orderId || "").slice(0, 8).toUpperCase()}</Text>
          </View>

          {/* Delivery Address */}
          <View style={s.addressBlock}>
            <MaterialCommunityIcons name="map-marker-radius-outline" size={16} color="#64748B" />
            <Text style={s.addressBlockTxt} numberOfLines={2}>
              {order?.deliveryAddress || "My Location, Ethiopia"}
            </Text>
          </View>

          {/* Price Breakdown with Strikethrough Old Price and Discounted Total */}
          {(() => {
            const subtotal = Number(order?.subtotal || order?.total || 0);
            const origSubtotal = order?.originalSubtotal && Number(order.originalSubtotal) > subtotal
              ? Number(order.originalSubtotal)
              : Math.round(subtotal * 1.25);
            const discountSavings = order?.totalDiscountAmount && Number(order.totalDiscountAmount) > 0
              ? Number(order.totalDiscountAmount)
              : Math.max(0, origSubtotal - subtotal);

            return (
              <>
                {origSubtotal > subtotal ? (
                  <View style={s.breakdownRow}>
                    <Text style={s.breakdownLabel}>Original Subtotal</Text>
                    <Text style={[s.breakdownVal, { textDecorationLine: "line-through", color: "#94A3B8" }]}>
                      {origSubtotal.toFixed(2)} ETB
                    </Text>
                  </View>
                ) : null}
                <View style={s.breakdownRow}>
                  <Text style={s.breakdownLabel}>Subtotal</Text>
                  <Text style={s.breakdownVal}>{subtotal.toFixed(2)} ETB</Text>
                </View>
                {discountSavings > 0 ? (
                  <View style={s.breakdownRow}>
                    <Text style={[s.breakdownLabel, { color: "#E11D48", fontWeight: "700" }]}>Special Deal Savings</Text>
                    <Text style={[s.breakdownVal, { color: "#E11D48", fontWeight: "700" }]}>
                      -{discountSavings.toFixed(2)} ETB
                    </Text>
                  </View>
                ) : null}
              </>
            );
          })()}

          <View style={s.breakdownRow}>
            <Text style={s.breakdownLabel}>Delivery Fee</Text>
            <Text style={s.breakdownVal}>{Number(order?.deliveryFee || 50)} ETB</Text>
          </View>
          <View style={[s.breakdownRow, s.breakdownTotal]}>
            <Text style={s.totalLabel}>Total Amount</Text>
            <Text style={s.totalVal}>{Number(order?.total || 0)} ETB</Text>
          </View>

          {/* Payment Method & Status */}
          <View style={s.paymentMethodRow}>
            <View>
              <Text style={s.paymentLabel}>Payment Method</Text>
              <Text style={s.paymentVal}>
                {order?.paymentMethod === "CHAPA" ? "Pay Online (Chapa)" : "Cash on Delivery"}
              </Text>
            </View>
            <View
              style={[
                s.payBadge,
                order?.paymentStatus === "PAID" ? s.payBadgePaid : s.payBadgePending,
              ]}
            >
              <Text
                style={[
                  s.payBadgeTxt,
                  order?.paymentStatus === "PAID" ? s.payBadgeTxtPaid : s.payBadgeTxtPending,
                ]}
              >
                {order?.paymentStatus === "PAID" ? "PAID ✓" : order?.paymentMethod === "CHAPA" ? "UNPAID" : "PAY ON DELIVERY"}
              </Text>
            </View>
          </View>

          {/* Chapa Payment Controls if unpaid */}
          {order?.paymentMethod === "CHAPA" && order?.paymentStatus !== "PAID" && order?.status !== "CANCELLED" && (
            <View style={{ marginTop: 12, gap: 10 }}>
              {/* Primary: Pay Online with Chapa */}
              <TouchableOpacity
                style={s.payOnlineBtn}
                onPress={handlePayNowWithChapa}
                disabled={payingNow}
                activeOpacity={0.85}
              >
                {payingNow ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <>
                    <MaterialCommunityIcons name="credit-card-fast-outline" size={18} color="white" style={{ marginRight: 8 }} />
                    <Text style={s.payOnlineBtnTxt}>Pay Now via Chapa (Telebirr / CBE / Card)</Text>
                  </>
                )}
              </TouchableOpacity>

              {/* Secondary: Check Chapa Status */}
              <TouchableOpacity
                style={s.verifyBtn}
                onPress={handleVerifyChapa}
                disabled={verifying}
                activeOpacity={0.85}
              >
                {verifying ? (
                  <ActivityIndicator size="small" color={TEAL} />
                ) : (
                  <>
                    <MaterialCommunityIcons name="shield-check" size={18} color={TEAL} style={{ marginRight: 6 }} />
                    <Text style={s.verifyBtnTxt}>Check Payment Status</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>

      {/* In-App Chapa Payment Sheet (WebView) */}
      <Modal
        visible={chapaModalVisible}
        animationType="slide"
        onRequestClose={() => {
          Alert.alert(
            "Leave Payment?",
            "You haven't completed this payment yet. Your order remains on hold until payment is confirmed.",
            [
              { text: "Continue Paying", style: "cancel" },
              {
                text: "Exit (Unpaid)",
                style: "destructive",
                onPress: () => {
                  setChapaModalVisible(false);
                },
              },
            ]
          );
        }}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: "#FFFFFF" }} edges={["top", "bottom"]}>
          {/* Enhanced Modal Header */}
          <View style={s.modalHeader}>
            <TouchableOpacity
              onPress={() => {
                Alert.alert(
                  "Leave Payment?",
                  "You haven't completed this payment yet. Your order remains on hold until payment is confirmed.",
                  [
                    { text: "Continue Paying", style: "cancel" },
                    {
                      text: "Exit (Unpaid)",
                      style: "destructive",
                      onPress: () => {
                        setChapaModalVisible(false);
                      },
                    },
                  ]
                );
              }}
              style={s.modalCloseBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <XMarkIcon size={20} color={DARK} />
            </TouchableOpacity>

            <View style={{ flex: 1, alignItems: "center", marginHorizontal: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <MaterialCommunityIcons name="shield-check" size={18} color={TEAL} />
                <Text style={s.modalTitle}>Chapa Secure Checkout</Text>
              </View>
              <Text style={s.modalSubtitle}>Telebirr • CBE Birr • Awash • Cards</Text>
            </View>

            <TouchableOpacity
              onPress={() => {
                if (activeCheckoutUrl) Linking.openURL(activeCheckoutUrl);
              }}
              style={s.modalBrowserPill}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel="Open checkout in external browser"
            >
              <MaterialCommunityIcons name="open-in-new" size={14} color={TEAL} />
              <Text style={s.modalBrowserPillTxt}>Browser</Text>
            </TouchableOpacity>
          </View>

          {/* Quick Guidance Strip */}
          <View style={s.checkoutHelperBanner}>
            <MaterialCommunityIcons name="shield-lock-outline" size={18} color={TEAL} />
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={s.checkoutHelperTxt}>
                Choose <Text style={{ fontWeight: "700" }}>Telebirr</Text> or <Text style={{ fontWeight: "700" }}>CBE Birr</Text>. Authorize the PIN prompt on your phone, then tap <Text style={{ fontWeight: "700", color: TEAL }}>Verify Status</Text> below.
              </Text>
            </View>
          </View>

          {activeCheckoutUrl ? (
            <WebView
              source={{ uri: activeCheckoutUrl }}
              style={{ flex: 1, backgroundColor: "#FFFFFF" }}
              containerStyle={{ flex: 1, backgroundColor: "#FFFFFF" }}
              startInLoadingState={true}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              scalesPageToFit={true}
              mixedContentMode="always"
              originWhitelist={["*"]}
              allowsInlineMediaPlayback={true}
              sharedCookiesEnabled={true}
              thirdPartyCookiesEnabled={true}
              userAgent="Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36"
              renderLoading={() => (
                <View style={[StyleSheet.absoluteFillObject, s.webviewLoading]}>
                  <ActivityIndicator size="large" color={TEAL} />
                  <Text style={s.webviewLoadingTxt}>Connecting to Chapa Payment Gateway...</Text>
                  <Text style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>Loading Telebirr / CBE checkout...</Text>
                </View>
              )}
              onError={(syntheticEvent) => {
                const { nativeEvent } = syntheticEvent;
                console.warn("WebView load error:", nativeEvent);
              }}
              onNavigationStateChange={async (navState) => {
                const url = navState.url || "";
                if (
                  url.includes("receipt") ||
                  url.includes("payment-receipt") ||
                  url.includes("status=success") ||
                  url.includes("success=true") ||
                  url.includes("payment-complete")
                ) {
                  setChapaModalVisible(false);
                  await handleVerifyChapa();
                }
              }}
            />
          ) : null}

          {/* Bottom Action Bar */}
          <View style={s.modalBottomBar}>
            <TouchableOpacity
              style={s.modalVerifyBtn}
              activeOpacity={0.88}
              disabled={verifying}
              onPress={async () => {
                await handleVerifyChapa();
              }}
            >
              {verifying ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <MaterialCommunityIcons name="shield-check" size={18} color="#FFFFFF" />
                  <Text style={s.modalVerifyBtnTxt}>I Have Paid · Verify Status</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
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
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    shadowColor: "#0B2A26",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 8,
  },
  topHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: TEAL,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  headerCenter: {
    flex: 1,
    marginLeft: 12,
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },
  headerSub: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
    marginTop: 2,
  },
  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  payOnlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ORANGE,
    paddingVertical: 13,
    borderRadius: 12,
    elevation: 3,
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  payOnlineBtnTxt: {
    color: "white",
    fontSize: 14,
    fontWeight: "800",
  },
  scrollContent: {
    backgroundColor: "#FFFFFF",
    paddingBottom: 40,
  },
  mapContainer: {
    width: "100%",
    height: 250,
    backgroundColor: "#F1F5F9",
    position: "relative",
  },
  storePin: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: TEAL,
    borderWidth: 2.5,
    borderColor: "white",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
  },
  bikeMarker: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "white",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: TEAL,
    elevation: 4,
  },
  homePin: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: ORANGE,
    borderWidth: 2.5,
    borderColor: "white",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
  },
  // Road Route Metrics
  routeMetricCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    backgroundColor: "#F8FAFC",
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  metricItem: {
    flexDirection: "row",
    alignItems: "center",
  },
  metricVal: {
    fontSize: 15,
    fontWeight: "800",
    color: DARK,
  },
  metricLbl: {
    fontSize: 11,
    color: "#64748B",
  },
  metricDivider: {
    width: 1,
    height: 28,
    backgroundColor: "#CBD5E1",
  },
  // OTP Card
  otpCard: {
    backgroundColor: "#F0FDF4",
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#BBF7D0",
  },
  otpHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  otpTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: DARK,
    marginLeft: 8,
  },
  otpDesc: {
    fontSize: 12,
    color: "#475569",
    lineHeight: 16,
  },
  otpDigitsRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 10,
    gap: 12,
  },
  otpBox: {
    width: 44,
    height: 48,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    borderWidth: 2,
    borderColor: TEAL,
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
    shadowColor: TEAL,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
  },
  otpText: {
    fontSize: 22,
    fontWeight: "900",
    color: TEAL,
  },
  // Status Pill matching Image 1
  statusPillCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EAF7F4",
    marginHorizontal: 16,
    marginTop: 16,
    padding: 14,
    borderRadius: 18,
  },
  statusPinCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: TEAL,
    alignItems: "center",
    justifyContent: "center",
  },
  statusTextWrap: {
    marginLeft: 12,
    flex: 1,
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: DARK,
  },
  statusSubtitle: {
    fontSize: 12,
    color: "#475569",
    marginTop: 2,
  },
  // Customer Info Card (Phase 3.1)
  customerCard: {
    marginHorizontal: 16,
    marginTop: 10,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E6ECEB",
    padding: 14,
  },
  customerHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
    paddingBottom: 6,
  },
  customerHeaderTitle: {
    fontSize: 12.5,
    fontWeight: "800",
    color: TEAL,
    marginLeft: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  customerDetailsBody: {
    paddingLeft: 2,
  },
  customerNameTxt: {
    fontSize: 14.5,
    fontWeight: "800",
    color: DARK,
    marginBottom: 6,
  },
  contactInfoRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  contactNonClickableTxt: {
    fontSize: 12.5,
    color: "#475569",
    marginLeft: 6,
    fontWeight: "600",
  },
  // Waiting for Driver Card
  waitingDriverCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 14,
    marginHorizontal: 16,
    marginTop: 14,
    backgroundColor: "#F0FDF4",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#BBF7D0",
  },
  waitingIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#DCFCE7",
    alignItems: "center",
    justifyContent: "center",
  },
  waitingTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: DARK,
  },
  waitingSub: {
    fontSize: 11,
    color: "#166534",
    marginTop: 2,
  },
  waitingBadge: {
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  waitingBadgeTxt: {
    fontSize: 9.5,
    fontWeight: "800",
    color: "#166534",
  },
  // Driver Card matching Image 1
  driverCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 14,
    marginHorizontal: 16,
    marginTop: 14,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E6ECEB",
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  driverAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: "#E2E8F0",
  },
  driverInfo: {
    flex: 1,
    marginLeft: 12,
  },
  driverName: {
    fontSize: 16,
    fontWeight: "900",
    color: DARK,
  },
  ratingRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#475569",
    marginLeft: 3,
  },
  contactBtnsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  phoneCallBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#E6F4F1",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  chatBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: TEAL,
    alignItems: "center",
    justifyContent: "center",
  },
  // Timeline matching Image 1
  timelineCard: {
    marginHorizontal: 16,
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  timelineRow: {
    flexDirection: "row",
    minHeight: 52,
  },
  indicatorColumn: {
    width: 32,
    alignItems: "center",
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  checkCircleDone: {
    backgroundColor: TEAL,
  },
  checkCirclePending: {
    backgroundColor: "#E2E8F0",
  },
  connectorLine: {
    width: 2.5,
    flex: 1,
    marginVertical: -2,
    zIndex: 1,
  },
  connectorLineDone: {
    backgroundColor: TEAL,
  },
  connectorLinePending: {
    backgroundColor: "#E2E8F0",
  },
  stepContent: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingLeft: 12,
    paddingTop: 1,
  },
  stepTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#64748B",
  },
  stepTitleActive: {
    fontSize: 15,
    fontWeight: "900",
    color: TEAL,
  },
  stepTime: {
    fontSize: 13,
    color: "#94A3B8",
    fontWeight: "600",
  },
  stepTimeActive: {
    fontSize: 14,
    fontWeight: "900",
    color: TEAL,
  },
  summaryCard: {
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 20,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E6ECEB",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  summaryTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: DARK,
    marginLeft: 8,
  },
  addressBlock: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#F8FAFC",
    padding: 10,
    borderRadius: 12,
    marginBottom: 12,
  },
  addressBlockTxt: {
    fontSize: 12,
    color: "#475569",
    marginLeft: 6,
    flex: 1,
  },
  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
  },
  breakdownLabel: {
    fontSize: 13,
    color: "#64748B",
  },
  breakdownVal: {
    fontSize: 13,
    fontWeight: "600",
    color: DARK,
  },
  breakdownTotal: {
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
    marginTop: 8,
    paddingTop: 8,
  },
  totalLabel: {
    fontSize: 15,
    fontWeight: "800",
    color: DARK,
  },
  totalVal: {
    fontSize: 16,
    fontWeight: "900",
    color: TEAL,
  },
  paymentMethodRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  paymentLabel: {
    fontSize: 11,
    color: "#94A3B8",
  },
  paymentVal: {
    fontSize: 13,
    fontWeight: "700",
    color: DARK,
    marginTop: 2,
  },
  payBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  payBadgePaid: {
    backgroundColor: "#DCFCE7",
  },
  payBadgePending: {
    backgroundColor: "#FEF3C7",
  },
  payBadgeTxt: {
    fontSize: 10,
    fontWeight: "800",
  },
  payBadgeTxtPaid: {
    color: "#15803D",
  },
  payBadgeTxtPending: {
    color: "#B45309",
  },
  verifyBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F0FDF9",
    borderWidth: 1.5,
    borderColor: TEAL,
    paddingVertical: 11,
    borderRadius: 12,
  },
  verifyBtnTxt: {
    color: TEAL,
    fontSize: 13.5,
    fontWeight: "800",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    backgroundColor: "#FFFFFF",
  },
  modalCloseBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: DARK,
  },
  modalSubtitle: {
    fontSize: 11,
    fontWeight: "600",
    color: "#64748B",
    marginTop: 2,
  },
  modalBrowserBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#E6F7F1",
    alignItems: "center",
    justifyContent: "center",
  },
  webviewLoading: {
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
  },
  webviewLoadingTxt: {
    marginTop: 12,
    fontSize: 13,
    color: "#64748B",
    fontWeight: "600",
  },
  unpaidOrderBanner: {
    flexDirection: "row",
    backgroundColor: "#FFFBEB",
    borderWidth: 1.5,
    borderColor: "#FDE68A",
    borderRadius: 16,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 14,
    elevation: 2,
  },
  unpaidIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FEF3C7",
    alignItems: "center",
    justifyContent: "center",
  },
  unpaidBannerTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#92400E",
  },
  unpaidBannerSub: {
    fontSize: 11.5,
    color: "#B45309",
    marginTop: 3,
    lineHeight: 16,
  },
  unpaidActionPay: {
    backgroundColor: ORANGE,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  unpaidActionPayTxt: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  unpaidActionCheck: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D97706",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  unpaidActionCheckTxt: {
    color: "#92400E",
    fontSize: 12,
    fontWeight: "700",
  },
  modalBrowserPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#E6F7F1",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 4,
  },
  modalBrowserPillTxt: {
    fontSize: 11.5,
    fontWeight: "700",
    color: TEAL,
  },
  checkoutHelperBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F0FDF9",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#CCFBF1",
    gap: 8,
  },
  checkoutHelperTxt: {
    fontSize: 11,
    color: "#0F766E",
    fontWeight: "600",
    flex: 1,
    lineHeight: 15,
  },
  modalBottomBar: {
    padding: 12,
    backgroundColor: "#FFFFFF",
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
  },
  modalVerifyBtn: {
    backgroundColor: TEAL,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
  },
  modalVerifyBtnTxt: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
});
