import { StatusBar } from "expo-status-bar";
import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import RootNavigator from "./navigation/RootNavigator";
import { store } from "./store.js";
import { Provider } from "react-redux";
import { AuthContextProvder } from "./contexts/AuthContext";
import { NotificationProvider } from "./contexts/NotificationContext";
import { navigationRef } from "./navigation/RootNavigation";
import ErrorBoundary from "./components/ErrorBoundary";
import { PricingConfigSync } from "./utils/usePricingConfig";

export default function App() {
  return (
    <SafeAreaProvider>
    <ErrorBoundary>
      {/* navigationInChildEnabled keeps React Navigation 6 behaviour: navigate("X") also finds X inside nested navigators (tabs) */}
      <NavigationContainer ref={navigationRef} navigationInChildEnabled>
        <AuthContextProvder>
          <PricingConfigSync />
          <NotificationProvider>
            <Provider store={store}>
              <RootNavigator />
            </Provider>
          </NotificationProvider>
        </AuthContextProvder>
      </NavigationContainer>
    </ErrorBoundary>
    </SafeAreaProvider>
  );
}
