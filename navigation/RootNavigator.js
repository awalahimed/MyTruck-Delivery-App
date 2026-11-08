import React, { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import AuthStack from "../navigation/AuthStack";
import AppStack from "../navigation/AppStack";
import PhoneVerificationGate from "../screens/PhoneVerificationGate";
import AnimatedSplash from "../components/AnimatedSplash";
import { UserAuth, OTP_VERIFICATION_REQUIRED } from "../contexts/AuthContext";
import { getRoleInfo, homeRouteFor } from "../utils/roles";
import { BlockedAccountScreen } from "../components/RoleGate";

const TEAL = "#179B83";
const DARK = "#0B2A26";

const RootNavigator = () => {
  const { user, authLoading, dbUser, otpFlowInProgress, sessionPhoneVerified, refreshProfile, signOutUser } = UserAuth();
  const [stallTimeout, setStallTimeout] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let timer;
    if (user && !dbUser) {
      timer = setTimeout(() => {
        setStallTimeout(true);
      }, 7000);
    } else {
      setStallTimeout(false);
    }
    return () => clearTimeout(timer);
  }, [user, dbUser]);

  // Loading state with branded animated splash while auth or profile initializes
  if (authLoading && !stallTimeout) {
    return <AnimatedSplash message="Initializing your MyTruck session..." />;
  }

  // Not signed in — show auth flow
  if (!user) return <AuthStack />;

  // OTP flow in progress
  if (otpFlowInProgress) return <AuthStack />;

  // Signed in but Firestore profile is taking longer than 4s — show recovery screen
  if (!dbUser) {
    if (stallTimeout) {
      return (
        <View style={styles.recoveryContainer}>
          <View style={styles.recoveryCard}>
            <View style={styles.iconCircle}>
              <MaterialCommunityIcons name="cloud-sync-outline" size={36} color={TEAL} />
            </View>
            <Text style={styles.recoveryTitle}>Syncing Your Profile</Text>
            <Text style={styles.recoverySubtitle}>
              Connecting to MyTruck services is taking longer than usual due to network conditions.
            </Text>

            <TouchableOpacity
              style={styles.retryBtn}
              activeOpacity={0.85}
              disabled={retrying}
              onPress={async () => {
                setRetrying(true);
                try {
                  await refreshProfile();
                } finally {
                  setRetrying(false);
                }
              }}
            >
              {retrying ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.retryBtnText}>Retry Connection</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.signOutBtn}
              activeOpacity={0.85}
              onPress={async () => {
                await signOutUser();
              }}
            >
              <Text style={styles.signOutBtnText}>Sign Out / Switch Account</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    return <AnimatedSplash message="Loading profile & permissions..." />;
  }

  // Phone verification gate — only enforced when OTP is required AND not yet verified this session
  if (OTP_VERIFICATION_REQUIRED && !sessionPhoneVerified) {
    return <PhoneVerificationGate />;
  }

  // Authoritative Role Resolution:
  // - Super Admin / Admin -> starts directly on "AdminDashboard"
  // - Driver -> starts on "DriverDashboard"
  // - Restaurant / Shop / Pending Seller -> starts on "SellerHome"
  // - Customer -> starts on "Home" (CustomerTabNavigator)
  // Role rules live in utils/roles (exact owner accounts only — no "email contains admin")
  const roleInfo = getRoleInfo(user, dbUser);

  // Banned / suspended accounts (set from the Admin dashboard) can't use the app
  if (roleInfo.isBlocked) {
    return <BlockedAccountScreen status={roleInfo.accountStatus} onSignOut={() => signOutUser()} />;
  }

  const initialRoute = homeRouteFor(roleInfo);

  return (
    <AppStack
      key={user?.uid ? `${user.uid}_${initialRoute}` : initialRoute}
      initialRoute={initialRoute}
    />
  );
};

const styles = StyleSheet.create({
  recoveryContainer: {
    flex: 1,
    backgroundColor: DARK,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  recoveryCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 24,
    width: "100%",
    maxWidth: 380,
    alignItems: "center",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#E6F4F1",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  recoveryTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: DARK,
    marginBottom: 8,
    textAlign: "center",
  },
  recoverySubtitle: {
    fontSize: 13,
    color: "#64748B",
    textAlign: "center",
    lineHeight: 19,
    marginBottom: 20,
  },
  retryBtn: {
    backgroundColor: TEAL,
    borderRadius: 12,
    paddingVertical: 14,
    width: "100%",
    alignItems: "center",
    marginBottom: 10,
  },
  retryBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  signOutBtn: {
    backgroundColor: "#F1F5F9",
    borderRadius: 12,
    paddingVertical: 13,
    width: "100%",
    alignItems: "center",
  },
  signOutBtnText: {
    color: "#475569",
    fontSize: 13,
    fontWeight: "600",
  },
});

export default RootNavigator;
