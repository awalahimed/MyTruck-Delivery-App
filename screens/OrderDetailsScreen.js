import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useNavigation } from "@react-navigation/native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { ChevronRightIcon } from "react-native-heroicons/outline";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { UserAuth } from "../contexts/AuthContext";
import BackButton from "../components/ui/BackButton";

const { width } = Dimensions.get("window");
const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";
const BG = "#F5FAF9";

const FILTER_TABS = ["All", "Active", "Completed", "Cancelled"];

export default function OrderDetailsScreen() {
  const { user } = UserAuth();
  const navigation = useNavigation();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 5;

  useEffect(() => {
    if (!user?.uid) {
      setOrders([]);
      setLoading(false);
      return undefined;
    }

    const q = query(
      collection(db, "orders"),
      where("userId", "==", user.uid)
    );

    const unsubscribe = onSnapshot(
      q,
      (querySnapshot) => {
        const items = [];
        querySnapshot.forEach((doc) => items.push({ id: doc.id, ...doc.data() }));
        items.sort((a, b) => {
          const tA = a.createdAt?.toMillis
            ? a.createdAt.toMillis()
            : a.createdAt?.seconds
            ? a.createdAt.seconds * 1000
            : 0;
          const tB = b.createdAt?.toMillis
            ? b.createdAt.toMillis()
            : b.createdAt?.seconds
            ? b.createdAt.seconds * 1000
            : 0;
          return tB - tA;
        });
        setOrders(items);
        setLoading(false);
        setLoadError(false);
      },
      (error) => {
        console.error("OrderDetailsScreen: could not load orders", error);
        setLoadError(true);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [user?.uid]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  const handleOpenOrder = (orderId) => {
    if (!orderId) return;
    navigation.navigate("TrackOrder", { orderId, id: orderId });
  };

  const filteredOrders = useMemo(() => {
    let result = orders;
    if (activeFilter === "Active") {
      result = orders.filter((o) =>
        ["PENDING", "ACCEPTED", "PREPARING", "READY", "DRIVERPICKEDUP"].includes(
          String(o.status || "").toUpperCase()
        )
      );
    } else if (activeFilter === "Completed") {
      result = orders.filter(
        (o) => String(o.status || "").toUpperCase() === "COMPLETE"
      );
    } else if (activeFilter === "Cancelled") {
      result = orders.filter(
        (o) => String(o.status || "").toUpperCase() === "CANCELLED"
      );
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (o) =>
          o.id?.toLowerCase().includes(q) ||
          o.orderId?.toLowerCase().includes(q) ||
          o.restaurantName?.toLowerCase().includes(q) ||
          o.deliveryAddress?.toLowerCase().includes(q)
      );
    }

    return result;
  }, [orders, activeFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredOrders.slice(start, start + PAGE_SIZE);
  }, [filteredOrders, currentPage]);

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const getStatusBadge = (status) => {
    const s = String(status || "PENDING").toUpperCase();
    if (s === "COMPLETE") {
      return { label: "Delivered", bg: "#DCFCE7", fg: "#15803D", icon: "check-circle" };
    }
    if (s === "DRIVERPICKEDUP") {
      return { label: "On the way", bg: "#E0F2FE", fg: "#0369A1", icon: "bike-fast" };
    }
    if (s === "PREPARING") {
      return { label: "Preparing", bg: "#FEF3C7", fg: "#B45309", icon: "chef-hat" };
    }
    if (s === "CANCELLED") {
      return { label: "Cancelled", bg: "#FEE2E2", fg: "#B91C1C", icon: "close-circle" };
    }
    return { label: "Order Placed", bg: "#F1F5F9", fg: "#475569", icon: "receipt" };
  };

  const formatOrderDate = (createdAt) => {
    if (!createdAt) return "Recent";
    const date = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <StatusBar style="light" backgroundColor={TEAL} />

      {/* Header */}
      <View style={s.header}>
        <BackButton fallbackRoute="HomeTab" iconColor="white" />
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>My Orders</Text>
          <Text style={s.headerSub}>{orders.length} total orders placed</Text>
        </View>
        <TouchableOpacity
          style={s.browseBtn}
          onPress={() => navigation.navigate("Restaurants")}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons name="silverware-fork-knife" size={20} color="white" />
        </TouchableOpacity>
      </View>

      {/* Search Bar (Phase 5) */}
      <View style={s.searchBarWrap}>
        <MaterialCommunityIcons name="magnify" size={20} color="#64748B" />
        <TextInput
          style={s.searchBarInput}
          placeholder="Search by order #, restaurant or store..."
          placeholderTextColor="#94A3B8"
          value={searchQuery}
          onChangeText={(t) => {
            setSearchQuery(t);
            setCurrentPage(1);
          }}
        />
        {searchQuery ? (
          <TouchableOpacity onPress={() => setSearchQuery("")}>
            <MaterialCommunityIcons name="close-circle" size={16} color="#94A3B8" />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Filter Tabs */}
      <View style={s.filterRow}>
        {FILTER_TABS.map((tab) => {
          const active = activeFilter === tab;
          return (
            <TouchableOpacity
              key={tab}
              style={[s.filterTab, active && s.filterTabActive]}
              onPress={() => setActiveFilter(tab)}
              activeOpacity={0.8}
            >
              <Text style={[s.filterTabTxt, active && s.filterTabTxtActive]}>
                {tab}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={TEAL} />
        }
      >
        {loading && (
          <View style={s.centerBox}>
            <ActivityIndicator size="large" color={TEAL} />
            <Text style={s.loadingTxt}>Retrieving your order history…</Text>
          </View>
        )}

        {loadError && (
          <View style={s.centerBox}>
            <MaterialCommunityIcons name="wifi-off" size={48} color="#CBD5E1" />
            <Text style={s.errorTitle}>Could not load orders</Text>
            <Text style={s.errorSub}>Please check your connection and pull down to retry.</Text>
          </View>
        )}

        {!loading && !loadError && filteredOrders.length === 0 && (
          <View style={s.emptyBox}>
            <MaterialCommunityIcons name="receipt-text-outline" size={64} color="#CBD5E1" />
            <Text style={s.emptyTitle}>No {activeFilter !== "All" ? activeFilter.toLowerCase() : ""} orders</Text>
            <Text style={s.emptySub}>
              {activeFilter === "All"
                ? "Your active and past delivery orders will appear here."
                : `You don't have any ${activeFilter.toLowerCase()} orders right now.`}
            </Text>
            <TouchableOpacity
              style={s.exploreBtn}
              onPress={() => navigation.navigate("Restaurants")}
              activeOpacity={0.85}
            >
              <Text style={s.exploreBtnTxt}>Explore Restaurants</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && !loadError && filteredOrders.length > 0 && (
          <View style={s.ordersList}>
            {paginatedOrders.map((order) => {
              const statusBadge = getStatusBadge(order.status);
              const itemCount = Array.isArray(order.items)
                ? order.items.reduce((s, i) => s + Number(i.quantity || 1), 0)
                : 1;

              return (
                <TouchableOpacity
                  key={order.id}
                  style={s.orderCard}
                  activeOpacity={0.9}
                  onPress={() => handleOpenOrder(order.id)}
                >
                  {/* Card Header */}
                  <View style={s.orderTopRow}>
                    <View style={s.storeInfoRow}>
                      <View style={s.storeIconCircle}>
                        <MaterialCommunityIcons
                          name={order.sellerType === "shop" ? "storefront" : "silverware-fork-knife"}
                          size={18}
                          color={TEAL}
                        />
                      </View>
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={s.storeName} numberOfLines={1}>
                          {order.restaurantName || order.shopName || "MyTruck Partner"}
                        </Text>
                        <Text style={s.orderDate}>
                          {formatOrderDate(order.createdAt)} · #{String(order.id).slice(0, 8).toUpperCase()}
                        </Text>
                      </View>
                    </View>

                    {/* Status badge */}
                    <View style={[s.statusBadge, { backgroundColor: statusBadge.bg }]}>
                      <MaterialCommunityIcons name={statusBadge.icon} size={13} color={statusBadge.fg} style={{ marginRight: 3 }} />
                      <Text style={[s.statusBadgeTxt, { color: statusBadge.fg }]}>
                        {statusBadge.label}
                      </Text>
                    </View>
                  </View>

                  {/* Summary divider */}
                  <View style={s.cardDivider} />

                  {/* Card Middle: items, payment, and total */}
                  <View style={s.orderMidRow}>
                    <View>
                      <Text style={s.itemsCountTxt}>
                        {itemCount} {itemCount === 1 ? "item" : "items"}
                      </Text>
                      <Text style={s.paymentInfoTxt}>
                        {order.paymentMethod === "CHAPA"
                          ? (order.paymentStatus === "PAID" ? "Paid Online (Chapa)" : "Pay Online (Chapa)")
                          : "Cash on Delivery"}
                        {order.paymentStatus === "PAID" ? (
                          <Text style={{ color: "#16A34A", fontWeight: "700" }}> · Paid ✓</Text>
                        ) : order.paymentMethod === "CHAPA" ? (
                          <Text style={{ color: "#DC2626", fontWeight: "700" }}> · UNPAID</Text>
                        ) : null}
                      </Text>
                    </View>

                    <View style={{ alignItems: "flex-end" }}>
                      {order.originalTotal && Number(order.originalTotal) > Number(order.total) ? (
                        <Text style={{ fontSize: 11, color: "#94A3B8", textDecorationLine: "line-through" }}>
                          {Number(order.originalTotal)} ETB
                        </Text>
                      ) : (
                        <Text style={{ fontSize: 11, color: "#94A3B8", textDecorationLine: "line-through" }}>
                          {Math.round(Number(order.total || 0) * 1.25)} ETB
                        </Text>
                      )}
                      <Text style={s.totalAmount}>
                        {Number(order.total || 0)} ETB
                      </Text>
                      <View style={{ backgroundColor: "#FEE2E2", paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3, marginTop: 2 }}>
                        <Text style={{ fontSize: 9.5, fontWeight: "800", color: "#E11D48" }}>
                          20% OFF Deal
                        </Text>
                      </View>
                    </View>

                  </View>

                  {/* Card Action Footer with explicit 'View Details' button */}
                  <View style={s.cardFooter}>
                    <View style={s.deliveryDestRow}>
                      <MaterialCommunityIcons name="map-marker-outline" size={14} color="#64748B" />
                      <Text style={s.deliveryDestTxt} numberOfLines={1}>
                        {order.deliveryAddress || "Addis Ababa"}
                      </Text>
                    </View>

                    <TouchableOpacity
                      style={s.viewDetailsBtn}
                      onPress={() => handleOpenOrder(order.id)}
                      activeOpacity={0.85}
                    >
                      <Text style={s.viewDetailsTxt}>View Details</Text>
                      <ChevronRightIcon size={14} color={TEAL} style={{ marginLeft: 3 }} />
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              );
            })}

            {/* Pagination Controls (Phase 5) */}
            {totalPages > 1 && (
              <View style={s.paginationRow}>
                <TouchableOpacity
                  style={[s.pageBtn, currentPage === 1 && s.pageBtnDisabled]}
                  onPress={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                >
                  <MaterialCommunityIcons name="chevron-left" size={18} color={currentPage === 1 ? "#94A3B8" : DARK} />
                  <Text style={[s.pageBtnTxt, currentPage === 1 && { color: "#94A3B8" }]}>Prev</Text>
                </TouchableOpacity>

                <Text style={s.pageIndicatorTxt}>
                  Page {currentPage} of {totalPages}
                </Text>

                <TouchableOpacity
                  style={[s.pageBtn, currentPage === totalPages && s.pageBtnDisabled]}
                  onPress={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                >
                  <Text style={[s.pageBtnTxt, currentPage === totalPages && { color: "#94A3B8" }]}>Next</Text>
                  <MaterialCommunityIcons name="chevron-right" size={18} color={currentPage === totalPages ? "#94A3B8" : DARK} />
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
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
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: TEAL,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
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
    color: "#CCFBF1",
    marginTop: 1,
  },
  browseBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  searchBarWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 6,
    paddingHorizontal: 12,
    height: 42,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  searchBarInput: {
    flex: 1,
    marginLeft: 8,
    fontSize: 13,
    color: DARK,
  },
  filterRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "white",
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  filterTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#F1F5F9",
    marginRight: 8,
  },
  filterTabActive: {
    backgroundColor: TEAL,
  },
  filterTabTxt: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
  },
  filterTabTxtActive: {
    color: "white",
    fontWeight: "700",
  },
  scroll: {
    flex: 1,
    backgroundColor: BG,
  },
  scrollContent: {
    paddingBottom: 40,
    flexGrow: 1,
  },
  ordersList: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  orderCard: {
    backgroundColor: "white",
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  orderTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  storeInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 8,
  },
  storeIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F0FDF4",
    alignItems: "center",
    justifyContent: "center",
  },
  storeName: {
    fontSize: 14,
    fontWeight: "800",
    color: DARK,
  },
  orderDate: {
    fontSize: 11,
    color: "#94A3B8",
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusBadgeTxt: {
    fontSize: 11,
    fontWeight: "700",
  },
  cardDivider: {
    height: 1,
    backgroundColor: "#F1F5F9",
    marginVertical: 10,
  },
  orderMidRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  itemsCountTxt: {
    fontSize: 13,
    fontWeight: "600",
    color: DARK,
  },
  paymentInfoTxt: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
  totalAmount: {
    fontSize: 16,
    fontWeight: "800",
    color: TEAL,
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#F8FAFC",
  },
  deliveryDestRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 10,
  },
  deliveryDestTxt: {
    fontSize: 11,
    color: "#64748B",
    marginLeft: 4,
  },
  viewDetailsBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F0FDF4",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#CCFBF1",
  },
  viewDetailsTxt: {
    fontSize: 12,
    fontWeight: "700",
    color: TEAL,
  },
  centerBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
  },
  loadingTxt: {
    color: "#64748B",
    marginTop: 10,
    fontSize: 13,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: DARK,
    marginTop: 12,
  },
  errorSub: {
    fontSize: 12,
    color: "#94A3B8",
    marginTop: 4,
  },
  emptyBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: DARK,
    marginTop: 12,
  },
  emptySub: {
    fontSize: 13,
    color: "#94A3B8",
    textAlign: "center",
    marginTop: 6,
    lineHeight: 18,
  },
  exploreBtn: {
    backgroundColor: TEAL,
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 14,
    marginTop: 20,
  },
  exploreBtnTxt: {
    color: "white",
    fontSize: 14,
    fontWeight: "700",
  },
  paginationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 8,
    marginTop: 6,
  },
  pageBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  pageBtnDisabled: {
    opacity: 0.45,
  },
  pageBtnTxt: {
    fontSize: 12.5,
    fontWeight: "700",
    color: DARK,
  },
  pageIndicatorTxt: {
    fontSize: 12.5,
    fontWeight: "700",
    color: "#64748B",
  },
});
