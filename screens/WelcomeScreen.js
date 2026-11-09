import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

const { width } = Dimensions.get("window");
const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";

// Exact cropped delivery truck illustration that blends 100% seamlessly
const WELCOME_TRUCK_BG = require("../assets/cropped/welcome_truck_bg.png");

export default function WelcomeScreen() {
  const navigation = useNavigation();
  const [isExistingCustomer, setIsExistingCustomer] = useState(false);
  const [lastPhone, setLastPhone] = useState("");

  // Check whether the customer already has a registered account on this device
  const checkExistingAccount = useCallback(async () => {
    try {
      const [hasAccount, savedPhone] = await Promise.all([
        AsyncStorage.getItem("@mytruck_has_account"),
        AsyncStorage.getItem("@mytruck_last_phone"),
      ]);
      if (hasAccount === "true" || Boolean(savedPhone)) {
        setIsExistingCustomer(true);
        if (savedPhone) setLastPhone(savedPhone);
      } else {
        setIsExistingCustomer(false);
      }
    } catch (_) {
      setIsExistingCustomer(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      checkExistingAccount();
    }, [checkExistingAccount])
  );

  const handleGetStarted = () => {
    if (isExistingCustomer) {
      // Existing customer: navigate directly to Login with their phone number
      navigation.navigate("SignIn", { prefillPhone: lastPhone || "" });
    } else {
      // Genuinely new customer: navigate to Registration
      navigation.navigate("SignUp");
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <StatusBar style="light" backgroundColor={TEAL} />

      {/* Main Illustration Area using exact cropped welcome_truck_bg */}
      <View style={s.imageContainer}>
        <Image
          source={WELCOME_TRUCK_BG}
          style={s.truckImage}
          resizeMode="cover"
        />
      </View>

      {/* Bottom Sheet Card */}
      <View style={s.bottomSheet}>
        {/* 1. Get Started Button - Routes existing customers to Login, new to SignUp */}
        <TouchableOpacity
          style={s.getStartedBtn}
          onPress={handleGetStarted}
          activeOpacity={0.88}
        >
          <Text style={s.getStartedTxt}>
            {isExistingCustomer ? "Get Started" : "Get Started"}
          </Text>
        </TouchableOpacity>

        {/* 2. Continue with Phone (SMS OTP) */}
        {/* SMS-code sign-in disabled for security (see AuthContext.signInWithOtp) */}

        {/* 3. Already have an account? Sign In */}
        <View style={s.signInRow}>
          <Text style={s.alreadyTxt}>Already have an account? </Text>
          <TouchableOpacity
            onPress={() => navigation.navigate("SignIn", { prefillPhone: lastPhone || "" })}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={s.signInLink}>Sign In</Text>
          </TouchableOpacity>
        </View>

        {/* 4. Merchant registration */}
        <TouchableOpacity
          onPress={() => navigation.navigate("SellerApply")}
          style={s.merchantLink}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={s.merchantTxt}>Register your restaurant or shop</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: TEAL,
  },
  imageContainer: {
    flex: 1,
    width: "100%",
    backgroundColor: TEAL,
    overflow: "hidden",
  },
  truckImage: {
    width: "100%",
    height: "100%",
  },
  bottomSheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 28,
    alignItems: "center",
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: -3 },
    shadowRadius: 6,
  },
  getStartedBtn: {
    width: "100%",
    backgroundColor: TEAL,
    borderRadius: 24,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
    shadowColor: TEAL,
    shadowOpacity: 0.35,
    shadowRadius: 5,
  },
  getStartedTxt: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  phoneBtn: {
    width: "100%",
    backgroundColor: "#F0FDFA",
    borderWidth: 1.5,
    borderColor: "#99F6E4",
    borderRadius: 24,
    paddingVertical: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  phoneBtnTxt: {
    color: TEAL,
    fontSize: 14.5,
    fontWeight: "800",
  },
  signInRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  alreadyTxt: {
    color: "#1E3A5F",
    fontSize: 14,
    fontWeight: "700",
  },
  signInLink: {
    color: ORANGE,
    fontSize: 14,
    fontWeight: "800",
  },
  merchantLink: {
    marginTop: 10,
    paddingVertical: 4,
  },
  merchantTxt: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
});
