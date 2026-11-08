import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  Platform,
  Switch,
  Modal,
  TextInput,
  Linking,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ChevronRightIcon,
  PencilSquareIcon,
  ShieldCheckIcon,
  MapPinIcon,
  ShoppingBagIcon,
  CreditCardIcon,
  BellIcon,
  LockClosedIcon,
  QuestionMarkCircleIcon,
  InformationCircleIcon,
  ArrowRightOnRectangleIcon,
  UserCircleIcon,
  XMarkIcon,
  PhoneIcon,
  EnvelopeIcon,
} from "react-native-heroicons/outline";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useNavigation } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { UserAuth } from "../contexts/AuthContext";
import { auth, db } from "../firebase";
import { doc, onSnapshot } from "firebase/firestore";
import { sendPasswordResetEmail } from "firebase/auth";
import BackButton from "../components/ui/BackButton";
import NotificationBell from "../components/ui/NotificationBell";
import {
  checkBiometricSupport,
  isBiometricEnabled,
  saveBiometricCredentials,
  disableBiometrics,
  getSavedBiometricAccount,
} from "../services/biometricService";

const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";

// Maps all possible Firestore roles to clean labels, icons and badge styling
const ROLE_CONFIG = {
  superadmin: {
    label: "Super Admin",
    badgeBg: "#FEF2F2",
    badgeBorder: "#FCA5A5",
    badgeText: "#B91C1C",
    icon: "shield-crown",
  },
  admin: {
    label: "Super Admin",
    badgeBg: "#FEF2F2",
    badgeBorder: "#FCA5A5",
    badgeText: "#B91C1C",
    icon: "shield-check",
  },
  mini_admin: {
    label: "Mini Admin",
    badgeBg: "#F0FDFA",
    badgeBorder: "#99F6E4",
    badgeText: "#0F766E",
    icon: "shield-account",
  },
  miniadmin: {
    label: "Mini Admin",
    badgeBg: "#F0FDFA",
    badgeBorder: "#99F6E4",
    badgeText: "#0F766E",
    icon: "shield-account",
  },
  restaurant: {
    label: "Restaurant Manager",
    badgeBg: "#FFF7ED",
    badgeBorder: "#FDBA74",
    badgeText: "#C2410C",
    icon: "storefront",
  },
  shop: {
    label: "Shop Manager",
    badgeBg: "#F5F3FF",
    badgeBorder: "#C4B5FD",
    badgeText: "#6D28D9",
    icon: "shopping",
  },
  pendingSeller: {
    label: "Merchant (Pending)",
    badgeBg: "#FEFCE8",
    badgeBorder: "#FDE047",
    badgeText: "#A16207",
    icon: "clock-outline",
  },
  driver: {
    label: "Driver",
    badgeBg: "#F0FDF4",
    badgeBorder: "#86EFAC",
    badgeText: "#15803D",
    icon: "motorbike",
  },
  customer: {
    label: "Customer",
    badgeBg: "#E6F4F1",
    badgeBorder: "#99DCD0",
    badgeText: TEAL,
    icon: "account",
  },
};

