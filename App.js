import { StatusBar } from "expo-status-bar";
import React from "react";
import { NavigationContainer } from "@react-navigation/native";
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
    <ErrorBoundary>
      <NavigationContainer ref={navigationRef}>
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
  );
}
