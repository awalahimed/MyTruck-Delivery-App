const fs = require("fs");
const parser = require("@babel/parser");

const files = [
  "screens/OptionsScreen.js",
  "screens/DeliveryAddressesScreen.js",
  "screens/Home.js",
  "screens/BasketScreen.js",
  "screens/UserDetails.js",
  "screens/ProfileScreen.js",
  "screens/PreparingOrderScreen.js",
  "screens/SellerApply.js",
  "screens/SignIn.js",
  "screens/SignUp.js",
  "screens/AdminDashboard.js",
  "components/InteractiveMapView.js",
  "components/DishInfo.js",
  "components/Order.js",
  "components/Search.js",
  "components/ui/Collapsible.js",
  "components/ui/SmartImage.js",
  "screens/PhoneVerificationGate.js",
  "screens/BiometricWelcomeScreen.js",
  "screens/PhoneAuthScreen.js",
  "screens/OtpVerificationScreen.js",
  "navigation/AuthStack.js",
  "services/biometricService.js",
  "screens/SellerHome.js",
  "screens/DriverDashboard.js",
  "screens/ShopsScreen.js",
  "screens/RestaurantsScreen.js",
  "components/DishRow.js",
  "components/ui/ResilientImage.js",
  "contexts/AuthContext.js",
  "contexts/NotificationContext.js"
];

for (const f of files) {
  try {
    const code = fs.readFileSync(f, "utf8");
    parser.parse(code, {
      sourceType: "module",
      plugins: ["jsx", "flow"]
    });
    console.log("✅ OK:", f);
  } catch (err) {
    console.error("❌ SYNTAX ERROR in", f, ":", err.message, "at line", err.loc?.line, "col", err.loc?.column);
  }
}