export default function OptionsScreen() {
  const navigation = useNavigation();
  const { user, dbUser, signOutUser } = UserAuth();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [showPaymentsModal, setShowPaymentsModal] = useState(false);
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [showSupportModal, setShowSupportModal] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [resetEmailSent, setResetEmailSent] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  // Biometric state
  const [bioSupport, setBioSupport] = useState(null);
  const [bioActive, setBioActive] = useState(false);
  const [bioLastLogin, setBioLastLogin] = useState(null);
  const [togglingBio, setTogglingBio] = useState(false);
  const [enrollPasswordInput, setEnrollPasswordInput] = useState("");
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [enrollingBusy, setEnrollingBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const support = await checkBiometricSupport();
        const enabled = await isBiometricEnabled();
        const acct = await getSavedBiometricAccount();
        setBioSupport(support);
        setBioActive(enabled);
        setBioLastLogin(acct?.lastLogin || null);
      } catch (_) {}
    })();
  }, [showSecurityModal]);

  const handleToggleBiometric = async (value) => {
    if (!value) {
      setTogglingBio(true);
      await disableBiometrics();
      setBioActive(false);
      setTogglingBio(false);
      Alert.alert("Disabled", "Fingerprint login has been disabled on this device.");
    } else {
      if (!bioSupport?.hasHardware) {
        Alert.alert("Hardware Not Available", "Biometric hardware was not detected on this device.");
        return;
      }
      if (!bioSupport?.isEnrolled) {
        Alert.alert(
          "No Enrolled Fingerprint",
          "Please enroll at least one fingerprint in your Android device Settings first."
        );
        return;
      }
      setEnrollPasswordInput("");
      setShowEnrollModal(true);
    }
  };

  const handleCompleteEnrollment = async () => {
    if (!enrollPasswordInput || enrollPasswordInput.length < 6) {
      Alert.alert("Password Required", "Please enter your password to authorize biometric activation.");
      return;
    }
    setEnrollingBusy(true);
    try {
      const identifier = user?.email || dbUser?.phoneNumber || user?.phoneNumber || "Customer";
      const name = fullName || dbUser?.name || "User";
      const role = currentRoleKey || "customer";

      await saveBiometricCredentials({
        identifier,
        credential: enrollPasswordInput,
        name,
        role,
      });

      setBioActive(true);
      setShowEnrollModal(false);
      setEnrollPasswordInput("");
      Alert.alert("Activated", "Fingerprint login is now securely activated on your device!");
    } catch (err) {
      console.warn("Biometric enrollment error:", err?.message);
      Alert.alert("Activation Failed", err?.message || "Could not activate fingerprint login.");
    } finally {
      setEnrollingBusy(false);
    }
  };

  // Dynamic payment methods configuration from Super Admin Settings
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

  // Normalize role from Firestore auth profile
  const rawRole = (dbUser?.role || "").toLowerCase().trim();
  const userEmail = String(user?.email || dbUser?.email || "").toLowerCase().trim();
  const userPhone = String(dbUser?.phoneNumber || "").replace(/\D/g, "");

  const isMiniAdmin = rawRole === "miniadmin" || rawRole === "mini_admin" || dbUser?.isMiniAdmin === true;

  const isSuperAdminAuthority =
    userEmail.includes("251911000001") ||
    userEmail.includes("911000001") ||
    userPhone.includes("911000001") ||
    userEmail === "superadmin@mytruck.et" ||
    userEmail === "admin@mytruck.et" ||
    userEmail.includes("admin");

  const isSuperAdminUser =
    isSuperAdminAuthority ||
    rawRole === "superadmin" ||
    rawRole === "admin" ||
    rawRole === "super_admin" ||
    isMiniAdmin ||
    dbUser?.isSuperAdmin === true ||
    dbUser?.isAdmin === true;
  const isRestaurantUser =
    rawRole === "restaurant" ||
    rawRole === "seller" ||
    rawRole === "merchant";
  const isShopUser =
    rawRole === "shop" ||
    rawRole === "store";
  const isDriverUser =
    rawRole === "driver";

  const currentRoleKey = isSuperAdminUser
    ? "superadmin"
    : ROLE_CONFIG[rawRole]
    ? rawRole
    : "customer";

  const roleMeta = ROLE_CONFIG[currentRoleKey];

  const firstName = dbUser?.firstName || "";
  const lastName = dbUser?.lastName || "";
  const fullName =
    [firstName, lastName].filter(Boolean).join(" ") ||
    dbUser?.fullName ||
    "MyTruck Customer";

  const phone = dbUser?.phoneNumber || user?.phoneNumber || "Phone verified";
  const address = dbUser?.address || "My Location, Ethiopia";
  const initials =
    [firstName[0], lastName[0]].filter(Boolean).join("").toUpperCase() ||
    (fullName[0] ? fullName[0].toUpperCase() : "M");

  const handleSignOut = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: signOutUser },
    ]);
  };

  return (
    <SafeAreaView style={s.safe} edges={["top"]}>
      <StatusBar style="light" backgroundColor={TEAL} />

      {/* Enhanced Teal Header matching My Orders */}
      <View style={s.header}>
        <BackButton fallbackRoute="HomeTab" iconColor="white" />
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>My Account</Text>
          <Text style={s.headerSub} numberOfLines={1}>
            {fullName || "Profile & Settings"}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <NotificationBell
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              backgroundColor: "rgba(255,255,255,0.22)",
              marginRight: 8,
            }}
            iconColor="white"
            badgeColor={ORANGE}
          />
          <TouchableOpacity
            onPress={() => navigation.navigate("Profile")}
            style={s.headerActionBtn}
            activeOpacity={0.8}
            accessibilityLabel="Edit profile"
          >
            <PencilSquareIcon size={20} color="white" />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile Card Header */}
        <View style={s.profileCard}>
          <View style={s.profileTopRow}>
            {/* Avatar */}
            <View style={s.avatarWrap}>
              <Text style={s.avatarText}>{initials}</Text>
              <View style={s.statusDot} />
            </View>

            {/* User Details */}
            <View style={s.userDetails}>
              <Text style={s.nameText} numberOfLines={1}>
                {fullName}
              </Text>
              <Text style={s.phoneText}>{phone}</Text>
              <View style={s.addressRow}>
                <MapPinIcon size={13} color="#64748B" />
                <Text style={s.addressText} numberOfLines={1}>
                  {address}
                </Text>
              </View>
            </View>
          </View>

          {/* Role & Status Row */}
          <View style={s.badgeRow}>
            {/* Role Badge */}
            <View
              style={[
                s.roleBadge,
                {
                  backgroundColor: roleMeta.badgeBg,
                  borderColor: roleMeta.badgeBorder,
                },
              ]}
            >
              <MaterialCommunityIcons
                name={roleMeta.icon}
                size={14}
                color={roleMeta.badgeText}
                style={{ marginRight: 4 }}
              />
              <Text style={[s.roleBadgeTxt, { color: roleMeta.badgeText }]}>
                {roleMeta.label}
              </Text>
            </View>

            {/* Account Status Badge */}
            <View style={s.verifiedBadge}>
              <MaterialCommunityIcons name="check-decagram" size={14} color="#166534" />
              <Text style={s.verifiedText}>Verified Account</Text>
            </View>
          </View>
        </View>

        {/* SUPER ADMIN GOVERNANCE & CONTROL CENTER (Prominently displayed for Admins) */}
        {isSuperAdminUser ? (
          <TouchableOpacity
            style={s.adminControlCard}
            activeOpacity={0.9}
            onPress={() => navigation.navigate("AdminDashboard")}
          >
            <View style={s.adminCardLeft}>
              <View style={[s.adminIconCircle, isMiniAdmin && { backgroundColor: "#CCFBF1" }]}>
                <MaterialCommunityIcons
                  name={isMiniAdmin ? "shield-account" : "shield-crown"}
                  size={24}
                  color={isMiniAdmin ? "#0D9488" : "#B91C1C"}
                />
              </View>
              <View style={{ flex: 1, marginLeft: 10, marginRight: 4 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={[s.adminTitle, isMiniAdmin && { color: "#0F766E" }, { flex: 1, marginRight: 6 }]} numberOfLines={1}>
                    {isMiniAdmin ? "Mini Admin Operations" : "Super Admin Control"}
                  </Text>
                  <View style={[s.adminTag, isMiniAdmin && { backgroundColor: "#E6F7F1", borderColor: "#99F6E4" }]}>
                    <Text style={[s.adminTagTxt, isMiniAdmin && { color: "#0D9488" }]}>
                      {isMiniAdmin ? "OPERATIONS" : "GOVERNANCE"}
                    </Text>
                  </View>
                </View>
                <Text style={s.adminSubtitle} numberOfLines={2}>
                  {isMiniAdmin
                    ? "Operational order management, payments, and live platform delivery dispatch"
                    : "User management, shop/restaurant approvals, orders & analytics"}
                </Text>
              </View>
            </View>
            <ChevronRightIcon size={20} color={isMiniAdmin ? "#0D9488" : "#B91C1C"} />
          </TouchableOpacity>
        ) : null}

        {/* RESTAURANT KITCHEN & MENU CONTROL CENTER */}
        {isRestaurantUser ? (
          <TouchableOpacity
            style={[s.adminControlCard, { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" }]}
            activeOpacity={0.9}
            onPress={() => navigation.navigate("SellerHome", { isShop: false })}
          >
            <View style={s.adminCardLeft}>
              <View style={[s.adminIconCircle, { backgroundColor: "#DCFCE7" }]}>
                <MaterialCommunityIcons name="storefront" size={24} color="#166534" />
              </View>
              <View style={{ flex: 1, marginLeft: 10, marginRight: 4 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={[s.adminTitle, { color: "#166534", flex: 1, marginRight: 6 }]} numberOfLines={1}>Restaurant Control Center</Text>
                  <View style={[s.adminTag, { backgroundColor: "#DCFCE7" }]}>
                    <Text style={[s.adminTagTxt, { color: "#166534" }]}>KITCHEN & MENU</Text>
                  </View>
                </View>
                <Text style={[s.adminSubtitle, { color: "#15803D" }]} numberOfLines={2}>
                  Live kitchen queue, dish catalog, pricing & store settings
                </Text>
              </View>
            </View>
            <ChevronRightIcon size={20} color="#166534" />
          </TouchableOpacity>
        ) : null}

        {/* SHOP INVENTORY & CATALOG CONTROL CENTER */}
        {isShopUser ? (
          <TouchableOpacity
            style={[s.adminControlCard, { backgroundColor: "#FAF5FF", borderColor: "#E9D5FF" }]}
            activeOpacity={0.9}
            onPress={() => navigation.navigate("SellerHome", { isShop: true })}
          >
            <View style={s.adminCardLeft}>
              <View style={[s.adminIconCircle, { backgroundColor: "#F3E8FF" }]}>
                <MaterialCommunityIcons name="shopping" size={24} color="#6D28D9" />
              </View>
              <View style={{ flex: 1, marginLeft: 10, marginRight: 4 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={[s.adminTitle, { color: "#6D28D9", flex: 1, marginRight: 6 }]} numberOfLines={1}>Shop Control Center</Text>
                  <View style={[s.adminTag, { backgroundColor: "#F3E8FF" }]}>
                    <Text style={[s.adminTagTxt, { color: "#6D28D9" }]}>INVENTORY</Text>
                  </View>
                </View>
                <Text style={[s.adminSubtitle, { color: "#7C3AED" }]} numberOfLines={2}>
                  Customer grocery orders, stock catalog, items & store settings
                </Text>
              </View>
            </View>
            <ChevronRightIcon size={20} color="#6D28D9" />
          </TouchableOpacity>
        ) : null}

        {/* DRIVER OPERATIONS & FLEET DASHBOARD */}
        {isDriverUser ? (
          <TouchableOpacity
            style={[s.adminControlCard, { backgroundColor: "#FFFBEB", borderColor: "#FDE68A" }]}
            activeOpacity={0.9}
            onPress={() => navigation.navigate("DriverDashboard")}
          >
            <View style={s.adminCardLeft}>
              <View style={[s.adminIconCircle, { backgroundColor: "#FEF3C7" }]}>
                <MaterialCommunityIcons name="motorbike" size={24} color="#B45309" />
              </View>
              <View style={{ flex: 1, marginLeft: 10, marginRight: 4 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={[s.adminTitle, { color: "#92400E", flex: 1, marginRight: 6 }]} numberOfLines={1}>Driver Operations Center</Text>
                  <View style={[s.adminTag, { backgroundColor: "#FEF3C7" }]}>
                    <Text style={[s.adminTagTxt, { color: "#92400E" }]}>DISPATCH</Text>
                  </View>
                </View>
                <Text style={[s.adminSubtitle, { color: "#B45309" }]} numberOfLines={2}>
                  Live deliveries, route navigation, order pickup & earnings
                </Text>
              </View>
            </View>
            <ChevronRightIcon size={20} color="#B45309" />
          </TouchableOpacity>
        ) : null}

        {/* SECTION 1: Personal Information & Settings */}
        <View style={s.sectionCard}>
          <Text style={s.sectionHeader}>Personal Information</Text>

          {/* Update Your Details */}
          <TouchableOpacity
            style={s.menuItem}
            activeOpacity={0.7}
            onPress={() => navigation.navigate("Profile")}
          >
            <View style={s.menuLeft}>
              <View style={s.menuIconCircle}>
                <UserCircleIcon size={20} color={TEAL} />
              </View>
              <View>
                <Text style={s.menuLabel}>Update Your Details</Text>
                <Text style={s.menuSub}>Edit name, phone, address & location</Text>
              </View>
            </View>
            <ChevronRightIcon size={18} color="#94A3B8" />
          </TouchableOpacity>

          <View style={s.divider} />

          {/* Delivery Addresses */}
          <TouchableOpacity
            style={s.menuItem}
            activeOpacity={0.7}
            onPress={() => navigation.navigate("DeliveryAddresses")}
          >
            <View style={s.menuLeft}>
              <View style={s.menuIconCircle}>
                <MapPinIcon size={20} color={TEAL} />
              </View>
              <View>
                <Text style={s.menuLabel}>Delivery Addresses</Text>
                <Text style={s.menuSub}>{address}</Text>
              </View>
            </View>
            <ChevronRightIcon size={18} color="#94A3B8" />
          </TouchableOpacity>
        </View>

        {/* SECTION 2: Orders & Payments */}
        <View style={s.sectionCard}>
          <Text style={s.sectionHeader}>Activity & Orders</Text>

          {/* My Orders */}
          <TouchableOpacity
            style={s.menuItem}
            activeOpacity={0.7}
            onPress={() => navigation.navigate("Order Details")}
          >
            <View style={s.menuLeft}>
              <View style={s.menuIconCircle}>
                <ShoppingBagIcon size={20} color={TEAL} />
              </View>
              <View>
                <Text style={s.menuLabel}>My Orders</Text>
                <Text style={s.menuSub}>Track live deliveries and view order history</Text>
              </View>
            </View>
            <ChevronRightIcon size={18} color="#94A3B8" />
          </TouchableOpacity>

          <View style={s.divider} />

          {/* Payment Methods */}
          <TouchableOpacity
            style={s.menuItem}
            activeOpacity={0.7}
            onPress={() => setShowPaymentsModal(true)}
          >
            <View style={s.menuLeft}>
              <View style={s.menuIconCircle}>
                <CreditCardIcon size={20} color={TEAL} />
              </View>
              <View>
                <Text style={s.menuLabel}>Payment Methods</Text>
                <Text style={s.menuSub}>Telebirr, CBE Birr & Cash on Delivery</Text>
              </View>
            </View>
            <ChevronRightIcon size={18} color="#94A3B8" />
          </TouchableOpacity>
        </View>

        {/* SECTION 3: Preferences & Security */}
        <View style={s.sectionCard}>
          <Text style={s.sectionHeader}>Preferences & Security</Text>

          {/* Push Notifications Toggle */}
          <View style={s.menuItem}>
            <View style={s.menuLeft}>
              <View style={s.menuIconCircle}>
                <BellIcon size={20} color={TEAL} />
              </View>
              <View>
                <Text style={s.menuLabel}>Notifications</Text>
                <Text style={s.menuSub}>Order updates, tracking & alerts</Text>
              </View>
            </View>
            <Switch
              value={notificationsEnabled}
              onValueChange={setNotificationsEnabled}
              trackColor={{ false: "#CBD5E1", true: TEAL }}
              thumbColor="#FFFFFF"
            />
          </View>

          <View style={s.divider} />

          {/* Notification Center Screen Link */}
          <TouchableOpacity
            style={s.menuItem}
            activeOpacity={0.7}
            onPress={() => navigation.navigate("NotificationCenter")}
          >
            <View style={s.menuLeft}>
              <View style={s.menuIconCircle}>
                <MaterialCommunityIcons name="bell-ring-outline" size={20} color={TEAL} />
              </View>
              <View>
                <Text style={s.menuLabel}>Notification Center</Text>
                <Text style={s.menuSub}>View all announcements, order & dispatch history</Text>
              </View>
            </View>
            <ChevronRightIcon size={18} color="#94A3B8" />
          </TouchableOpacity>

          <View style={s.divider} />

          {/* Security & Password */}
          <TouchableOpacity
            style={s.menuItem}
            activeOpacity={0.7}
            onPress={() => setShowSecurityModal(true)}
          >
            <View style={s.menuLeft}>
              <View style={s.menuIconCircle}>
                <LockClosedIcon size={20} color={TEAL} />
              </View>
              <View>
                <Text style={s.menuLabel}>Security & Password</Text>
                <Text style={s.menuSub}>Session encryption & account protection</Text>
              </View>
            </View>
            <ChevronRightIcon size={18} color="#94A3B8" />
          </TouchableOpacity>
        </View>

        {/* SECTION 4: Help, About & Support */}
        <View style={s.sectionCard}>
          <Text style={s.sectionHeader}>Support & Platform</Text>

          {/* Help & Support */}
          <TouchableOpacity
            style={s.menuItem}
            activeOpacity={0.7}
            onPress={() => setShowSupportModal(true)}
          >
            <View style={s.menuLeft}>
              <View style={s.menuIconCircle}>
                <QuestionMarkCircleIcon size={20} color={TEAL} />
              </View>
              <View>
                <Text style={s.menuLabel}>Help & Support</Text>
                <Text style={s.menuSub}>FAQ, live support & call center</Text>
              </View>
            </View>
            <ChevronRightIcon size={18} color="#94A3B8" />
          </TouchableOpacity>

          <View style={s.divider} />

          {/* About MyTruck */}
          <TouchableOpacity
            style={s.menuItem}
            activeOpacity={0.7}
            onPress={() => setShowAboutModal(true)}
          >
            <View style={s.menuLeft}>
              <View style={s.menuIconCircle}>
                <InformationCircleIcon size={20} color={TEAL} />
              </View>
              <View>
                <Text style={s.menuLabel}>About MyTruck</Text>
                <Text style={s.menuSub}>Version 1.0.0 · Terms & Privacy</Text>
              </View>
            </View>
            <ChevronRightIcon size={18} color="#94A3B8" />
          </TouchableOpacity>
        </View>

        {/* Sign Out Button */}
        <TouchableOpacity
          style={s.signOutBtn}
          activeOpacity={0.85}
          onPress={handleSignOut}
        >
          <ArrowRightOnRectangleIcon size={20} color="#DC2626" />
          <Text style={s.signOutText}>Sign Out of MyTruck</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* 1. Payment Methods Modal */}
      <Modal visible={showPaymentsModal} animationType="slide" transparent onRequestClose={() => setShowPaymentsModal(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Payment Methods</Text>
              <TouchableOpacity onPress={() => setShowPaymentsModal(false)}>
                <XMarkIcon size={22} color="#64748B" />
              </TouchableOpacity>
            </View>

            {/* Chapa Payment Gateway */}
            <View style={s.modalItem}>
              <MaterialCommunityIcons name="credit-card-fast-outline" size={26} color={TEAL} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={s.modalItemTitle}>Chapa Online Payment Gateway</Text>
                <Text style={s.modalItemSub}>Telebirr, CBE Birr, and Debit/Credit Cards</Text>
              </View>
              <View style={paymentConfig.chapaEnabled ? s.activeBadge : s.comingBadge}>
                <Text style={paymentConfig.chapaEnabled ? s.activeBadgeTxt : s.comingBadgeTxt}>
                  {paymentConfig.chapaEnabled ? "ACTIVE" : "MAINTENANCE"}
                </Text>
              </View>
            </View>

            {/* Telebirr Direct */}
            <View style={[s.modalItem, !paymentConfig.telebirrEnabled && { opacity: 0.75 }]}>
              <MaterialCommunityIcons name="cellphone-wireless" size={26} color={paymentConfig.telebirrEnabled ? TEAL : "#64748B"} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={s.modalItemTitle}>Telebirr Direct Integration</Text>
                <Text style={s.modalItemSub}>Direct in-app one-click USSD checkout</Text>
              </View>
              <View style={paymentConfig.telebirrEnabled ? s.activeBadge : s.comingBadge}>
                <Text style={paymentConfig.telebirrEnabled ? s.activeBadgeTxt : s.comingBadgeTxt}>
                  {paymentConfig.telebirrEnabled ? "ACTIVE" : "COMING SOON"}
                </Text>
              </View>
            </View>

            {/* CBE Birr */}
            <View style={[s.modalItem, !paymentConfig.cbeBirrEnabled && { opacity: 0.75 }]}>
              <MaterialCommunityIcons name="bank" size={26} color={paymentConfig.cbeBirrEnabled ? TEAL : "#64748B"} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={s.modalItemTitle}>CBE Birr Direct Gateway</Text>
                <Text style={s.modalItemSub}>Commercial Bank of Ethiopia direct channel</Text>
              </View>
              <View style={paymentConfig.cbeBirrEnabled ? s.activeBadge : s.comingBadge}>
                <Text style={paymentConfig.cbeBirrEnabled ? s.activeBadgeTxt : s.comingBadgeTxt}>
                  {paymentConfig.cbeBirrEnabled ? "ACTIVE" : "COMING SOON"}
                </Text>
              </View>
            </View>

            {/* Cash on Delivery */}
            <View style={[s.modalItem, !paymentConfig.codEnabled && { opacity: 0.75 }]}>
              <MaterialCommunityIcons name="cash-multiple" size={26} color={paymentConfig.codEnabled ? "#15803D" : "#64748B"} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={s.modalItemTitle}>Cash on Delivery (COD)</Text>
                <Text style={s.modalItemSub}>Pay your driver in cash upon doorstep delivery</Text>
              </View>
              <View style={paymentConfig.codEnabled ? s.activeBadge : s.comingBadge}>
                <Text style={paymentConfig.codEnabled ? s.activeBadgeTxt : s.comingBadgeTxt}>
                  {paymentConfig.codEnabled ? "ACTIVE" : "COMING SOON"}
                </Text>
              </View>
            </View>

            <TouchableOpacity style={s.modalCloseBtn} onPress={() => setShowPaymentsModal(false)}>
              <Text style={s.modalCloseBtnTxt}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 2b. Biometric Enrollment Password Modal */}
      <Modal visible={showEnrollModal} animationType="fade" transparent onRequestClose={() => setShowEnrollModal(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalSheet, { padding: 20 }]}>
            <View style={{ alignItems: "center", marginBottom: 16 }}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: "#E6F4F1", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
                <MaterialCommunityIcons name="fingerprint" size={38} color={TEAL} />
              </View>
              <Text style={{ fontSize: 18, fontWeight: "800", color: DARK, textAlign: "center" }}>
                Enable Fingerprint Login
              </Text>
              <Text style={{ fontSize: 13, color: "#64748B", textAlign: "center", marginTop: 4 }}>
                Enter your account password to verify ownership before enrolling your fingerprint.
              </Text>
            </View>

            <TextInput
              style={{ backgroundColor: "#F8FAFC", borderWidth: 1.5, borderColor: "#E2E8F0", borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 14, fontWeight: "600", color: DARK, marginBottom: 16 }}
              placeholder="Enter your account password"
              placeholderTextColor="#94A3B8"
              secureTextEntry
              value={enrollPasswordInput}
              onChangeText={setEnrollPasswordInput}
            />

            <TouchableOpacity
              style={s.modalPrimaryBtn}
              onPress={handleCompleteEnrollment}
              disabled={enrollingBusy}
            >
              {enrollingBusy ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={s.modalPrimaryBtnTxt}>Verify & Scan Fingerprint</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.modalCloseBtn, { marginTop: 8 }]}
              onPress={() => setShowEnrollModal(false)}
            >
              <Text style={s.modalCloseBtnTxt}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 2. Security & Password Modal */}
      <Modal visible={showSecurityModal} animationType="slide" transparent onRequestClose={() => setShowSecurityModal(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Security & Password</Text>
              <TouchableOpacity onPress={() => setShowSecurityModal(false)}>
                <XMarkIcon size={22} color="#64748B" />
              </TouchableOpacity>
            </View>

            <View style={s.securityBanner}>
              <MaterialCommunityIcons name="shield-check" size={28} color="#166534" />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ fontWeight: "800", color: "#166534", fontSize: 14 }}>Session Protected</Text>
                <Text style={{ color: "#15803D", fontSize: 11, marginTop: 2 }}>
                  Your account is secured with Firebase Auth encryption and token authorization.
                </Text>
              </View>
            </View>

            {/* Biometric & Fingerprint Authentication Section */}
            <View style={s.bioCard}>
              <View style={s.bioHeaderRow}>
                <View style={s.bioIconWrap}>
                  <MaterialCommunityIcons name="fingerprint" size={24} color={bioActive ? TEAL : "#64748B"} />
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={s.bioTitle}>Fingerprint Login</Text>
                  <Text style={s.bioSub}>
                    {bioActive
                      ? "Active · Android Keystore protected"
                      : bioSupport?.hasHardware && bioSupport?.isEnrolled
                      ? "Hardware ready · Tap to activate"
                      : !bioSupport?.hasHardware
                      ? "Biometric hardware not detected"
                      : "No fingerprint enrolled in Settings"}
                  </Text>
                </View>
                {togglingBio ? (
                  <ActivityIndicator size="small" color={TEAL} />
                ) : (
                  <Switch
                    value={bioActive}
                    onValueChange={handleToggleBiometric}
                    trackColor={{ false: "#CBD5E1", true: TEAL }}
                    thumbColor="white"
                  />
                )}
              </View>

              {Boolean(bioActive && bioLastLogin) && (
                <View style={s.bioFooter}>
                  <MaterialCommunityIcons name="clock-outline" size={13} color="#64748B" style={{ marginRight: 4 }} />
                  <Text style={s.bioFooterTxt}>
                    Last fingerprint access: {new Date(bioLastLogin).toLocaleDateString()} at {new Date(bioLastLogin).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              )}
            </View>

            <Text style={{ fontSize: 13, fontWeight: "700", color: DARK, marginTop: 14, marginBottom: 6 }}>
              Reset or Change Password
            </Text>
            <Text style={{ fontSize: 12, color: "#64748B", lineHeight: 17, marginBottom: 14 }}>
              We will send a secure password reset link to your registered email: {user?.email || "your account email"}.
            </Text>

            {resetEmailSent ? (
              <View style={s.resetSuccessBox}>
                <Text style={s.resetSuccessTxt}>✓ Password reset link has been sent to your email!</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={s.modalPrimaryBtn}
                disabled={sendingReset}
                onPress={async () => {
                  if (!user?.email) {
                    Alert.alert("No Email", "Please update your email in your profile first.");
                    return;
                  }
                  setSendingReset(true);
                  try {
                    await sendPasswordResetEmail(auth, user.email);
                    setResetEmailSent(true);
                  } catch (err) {
                    Alert.alert("Reset Error", err?.message || "Could not send reset email.");
                  } finally {
                    setSendingReset(false);
                  }
                }}
              >
                {sendingReset ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={s.modalPrimaryBtnTxt}>Send Password Reset Email</Text>
                )}
              </TouchableOpacity>
            )}

            <TouchableOpacity style={s.modalCloseBtn} onPress={() => { setShowSecurityModal(false); setResetEmailSent(false); }}>
              <Text style={s.modalCloseBtnTxt}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 2b. Biometric Enrollment Password Modal */}
      <Modal visible={showEnrollModal} animationType="fade" transparent onRequestClose={() => setShowEnrollModal(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalSheet, { padding: 20 }]}>
            <View style={{ alignItems: "center", marginBottom: 16 }}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: "#E6F4F1", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
                <MaterialCommunityIcons name="fingerprint" size={38} color={TEAL} />
              </View>
              <Text style={{ fontSize: 18, fontWeight: "800", color: DARK, textAlign: "center" }}>
                Enable Fingerprint Login
              </Text>
              <Text style={{ fontSize: 13, color: "#64748B", textAlign: "center", marginTop: 4 }}>
                Enter your account password to verify ownership before enrolling your fingerprint.
              </Text>
            </View>

            <TextInput
              style={{ backgroundColor: "#F8FAFC", borderWidth: 1.5, borderColor: "#E2E8F0", borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 14, fontWeight: "600", color: DARK, marginBottom: 16 }}
              placeholder="Enter your account password"
              placeholderTextColor="#94A3B8"
              secureTextEntry
              value={enrollPasswordInput}
              onChangeText={setEnrollPasswordInput}
            />

            <TouchableOpacity
              style={s.modalPrimaryBtn}
              onPress={handleCompleteEnrollment}
              disabled={enrollingBusy}
            >
              {enrollingBusy ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={s.modalPrimaryBtnTxt}>Verify & Scan Fingerprint</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.modalCloseBtn, { marginTop: 8 }]}
              onPress={() => setShowEnrollModal(false)}
            >
              <Text style={s.modalCloseBtnTxt}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 3. Help & Support Modal */}
      <Modal visible={showSupportModal} animationType="slide" transparent onRequestClose={() => setShowSupportModal(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Help & Customer Support</Text>
              <TouchableOpacity onPress={() => setShowSupportModal(false)}>
                <XMarkIcon size={22} color="#64748B" />
              </TouchableOpacity>
            </View>

            <Text style={{ fontSize: 12, color: "#64748B", marginBottom: 14 }}>
              Our 24/7 dedicated support team in Addis Ababa is here to assist you with orders, drivers, and delivery inquiries.
            </Text>

            <TouchableOpacity
              style={s.supportOption}
              onPress={() => Linking.openURL("tel:+251911000000")}
            >
              <PhoneIcon size={22} color={TEAL} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={s.supportOptionTitle}>Direct Call Center</Text>
                <Text style={s.supportOptionSub}>+251 91 100 0000 (Toll Free)</Text>
              </View>
              <ChevronRightIcon size={18} color="#94A3B8" />
            </TouchableOpacity>

            <TouchableOpacity
              style={s.supportOption}
              onPress={() => Linking.openURL("https://wa.me/251911000000")}
            >
              <MaterialCommunityIcons name="whatsapp" size={24} color="#25D366" />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={s.supportOptionTitle}>WhatsApp Live Chat</Text>
                <Text style={s.supportOptionSub}>Instant support message response</Text>
              </View>
              <ChevronRightIcon size={18} color="#94A3B8" />
            </TouchableOpacity>

            <TouchableOpacity
              style={s.supportOption}
              onPress={() => Linking.openURL("mailto:support@mytruck.et")}
            >
              <EnvelopeIcon size={22} color={ORANGE} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={s.supportOptionTitle}>Email Support</Text>
                <Text style={s.supportOptionSub}>support@mytruck.et</Text>
              </View>
              <ChevronRightIcon size={18} color="#94A3B8" />
            </TouchableOpacity>

            <TouchableOpacity style={s.modalCloseBtn} onPress={() => setShowSupportModal(false)}>
              <Text style={s.modalCloseBtnTxt}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 2b. Biometric Enrollment Password Modal */}
      <Modal visible={showEnrollModal} animationType="fade" transparent onRequestClose={() => setShowEnrollModal(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalSheet, { padding: 20 }]}>
            <View style={{ alignItems: "center", marginBottom: 16 }}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: "#E6F4F1", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
                <MaterialCommunityIcons name="fingerprint" size={38} color={TEAL} />
              </View>
              <Text style={{ fontSize: 18, fontWeight: "800", color: DARK, textAlign: "center" }}>
                Enable Fingerprint Login
              </Text>
              <Text style={{ fontSize: 13, color: "#64748B", textAlign: "center", marginTop: 4 }}>
                Enter your account password to verify ownership before enrolling your fingerprint.
              </Text>
            </View>

            <TextInput
              style={{ backgroundColor: "#F8FAFC", borderWidth: 1.5, borderColor: "#E2E8F0", borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 14, fontWeight: "600", color: DARK, marginBottom: 16 }}
              placeholder="Enter your account password"
              placeholderTextColor="#94A3B8"
              secureTextEntry
              value={enrollPasswordInput}
              onChangeText={setEnrollPasswordInput}
            />

            <TouchableOpacity
              style={s.modalPrimaryBtn}
              onPress={handleCompleteEnrollment}
              disabled={enrollingBusy}
            >
              {enrollingBusy ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={s.modalPrimaryBtnTxt}>Verify & Scan Fingerprint</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.modalCloseBtn, { marginTop: 8 }]}
              onPress={() => setShowEnrollModal(false)}
            >
              <Text style={s.modalCloseBtnTxt}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 4. About MyTruck Modal */}
      <Modal visible={showAboutModal} animationType="slide" transparent onRequestClose={() => setShowAboutModal(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>About MyTruck Delivery</Text>
              <TouchableOpacity onPress={() => setShowAboutModal(false)}>
                <XMarkIcon size={22} color="#64748B" />
              </TouchableOpacity>
            </View>

            <View style={{ alignItems: "center", marginVertical: 14 }}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: "#E6F4F1", alignItems: "center", justifyContent: "center" }}>
                <MaterialCommunityIcons name="truck-delivery" size={32} color={TEAL} />
              </View>
              <Text style={{ fontSize: 18, fontWeight: "900", color: DARK, marginTop: 8 }}>MyTruck Delivery</Text>
              <Text style={{ fontSize: 12, color: "#64748B" }}>Version 1.0.0 (Production Release)</Text>
            </View>

            <Text style={{ fontSize: 12.5, color: "#475569", lineHeight: 18, textAlign: "center", marginBottom: 14 }}>
              MyTruck is Ethiopia's leading on-demand food, retail, and parcel delivery network, connecting thousands of restaurants, shops, and drivers across Addis Ababa.
            </Text>

            <View style={{ borderTopWidth: 1, borderTopColor: "#F1F5F9", paddingTop: 10 }}>
              <Text style={{ fontSize: 11, color: "#94A3B8", textAlign: "center" }}>
                Headquarters: Bole Sub-City, Addis Ababa, Ethiopia{"\n"}
                Licensed delivery operator under FDRE Ministry of Transport.
              </Text>
            </View>

            <TouchableOpacity style={s.modalCloseBtn} onPress={() => setShowAboutModal(false)}>
              <Text style={s.modalCloseBtnTxt}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 2b. Biometric Enrollment Password Modal */}
      <Modal visible={showEnrollModal} animationType="fade" transparent onRequestClose={() => setShowEnrollModal(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalSheet, { padding: 20 }]}>
            <View style={{ alignItems: "center", marginBottom: 16 }}>
              <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: "#E6F4F1", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
                <MaterialCommunityIcons name="fingerprint" size={38} color={TEAL} />
              </View>
              <Text style={{ fontSize: 18, fontWeight: "800", color: DARK, textAlign: "center" }}>
                Enable Fingerprint Login
              </Text>
              <Text style={{ fontSize: 13, color: "#64748B", textAlign: "center", marginTop: 4 }}>
                Enter your account password to verify ownership before enrolling your fingerprint.
              </Text>
            </View>

            <TextInput
              style={{ backgroundColor: "#F8FAFC", borderWidth: 1.5, borderColor: "#E2E8F0", borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 14, fontWeight: "600", color: DARK, marginBottom: 16 }}
              placeholder="Enter your account password"
              placeholderTextColor="#94A3B8"
              secureTextEntry
              value={enrollPasswordInput}
              onChangeText={setEnrollPasswordInput}
            />

            <TouchableOpacity
              style={s.modalPrimaryBtn}
              onPress={handleCompleteEnrollment}
              disabled={enrollingBusy}
            >
              {enrollingBusy ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={s.modalPrimaryBtnTxt}>Verify & Scan Fingerprint</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.modalCloseBtn, { marginTop: 8 }]}
              onPress={() => setShowEnrollModal(false)}
            >
              <Text style={s.modalCloseBtnTxt}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#F5FAF9",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
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
  headerActionBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  scrollContent: {
    padding: 16,
    // Clears the floating customer tab bar
    paddingBottom: 110,
  },
  profileCard: {
    backgroundColor: "white",
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#E6ECEB",
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 5,
  },
  profileTopRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatarWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: TEAL,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  avatarText: {
    color: "white",
    fontSize: 24,
    fontWeight: "900",
  },
  statusDot: {
    position: "absolute",
    bottom: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#22C55E",
    borderWidth: 2,
    borderColor: "white",
  },
  userDetails: {
    flex: 1,
    marginLeft: 16,
  },
  nameText: {
    fontSize: 19,
    fontWeight: "800",
    color: DARK,
  },
  phoneText: {
    fontSize: 13,
    color: "#64748B",
    marginTop: 2,
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  addressText: {
    fontSize: 12,
    color: "#64748B",
    flex: 1,
    marginLeft: 4,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
  },
  roleBadgeTxt: {
    fontSize: 12,
    fontWeight: "800",
  },
  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: "#DCFCE7",
    borderColor: "#BBF7D0",
    borderWidth: 1,
  },
  verifiedText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#166534",
    marginLeft: 4,
  },
  // Super Admin Control Card
  adminControlCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FEF2F2",
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: "#FCA5A5",
    elevation: 3,
    shadowColor: "#B91C1C",
    shadowOpacity: 0.1,
    shadowRadius: 5,
  },
  adminCardLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  adminIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
  },
  adminTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: "#991B1B",
  },
  adminTag: {
    backgroundColor: "#DC2626",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  adminTagTxt: {
    color: "white",
    fontSize: 9,
    fontWeight: "900",
  },
  adminSubtitle: {
    fontSize: 11,
    color: "#7F1D1D",
    marginTop: 2,
    lineHeight: 15,
  },
  // Menu Sections
  sectionCard: {
    backgroundColor: "white",
    borderRadius: 18,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#E6ECEB",
    elevation: 1,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: "800",
    color: "#94A3B8",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 6,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 6,
  },
  menuLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  menuIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#F5FAF9",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  menuLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: DARK,
  },
  menuSub: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: "#F1F5F9",
    marginHorizontal: 8,
  },
  signOutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FEE2E2",
    borderRadius: 16,
    paddingVertical: 14,
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  signOutText: {
    color: "#DC2626",
    fontSize: 15,
    fontWeight: "800",
    marginLeft: 8,
  },
  bioCard: {
    backgroundColor: "#F8FAFC",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 14,
    marginTop: 14,
    marginBottom: 6,
  },
  bioHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  bioIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#E6F4F1",
    alignItems: "center",
    justifyContent: "center",
  },
  bioTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: DARK,
  },
  bioSub: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
  bioFooter: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#EDF2F7",
  },
  bioFooterTxt: {
    fontSize: 11,
    color: "#64748B",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: Platform.OS === "ios" ? 38 : 24,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: DARK,
  },
  modalItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  modalItemTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: DARK,
  },
  modalItemSub: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
  activeBadge: {
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  activeBadgeTxt: {
    color: "#166534",
    fontSize: 10,
    fontWeight: "800",
  },
  comingBadge: {
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  comingBadgeTxt: {
    color: "#64748B",
    fontSize: 9.5,
    fontWeight: "800",
  },
  modalCloseBtn: {
    backgroundColor: "#F1F5F9",
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 10,
  },
  modalCloseBtnTxt: {
    fontSize: 14,
    fontWeight: "700",
    color: "#475569",
  },
  securityBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#DCFCE7",
    padding: 14,
    borderRadius: 14,
    marginBottom: 10,
  },
  modalPrimaryBtn: {
    backgroundColor: TEAL,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  modalPrimaryBtnTxt: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 14,
  },
  resetSuccessBox: {
    backgroundColor: "#DCFCE7",
    padding: 12,
    borderRadius: 12,
    marginBottom: 10,
  },
  resetSuccessTxt: {
    color: "#166534",
    fontSize: 12,
    fontWeight: "700",
  },
  supportOption: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 10,
    backgroundColor: "#F8FAFC",
    borderRadius: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  supportOptionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: DARK,
  },
  supportOptionSub: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 1,
  },
});
