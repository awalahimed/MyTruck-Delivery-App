import React, { useState, useEffect } from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import WelcomeScreen from "../screens/WelcomeScreen";
import BiometricWelcomeScreen from "../screens/BiometricWelcomeScreen";
import PhoneAuthScreen from "../screens/PhoneAuthScreen";
import OtpVerificationScreen from "../screens/OtpVerificationScreen";
import SignIn from "../screens/SignIn";
import SignUp from "../screens/SignUp";
import UserDetails from "../screens/UserDetails";
import SellerApply from "../screens/SellerApply";
import { isBiometricEnabled, checkBiometricSupport } from "../services/biometricService";

const Stack = createNativeStackNavigator();

const AuthStack = () => {
  const [initialRoute, setInitialRoute] = useState(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [support, enabled] = await Promise.all([
          checkBiometricSupport(),
          isBiometricEnabled(),
        ]);
        if (active) {
          if (support.isReady && enabled) {
            setInitialRoute("BiometricWelcome");
          } else {
            setInitialRoute("Welcome");
          }
        }
      } catch (_) {
        if (active) setInitialRoute("Welcome");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!initialRoute) return null;

  return (
    <>
      <StatusBar hidden={false} style="light" />
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{ headerShown: false }}
      >
        {/* Biometric Welcome Screen */}
        <Stack.Screen name="BiometricWelcome" component={BiometricWelcomeScreen} />

        {/* Welcome / landing screen — first thing users see */}
        <Stack.Screen name="Welcome" component={WelcomeScreen} />

        {/* 6-Digit SMS OTP Phone Authentication Flow */}
        <Stack.Screen name="PhoneAuth" component={PhoneAuthScreen} />
        <Stack.Screen name="OtpVerification" component={OtpVerificationScreen} />

        {/* Sign in */}
        <Stack.Screen name="SignIn" component={SignIn} />

        {/* Sign up */}
        <Stack.Screen name="SignUp" component={SignUp} />

        {/* Profile setup after registration */}
        <Stack.Screen
          name="User Details"
          component={UserDetails}
          options={{ title: "Your details" }}
        />

        {/* Business registration */}
        <Stack.Screen
          name="SellerApply"
          component={SellerApply}
          options={{ title: "Business registration", headerShown: false }}
        />
      </Stack.Navigator>
    </>
  );
};

export default AuthStack;
