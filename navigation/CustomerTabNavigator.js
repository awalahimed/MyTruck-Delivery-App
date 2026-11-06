import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Platform } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useSelector } from "react-redux";
import { selectBasketItems } from "../features/basketSlice";

import Home from "../screens/Home";
import OrderDetailsScreen from "../screens/OrderDetailsScreen";
import BasketScreen from "../screens/BasketScreen";
import OptionsScreen from "../screens/OptionsScreen";

const Tab = createBottomTabNavigator();

const TEAL = "#179B83";
const INACTIVE = "#64748B";

export default function CustomerTabNavigator() {
  const basketItems = useSelector(selectBasketItems);
  const basketCount = basketItems.length;

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: TEAL,
        tabBarInactiveTintColor: INACTIVE,
        tabBarStyle: {
          backgroundColor: "#FFFFFF",
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
          height: Platform.OS === "ios" ? 80 : 68,
          paddingBottom: Platform.OS === "ios" ? 22 : 10,
          paddingTop: 8,
          borderTopWidth: 1,
          borderTopColor: "#F1F5F9",
          elevation: 16,
          shadowColor: "#0B2A26",
          shadowOpacity: 0.12,
          shadowOffset: { width: 0, height: -3 },
          shadowRadius: 10,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "700",
          marginTop: -2,
        },
      }}
    >
      <Tab.Screen
        name="HomeTab"
        component={Home}
        options={{
          tabBarLabel: "Home",
          tabBarIcon: ({ color, size, focused }) => (
            <MaterialCommunityIcons
              name={focused ? "home" : "home-outline"}
              size={size + 2}
              color={color}
            />
          ),
        }}
      />
      <Tab.Screen
        name="OrdersTab"
        component={OrderDetailsScreen}
        options={{
          tabBarLabel: "Orders",
          tabBarIcon: ({ color, size, focused }) => (
            <MaterialCommunityIcons
              name={focused ? "clipboard-text" : "clipboard-text-outline"}
              size={size + 1}
              color={color}
            />
          ),
        }}
      />
      <Tab.Screen
        name="CartTab"
        component={BasketScreen}
        options={{
          tabBarLabel: "Cart",
          tabBarBadge: basketCount > 0 ? String(basketCount) : undefined,
          tabBarBadgeStyle: {
            backgroundColor: TEAL,
            color: "#FFFFFF",
            fontSize: 10,
            fontWeight: "800",
            minWidth: 18,
            height: 18,
            borderRadius: 9,
          },
          tabBarIcon: ({ color, size, focused }) => (
            <MaterialCommunityIcons
              name={focused ? "cart" : "cart-outline"}
              size={size + 2}
              color={color}
            />
          ),
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={OptionsScreen}
        options={{
          tabBarLabel: "Profile",
          tabBarIcon: ({ color, size, focused }) => (
            <MaterialCommunityIcons
              name={focused ? "account" : "account-outline"}
              size={size + 2}
              color={color}
            />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
