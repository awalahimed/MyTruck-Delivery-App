import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import CustomerTabNavigator from "./CustomerTabNavigator";
import RestaurantDetails from "../screens/RestaurantDetails";
import RestaurantsScreen from "../screens/RestaurantsScreen";
import ShopsScreen from "../screens/ShopsScreen";
import BasketScreen from "../screens/BasketScreen";
import UserDetails from "../screens/UserDetails";
import OptionsScreen from "../screens/OptionsScreen";
import OrderDetailsScreen from "../screens/OrderDetailsScreen";
import PreparingOrderScreen from "../screens/PreparingOrderScreen";
import ProductDeliveryScreen from "../screens/ProductDeliveryScreen";
import ProfileScreen from "../screens/ProfileScreen";
import DeliveryAddressesScreen from "../screens/DeliveryAddressesScreen";
import AdminDashboard from "../screens/AdminDashboard";
import SellerHome from "../screens/SellerHome";
import DriverDashboard from "../screens/DriverDashboard";
import NotificationCenterScreen from "../screens/NotificationCenterScreen";

const Stack = createNativeStackNavigator();

export default function AppStack({ initialRoute = "Home" }) {
  return (
    <Stack.Navigator
      initialRouteName={initialRoute}
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right",
      }}
    >
      {/* Root: bottom tab navigator */}
      <Stack.Screen
        name="Home"
        component={CustomerTabNavigator}
      />

      {/* Role-specific home screens */}
      <Stack.Screen
        name="SellerHome"
        component={SellerHome}
      />
      <Stack.Screen
        name="DriverDashboard"
        component={DriverDashboard}
      />

      {/* Main Feature Screens */}
      <Stack.Screen
        name="Restaurants"
        component={RestaurantsScreen}
      />
      <Stack.Screen
        name="Shops"
        component={ShopsScreen}
      />
      <Stack.Screen
        name="Restaurant"
        component={RestaurantDetails}
      />
      <Stack.Screen
        name="RestaurantDetails"
        component={RestaurantDetails}
      />
      <Stack.Screen
        name="Basket"
        component={BasketScreen}
        options={{ presentation: "modal" }}
      />
      <Stack.Screen
        name="PreparingOrderScreen"
        component={PreparingOrderScreen}
      />
      <Stack.Screen
        name="TrackOrder"
        component={PreparingOrderScreen}
      />
      <Stack.Screen
        name="Order Details"
        component={OrderDetailsScreen}
      />
      <Stack.Screen
        name="MyOrders"
        component={OrderDetailsScreen}
      />
      <Stack.Screen
        name="ProductDelivery"
        component={ProductDeliveryScreen}
      />

      {/* Profile & Settings Screens */}
      <Stack.Screen
        name="Profile"
        component={ProfileScreen}
      />
      <Stack.Screen
        name="DeliveryAddresses"
        component={DeliveryAddressesScreen}
      />
      <Stack.Screen
        name="User Details"
        component={UserDetails}
      />
      <Stack.Screen
        name="Options"
        component={OptionsScreen}
      />

      {/* Governance & Control Center */}
      <Stack.Screen
        name="AdminDashboard"
        component={AdminDashboard}
      />

      {/* Centralized Notification Center */}
      <Stack.Screen
        name="NotificationCenter"
        component={NotificationCenterScreen}
      />
    </Stack.Navigator>
  );
}
