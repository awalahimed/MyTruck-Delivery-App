import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import BackButton from "../components/ui/BackButton";
import NotificationPreferencesModal from "../components/NotificationPreferencesModal";
import { useNotifications } from "../contexts/NotificationContext";

const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";

const FILTER_TABS = [
  { id: "ALL", label: "All" },
  { id: "UNREAD", label: "Unread" },
  { id: "ORDER", label: "Orders" },
  { id: "DELIVERY", label: "Deliveries" },
  { id: "SYSTEM", label: "System" },
];

function formatFullDateTime(timestamp) {
  if (!timestamp) return "Just now";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp.seconds ? timestamp.seconds * 1000 : timestamp);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return "Just now";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp.seconds ? timestamp.seconds * 1000 : timestamp);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return "Just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 172800) return "Yesterday";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getDateGroupKey(timestamp) {
  if (!timestamp) return "Earlier";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp.seconds ? timestamp.seconds * 1000 : timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date >= today) return "Today";
  if (date >= yesterday) return "Yesterday";
  return "Earlier";
}

function getCategoryIcon(category, type) {
  if (category === "ORDER" || type?.startsWith?.("ORDER")) {
    return { name: "silverware-fork-knife", color: "#F59E0B", bg: "#FEF3C7" };
  }
  if (category === "DELIVERY" || type?.startsWith?.("DRIVER")) {
    return { name: "moped", color: TEAL, bg: "#E6F7F1" };
  }
  if (category === "ADMIN") {
    return { name: "bullhorn-outline", color: "#8B5CF6", bg: "#EDE9FE" };
  }
  if (category === "ACCOUNT") {
    return { name: "account-check-outline", color: "#3B82F6", bg: "#DBEAFE" };
  }
  return { name: "bell-outline", color: TEAL, bg: "#E6F7F1" };
}

