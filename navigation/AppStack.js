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
import { withRoleGate } from "../components/RoleGate";

const Stack = createNativeStackNavigator();

// Role dashboards are registered for everyone, so gate them (deep links, stray navigation)
const GatedSellerHome = withRoleGate(SellerHome, (r) => r.isSeller || r.isStaffAdmin, "Store partners");
const GatedDriverDashboard = withRoleGate(DriverDashboard, (r) => r.isDriver || r.isStaffAdmin, "Drivers");
const GatedAdminDashboard = withRoleGate(AdminDashboard, (r) => r.isStaffAdmin, "Administrators");

// Shopping, checkout and order tracking are for customers (staff may open them to support customers).
// Drivers and stores have their own dashboards; shared screens (profile, settings, notifications) stay open.
const forCustomers = (r) => r.isCustomer || r.isStaffAdmin;
const GatedCustomerTabs = withRoleGate(CustomerTabNavigator, forCustomers, "Customers");
const GatedRestaurants = withRoleGate(RestaurantsScreen, forCustomers, "Customers");
const GatedShops = withRoleGate(ShopsScreen, forCustomers, "Customers");
const GatedRestaurantDetails = withRoleGate(RestaurantDetails, forCustomers, "Customers");
const GatedBasket = withRoleGate(BasketScreen, forCustomers, "Customers");
const GatedTracking = withRoleGate(PreparingOrderScreen, forCustomers, "Customers");
const GatedMyOrders = withRoleGate(OrderDetailsScreen, forCustomers, "Customers");
const GatedProductDelivery = withRoleGate(ProductDeliveryScreen, forCustomers, "Customers");
const GatedDeliveryAddresses = withRoleGate(DeliveryAddressesScreen, forCustomers, "Customers");

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
        component={GatedCustomerTabs}
      />

      {/* Role-specific home screens */}
      <Stack.Screen
        name="SellerHome"
        component={GatedSellerHome}
      />
      <Stack.Screen
        name="DriverDashboard"
        component={GatedDriverDashboard}
      />

      {/* Main Feature Screens */}
      <Stack.Screen
        name="Restaurants"
        component={GatedRestaurants}
      />
      <Stack.Screen
        name="Shops"
        component={GatedShops}
      />
      <Stack.Screen
        name="Restaurant"
        component={GatedRestaurantDetails}
      />
      <Stack.Screen
        name="RestaurantDetails"
        component={GatedRestaurantDetails}
      />
      <Stack.Screen
        name="Basket"
        component={GatedBasket}
        options={{ presentation: "modal" }}
      />
      <Stack.Screen
        name="PreparingOrderScreen"
        component={GatedTracking}
      />
      <Stack.Screen
        name="TrackOrder"
        component={GatedTracking}
      />
      <Stack.Screen
        name="Order Details"
        component={GatedMyOrders}
      />
      <Stack.Screen
        name="MyOrders"
        component={GatedMyOrders}
      />
      <Stack.Screen
        name="ProductDelivery"
        component={GatedProductDelivery}
      />

      {/* Profile & Settings Screens */}
      <Stack.Screen
        name="Profile"
        component={ProfileScreen}
      />
      <Stack.Screen
        name="DeliveryAddresses"
        component={GatedDeliveryAddresses}
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
        component={GatedAdminDashboard}
      />

      {/* Centralized Notification Center */}
      <Stack.Screen
        name="NotificationCenter"
        component={NotificationCenterScreen}
      />
    </Stack.Navigator>
  );
}