export default function NotificationCenterScreen() {
  const {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    triggerTestNotification,
    handleNotificationDeepLink,
  } = useNotifications();

  const [activeFilter, setActiveFilter] = useState("ALL");
  const [prefsModalVisible, setPrefsModalVisible] = useState(false);
  const [selectedDetailItem, setSelectedDetailItem] = useState(null);
  const [testing, setTesting] = useState(false);

  // Filter notifications by selected tab
  const filteredList = useMemo(() => {
    return notifications.filter((item) => {
      if (activeFilter === "ALL") return true;
      if (activeFilter === "UNREAD") return item.isRead !== true;
      if (activeFilter === "ORDER") return item.category === "ORDER" || item.type?.startsWith("ORDER");
      if (activeFilter === "DELIVERY") return item.category === "DELIVERY" || item.type?.startsWith("DRIVER");
      if (activeFilter === "SYSTEM") return item.category === "SYSTEM" || item.category === "ADMIN" || item.category === "ACCOUNT";
      return true;
    });
  }, [notifications, activeFilter]);

  // Group notifications by date (Today, Yesterday, Earlier)
  const groupedSections = useMemo(() => {
    const groups = { Today: [], Yesterday: [], Earlier: [] };
    filteredList.forEach((item) => {
      const groupKey = getDateGroupKey(item.createdAt);
      if (groups[groupKey]) {
        groups[groupKey].push(item);
      } else {
        groups.Earlier.push(item);
      }
    });
    return [
      { title: "Today", data: groups.Today },
      { title: "Yesterday", data: groups.Yesterday },
      { title: "Earlier", data: groups.Earlier },
    ].filter((section) => section.data.length > 0);
  }, [filteredList]);

  const handleCardPress = (item) => {
    if (item.isRead !== true) {
      markAsRead(item.id);
    }
    setSelectedDetailItem(item);
  };

  const handleModalAction = () => {
    if (selectedDetailItem?.data) {
      const data = selectedDetailItem.data;
      setSelectedDetailItem(null);
      handleNotificationDeepLink(data);
    }
  };

  const handleSendTest = async () => {
    setTesting(true);
    await triggerTestNotification();
    setTesting(false);
  };

  return (
    <SafeAreaView style={s.container} edges={["top", "bottom"]}>
      <StatusBar style="dark" />

      {/* Header Bar */}
      <View style={s.header}>
        <BackButton fallbackRoute="HomeTab" />
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>Notifications</Text>
          {unreadCount > 0 && (
            <View style={s.headerBadge}>
              <Text style={s.headerBadgeText}>{unreadCount} new</Text>
            </View>
          )}
        </View>
        <TouchableOpacity
          style={s.settingsBtn}
          onPress={() => setPrefsModalVisible(true)}
          accessibilityLabel="Notification settings"
        >
          <MaterialCommunityIcons name="cog-outline" size={24} color={DARK} />
        </TouchableOpacity>
      </View>

      {/* Action Sub-bar */}
      <View style={s.subBar}>
        <TouchableOpacity
          style={s.markAllBtn}
          onPress={markAllAsRead}
          disabled={unreadCount === 0}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons
            name="check-all"
            size={18}
            color={unreadCount > 0 ? TEAL : "#94A3B8"}
          />
          <Text
            style={[
              s.markAllTxt,
              { color: unreadCount > 0 ? TEAL : "#94A3B8" },
            ]}
          >
            Mark all as read
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={s.testBtn}
          onPress={handleSendTest}
          disabled={testing}
          activeOpacity={0.7}
        >
          {testing ? (
            <ActivityIndicator size="small" color={TEAL} />
          ) : (
            <>
              <MaterialCommunityIcons name="bell-ring-outline" size={16} color={TEAL} />
              <Text style={s.testBtnTxt}>Test Alert</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Filter Tabs */}
      <View style={s.tabsWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabsScroll}>
          {FILTER_TABS.map((tab) => {
            const active = activeFilter === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                style={[s.tabPill, active && s.tabPillActive]}
                onPress={() => setActiveFilter(tab.id)}
                activeOpacity={0.8}
              >
                <Text style={[s.tabTxt, active && s.tabTxtActive]}>{tab.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Notifications List */}
      {loading ? (
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={TEAL} />
          <Text style={s.loadingTxt}>Loading notifications...</Text>
        </View>
      ) : filteredList.length === 0 ? (
        <View style={s.emptyWrap}>
          <View style={s.emptyIconWrap}>
            <MaterialCommunityIcons name="bell-sleep-outline" size={48} color={TEAL} />
          </View>
          <Text style={s.emptyTitle}>No Notifications</Text>
          <Text style={s.emptySub}>
            {activeFilter === "UNREAD"
              ? "You're all caught up! No unread notifications."
              : "You'll see order updates, deliveries, and announcements here."}
          </Text>
        </View>
      ) : (
        <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
          {groupedSections.map((section) => (
            <View key={section.title} style={s.sectionWrap}>
              <Text style={s.sectionTitle}>{section.title}</Text>
              {section.data.map((item) => {
                const iconMeta = getCategoryIcon(item.category, item.type);
                const isUnread = item.isRead !== true;

                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[s.card, isUnread && s.cardUnread]}
                    onPress={() => handleCardPress(item)}
                    activeOpacity={0.85}
                  >
                    {/* Icon */}
                    <View style={[s.cardIcon, { backgroundColor: iconMeta.bg }]}>
                      <MaterialCommunityIcons
                        name={iconMeta.name}
                        size={22}
                        color={iconMeta.color}
                      />
                    </View>

                    {/* Content */}
                    <View style={s.cardContent}>
                      <View style={s.cardTopRow}>
                        <Text style={[s.cardTitle, isUnread && s.cardTitleBold]} numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Text style={s.cardTime}>{formatRelativeTime(item.createdAt)}</Text>
                      </View>

                      <Text style={s.cardBody} numberOfLines={2}>
                        {item.body}
                      </Text>

                      {/* Action Pill if deep-linkable */}
                      {item.data && (item.data.orderId || item.data.targetRoute) && (
                        <View style={s.linkPill}>
                          <Text style={s.linkPillText}>Tap to view details</Text>
                          <MaterialCommunityIcons name="chevron-right" size={14} color={TEAL} />
                        </View>
                      )}
                    </View>

                    {/* Right column: unread dot & delete */}
                    <View style={s.cardRightCol}>
                      {isUnread && <View style={s.unreadDot} />}
                      <TouchableOpacity
                        style={s.deleteBtn}
                        onPress={() => deleteNotification(item.id)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <MaterialCommunityIcons name="close" size={16} color="#CBD5E1" />
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

            {/* Premium Notification Detail Modal */}
      {selectedDetailItem && (
        <Modal
          visible={Boolean(selectedDetailItem)}
          transparent
          animationType="slide"
          onRequestClose={() => setSelectedDetailItem(null)}
        >
          <View style={s.detailModalOverlay}>
            <View style={s.detailModalCard}>
              {/* Header */}
              <View style={s.detailModalHeader}>
                <View style={s.detailBadgeWrap}>
                  <View style={[s.detailCategoryBadge, { backgroundColor: getCategoryIcon(selectedDetailItem.category, selectedDetailItem.type).bg }]}>
                    <Text style={[s.detailCategoryTxt, { color: getCategoryIcon(selectedDetailItem.category, selectedDetailItem.type).color }]}>
                      {(selectedDetailItem.category || "SYSTEM").toUpperCase()}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => setSelectedDetailItem(null)}
                  style={s.detailCloseBtn}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <MaterialCommunityIcons name="close" size={22} color="#64748B" />
                </TouchableOpacity>
              </View>

              {/* Icon & Title */}
              <View style={s.detailIconRow}>
                <View style={[s.detailIconCircle, { backgroundColor: getCategoryIcon(selectedDetailItem.category, selectedDetailItem.type).bg }]}>
                  <MaterialCommunityIcons
                    name={getCategoryIcon(selectedDetailItem.category, selectedDetailItem.type).name}
                    size={30}
                    color={getCategoryIcon(selectedDetailItem.category, selectedDetailItem.type).color}
                  />
                </View>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={s.detailModalTitle}>{selectedDetailItem.title}</Text>
                  <Text style={s.detailModalTime}>{formatFullDateTime(selectedDetailItem.createdAt)}</Text>
                </View>
              </View>

              {/* Message Body */}
              <ScrollView style={s.detailBodyScroll} contentContainerStyle={{ paddingVertical: 12 }}>
                <Text style={s.detailModalBodyText}>{selectedDetailItem.body}</Text>

                {/* Metadata card if order linked */}
                {selectedDetailItem.data?.orderId && (
                  <View style={s.detailMetaBox}>
                    <MaterialCommunityIcons name="receipt" size={18} color={TEAL} />
                    <Text style={s.detailMetaTxt}>
                      Related Order: #{String(selectedDetailItem.data.orderId).slice(-8).toUpperCase()}
                    </Text>
                  </View>
                )}
              </ScrollView>

              {/* Action Buttons */}
              <View style={s.detailActionsRow}>
                {selectedDetailItem.data && (selectedDetailItem.data.orderId || selectedDetailItem.data.targetRoute) ? (
                  <TouchableOpacity
                    style={s.detailActionCta}
                    onPress={handleModalAction}
                    activeOpacity={0.88}
                  >
                    <MaterialCommunityIcons name="arrow-right-circle" size={18} color="white" style={{ marginRight: 6 }} />
                    <Text style={s.detailActionCtaTxt}>View Details</Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  style={[s.detailDismissBtn, !(selectedDetailItem.data?.orderId || selectedDetailItem.data?.targetRoute) && { flex: 1 }]}
                  onPress={() => setSelectedDetailItem(null)}
                  activeOpacity={0.8}
                >
                  <Text style={s.detailDismissBtnTxt}>Dismiss</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Preferences Modal */}
      <NotificationPreferencesModal
        visible={prefsModalVisible}
        onClose={() => setPrefsModalVisible(false)}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  headerCenter: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: DARK,
  },
  headerBadge: {
    backgroundColor: "#CCFBF1",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    marginLeft: 8,
  },
  headerBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: TEAL,
  },
  settingsBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  subBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  markAllBtn: {
    flexDirection: "row",
    alignItems: "center",
  },
  markAllTxt: {
    fontSize: 13,
    fontWeight: "600",
    marginLeft: 6,
  },
  testBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F0FDF4",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#CCFBF1",
  },
  testBtnTxt: {
    fontSize: 12,
    fontWeight: "700",
    color: TEAL,
    marginLeft: 4,
  },
  tabsWrap: {
    backgroundColor: "#FFFFFF",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  tabsScroll: {
    paddingHorizontal: 16,
  },
  tabPill: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: "#F1F5F9",
    marginRight: 8,
  },
  tabPillActive: {
    backgroundColor: TEAL,
  },
  tabTxt: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748B",
  },
  tabTxtActive: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingTxt: {
    fontSize: 14,
    color: "#64748B",
    marginTop: 10,
    fontWeight: "500",
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#E6F7F1",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: DARK,
  },
  emptySub: {
    fontSize: 14,
    color: "#64748B",
    textAlign: "center",
    marginTop: 6,
    lineHeight: 20,
  },
  scroll: {
    flex: 1,
  },
  sectionWrap: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#94A3B8",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 10,
  },
  card: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  cardUnread: {
    backgroundColor: "#FAFEFD",
    borderColor: "#A7F3D0",
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  cardContent: {
    flex: 1,
  },
  cardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: DARK,
    flex: 1,
    marginRight: 6,
  },
  cardTitleBold: {
    fontWeight: "800",
  },
  cardTime: {
    fontSize: 11,
    color: "#94A3B8",
    fontWeight: "500",
  },
  cardBody: {
    fontSize: 13,
    color: "#475569",
    lineHeight: 18,
  },
  linkPill: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    alignSelf: "flex-start",
    backgroundColor: "#F0FDF4",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  linkPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: TEAL,
  },
  cardRightCol: {
    alignItems: "center",
    justifyContent: "space-between",
    marginLeft: 6,
    paddingVertical: 2,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: TEAL,
  },
  deleteBtn: {
    padding: 2,
  },
  detailModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(11, 42, 38, 0.55)",
    justifyContent: "flex-end",
  },
  detailModalCard: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 34,
    maxHeight: "78%",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  detailModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  detailBadgeWrap: {
    flexDirection: "row",
    alignItems: "center",
  },
  detailCategoryBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  detailCategoryTxt: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  detailCloseBtn: {
    padding: 4,
  },
  detailIconRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  detailIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  detailModalTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: DARK,
    lineHeight: 22,
  },
  detailModalTime: {
    fontSize: 12,
    color: "#94A3B8",
    marginTop: 3,
    fontWeight: "500",
  },
  detailBodyScroll: {
    maxHeight: 220,
    marginVertical: 4,
  },
  detailModalBodyText: {
    fontSize: 14.5,
    color: "#334155",
    lineHeight: 22,
  },
  detailMetaBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    padding: 10,
    borderRadius: 10,
    marginTop: 12,
  },
  detailMetaTxt: {
    fontSize: 12.5,
    fontWeight: "700",
    color: DARK,
    marginLeft: 8,
  },
  detailActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 18,
    gap: 10,
  },
  detailActionCta: {
    flex: 1.6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: TEAL,
    paddingVertical: 13,
    borderRadius: 14,
  },
  detailActionCtaTxt: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  detailDismissBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F1F5F9",
    paddingVertical: 13,
    borderRadius: 14,
  },
  detailDismissBtnTxt: {
    color: "#64748B",
    fontSize: 14,
    fontWeight: "700",
  },
});
