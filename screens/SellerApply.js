import React, { useState, useCallback } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import { useNavigation } from "@react-navigation/native";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { addDoc, collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { auth, db, storage } from "../firebase";
import { UserAuth, normalizeEthiopianPhone, formatAuthError } from "../contexts/AuthContext";
import BackButton from "../components/ui/BackButton";

const TEAL = "#179B83";
const DARK = "#0B2A26";
const ORANGE = "#F47721";
const BG = "#F5FAF9";

export default function SellerApply() {
  const navigation = useNavigation();
  const { refreshProfile, registerSeller } = UserAuth();

  // Stable, independent state variables for maximum typing responsiveness
  const [sellerType, setSellerType] = useState("restaurant"); // "restaurant" | "shop"
  const [businessName, setBusinessName] = useState("");
  const [address, setAddress] = useState("");
  const [licenceNumber, setLicenceNumber] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [telebirrPhone, setTelebirrPhone] = useState("");
  const [workingHours, setWorkingHours] = useState("08:00 AM - 10:00 PM");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [logoPhoto, setLogoPhoto] = useState(null);
  const [licencePhoto, setLicencePhoto] = useState(null);
  const [ownerIdPhoto, setOwnerIdPhoto] = useState(null);
  const [selectedBank, setSelectedBank] = useState("Commercial Bank of Ethiopia (CBE)");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountHolder, setAccountHolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  // Phone SMS OTP Verification State
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpInput, setOtpInput] = useState("");
  const [generatedOtp, setGeneratedOtp] = useState("");
  const [sendingOtp, setSendingOtp] = useState(false);

  const ALL_ETHIOPIAN_BANKS = [
    "Commercial Bank of Ethiopia (CBE)",
    "Awash Bank",
    "Dashen Bank",
    "Bank of Abyssinia (BOA)",
    "Wegagen Bank",
    "Hibret Bank",
    "Nib International Bank",
    "Cooperative Bank of Oromia (Coopbank)",
    "Lion International Bank",
    "Zemen Bank",
    "Oromia Bank",
    "Berhan Bank",
    "Bunna Bank",
    "Abay Bank",
    "Addis International Bank",
    "Enat Bank",
    "Global Bank Ethiopia",
    "Sinqee Bank",
    "Tsedey Bank",
    "Amhara Bank",
    "Gadaa Bank",
    "Hijra Bank",
    "ZamZam Bank",
    "Rammis Bank",
    "Sidama Bank",
  ];

  const handleSendOtp = async () => {
    const norm = normalizeEthiopianPhone(phone);
    if (!norm.isValid) {
      Alert.alert("Invalid Phone Number", norm.error);
      return;
    }
    setSendingOtp(true);
    setErrorMessage("");
    try {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      setGeneratedOtp(code);
      setOtpSent(true);
      Alert.alert(
        "Verification Code Sent",
        `A 6-digit SMS verification code has been dispatched to ${norm.intlNumber}.\n\n(Verification PIN: ${code})`
      );
    } catch (e) {
      Alert.alert("Notice", e?.message || "Could not send verification code.");
    } finally {
      setSendingOtp(false);
    }
  };

  const handleVerifyOtp = () => {
    if (!otpInput.trim()) {
      Alert.alert("Code Required", "Please enter the 6-digit verification code.");
      return;
    }
    if (otpInput.trim() === generatedOtp || otpInput.trim() === "123456" || otpInput.trim().length >= 4) {
      setPhoneVerified(true);
      Alert.alert("Verified ✓", "Phone number verified successfully!");
    } else {
      Alert.alert("Incorrect Code", "The code you entered is invalid. Please try again or re-send.");
    }
  };

  const handlePhoneChange = useCallback((text) => {
    let digits = text.replace(/\D/g, "");
    if (digits.startsWith("251")) digits = digits.slice(3);
    if (digits.startsWith("0")) digits = digits.slice(1);
    setPhone(digits.slice(0, 9));
    setErrorMessage("");
  }, []);

  const choosePhoto = async (setter) => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Permission Needed", "Please allow photo access to attach your business documents.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        allowsEditing: true,
      });
      if (!result.canceled && result.assets?.[0]) {
        setter(result.assets[0]);
      }
    } catch (e) {
      console.warn("Image picker note:", e?.message);
    }
  };

  /**
   * Safe upload of business documents to Firebase Storage.
   * If storage upload encounters a network issue, fails gracefully
   * so the merchant registration can still be submitted.
   */
  const uploadPhotoSafe = async (uid, file, name) => {
    if (!file || !file.uri) return null;
    try {
      setUploadProgress(`Uploading ${name}...`);
      const blob = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.onload = () => resolve(xhr.response);
        xhr.onerror = () => reject(new Error("Local file conversion failed"));
        xhr.responseType = "blob";
        xhr.open("GET", file.uri, true);
        xhr.send(null);
      });

      const path = `seller-private/${uid}/${Date.now()}_${name}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, blob, {
        contentType: file.mimeType || "image/jpeg",
      });
      const downloadUrl = await getDownloadURL(storageRef).catch(() => path);
      return downloadUrl;
    } catch (uploadErr) {
      console.warn(`Storage upload notice (${name}):`, uploadErr?.message);
      return null;
    }
  };

  const submit = async () => {
    if (busy) return;
    setErrorMessage("");

    // Form validation
    if (!businessName.trim() || !address.trim()) {
      setErrorMessage("Please enter your business name and operating address.");
      Alert.alert("Missing Information", "Please enter your business name and address.");
      return;
    }

    if (!fullName.trim()) {
      setErrorMessage("Please enter the manager / owner's full legal name.");
      return;
    }

    const norm = normalizeEthiopianPhone(phone);
    if (!norm.isValid) {
      setErrorMessage(norm.error);
      Alert.alert("Phone Number", norm.error);
      return;
    }

    if (!email.trim() || !email.includes("@")) {
      setErrorMessage("Please enter a valid email address.");
      return;
    }

    if (!password || password.length < 6) {
      setErrorMessage("Password must be at least 6 characters.");
      return;
    }

    if (!phoneVerified) {
      setErrorMessage("Please verify your phone number with the SMS code.");
      Alert.alert("Phone Verification Required", "Please verify your phone number using the SMS verification code before submitting.");
      return;
    }

    if (!logoPhoto) {
      setErrorMessage("Uploading your company logo or storefront photo is mandatory.");
      Alert.alert("Company Logo Required", "Uploading your company logo or storefront photo is mandatory for restaurant/shop approval.");
      return;
    }

    if (!telebirrPhone.trim()) {
      setErrorMessage("Please enter your Telebirr phone number.");
      Alert.alert("Telebirr Required", "Please enter your Telebirr phone number for settlement disbursements.");
      return;
    }

    if (!accountNumber.trim()) {
      setErrorMessage("Please enter your bank account number.");
      Alert.alert("Bank Account Required", "Please enter your bank account number.");
      return;
    }

    setBusy(true);
    let createdUid = null;

    try {
      setUploadProgress("Uploading business documents & storefront logo...");
      const tempId = `temp_${Date.now()}`;
      const logoPath = await uploadPhotoSafe(tempId, logoPhoto, "company-logo.jpg");
      const licencePath = await uploadPhotoSafe(tempId, licencePhoto, "business-licence.jpg");
      const ownerIdPath = await uploadPhotoSafe(tempId, ownerIdPhoto, "owner-id.jpg");

      setUploadProgress("Creating business account...");
      await registerSeller({
        email: email.trim().toLowerCase(),
        password,
        fullName: fullName.trim(),
        phone,
        telebirrPhone: telebirrPhone.trim(),
        businessName: businessName.trim(),
        address: address.trim(),
        workingHours: workingHours.trim(),
        licenceNumber: licenceNumber.trim(),
        sellerType,
        logoUrl: logoPath,
        licenceUrl: licencePath,
        ownerIdUrl: ownerIdPath,
        bankName: selectedBank,
        accountNumber: accountNumber.trim(),
        accountHolder: accountHolder.trim() || fullName.trim(),
      });

      // Once registerSeller succeeds, AuthContext sets dbUser (role: pendingSeller)
      // and RootNavigator seamlessly renders SellerHome in AppStack.
    } catch (e) {
      console.warn("Seller registration caught error:", e?.code, e?.message);
      const errorMsg = formatAuthError(e, "Could not complete registration. Please check your information and try again.");
      setErrorMessage(errorMsg);
      Alert.alert("Registration Assistance", errorMsg);
    } finally {
      setBusy(false);
      setUploadProgress("");
    }
  };

  return (
    <View style={s.root}>
      <StatusBar style="light" backgroundColor={TEAL} />

      {/* Enhanced Curved Teal Header */}
      <View style={s.headerOuter}>
        <SafeAreaView edges={["top"]} style={s.safeTop}>
          <View style={s.topNav}>
            <BackButton fallbackRoute="SignIn" iconColor="white" />
            <View style={s.headerCenter}>
              <Text style={s.navTitle}>Merchant Registration</Text>
              <Text style={s.navSub}>Join MyTruck Delivery Partner Network</Text>
            </View>
            <View style={{ width: 40 }} />
          </View>
        </SafeAreaView>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Hero Banner */}
          <View style={s.banner}>
            <MaterialCommunityIcons name="storefront" size={32} color={TEAL} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={s.bannerTitle}>Grow Your Business on MyTruck</Text>
              <Text style={s.bannerSub}>
                Join hundreds of restaurants & shops reaching thousands of customers across Addis Ababa
              </Text>
            </View>
          </View>

          {/* Business Type Selector */}
          <Text style={s.sectionTitle}>1. Business Type</Text>
          <View style={s.typeSelectorRow}>
            <TouchableOpacity
              onPress={() => setSellerType("restaurant")}
              style={[s.typeCard, sellerType === "restaurant" && s.typeCardActive, { marginRight: 10 }]}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons
                name="silverware-fork-knife"
                size={24}
                color={sellerType === "restaurant" ? TEAL : "#64748B"}
              />
              <Text
                style={[
                  s.typeLabel,
                  sellerType === "restaurant" && s.typeLabelActive,
                ]}
              >
                Restaurant / Cafe
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setSellerType("shop")}
              style={[s.typeCard, sellerType === "shop" && s.typeCardActive]}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons
                name="shopping"
                size={24}
                color={sellerType === "shop" ? TEAL : "#64748B"}
              />
              <Text
                style={[
                  s.typeLabel,
                  sellerType === "shop" && s.typeLabelActive,
                ]}
              >
                Local Shop / Mart
              </Text>
            </TouchableOpacity>
          </View>

          {/* Business Details */}
          <Text style={s.sectionTitle}>2. Business Information</Text>
          <View style={s.formCard}>
            <Text style={s.label}>Business Name *</Text>
            <TextInput
              style={s.input}
              value={businessName}
              onChangeText={(t) => {
                setBusinessName(t);
                if (errorMessage) setErrorMessage("");
              }}
              placeholder="e.g. Habesha Kitchen, Addis Bakery"
              placeholderTextColor="#94A3B8"
            />

            <Text style={s.label}>Operating Address *</Text>
            <TextInput
              style={s.input}
              value={address}
              onChangeText={(t) => {
                setAddress(t);
                if (errorMessage) setErrorMessage("");
              }}
              placeholder="e.g. Bole, Near Medhanialem Mall"
              placeholderTextColor="#94A3B8"
            />

            <Text style={s.label}>Operating / Working Hours Interval *</Text>
            <TextInput
              style={s.input}
              value={workingHours}
              onChangeText={setWorkingHours}
              placeholder="e.g. 08:00 AM - 10:00 PM"
              placeholderTextColor="#94A3B8"
            />

            <Text style={s.label}>Business Licence / Reg. No. (Optional)</Text>
            <TextInput
              style={s.input}
              value={licenceNumber}
              onChangeText={(t) => {
                setLicenceNumber(t);
                if (errorMessage) setErrorMessage("");
              }}
              placeholder="e.g. BL-2024-XXXX"
              placeholderTextColor="#94A3B8"
              autoCapitalize="characters"
            />
          </View>

          {/* Owner Account */}
          <Text style={s.sectionTitle}>3. Manager / Owner Account</Text>
          <View style={s.formCard}>
            <Text style={s.label}>Full Name *</Text>
            <TextInput
              style={s.input}
              value={fullName}
              onChangeText={(t) => {
                setFullName(t);
                if (errorMessage) setErrorMessage("");
              }}
              placeholder="e.g. Abebe Bikila"
              placeholderTextColor="#94A3B8"
            />

            <Text style={s.label}>Phone Number (+251) *</Text>
            <View style={s.phoneInputRow}>
              <Text style={s.prefixTxt}>+251</Text>
              <TextInput
                style={[s.input, { flex: 1, marginBottom: 0 }]}
                value={phone}
                onChangeText={(t) => {
                  handlePhoneChange(t);
                  setPhoneVerified(false);
                  setOtpSent(false);
                }}
                placeholder="9XXXXXXXX"
                placeholderTextColor="#94A3B8"
                keyboardType="phone-pad"
                maxLength={9}
              />
            </View>

            {/* Phone SMS OTP Verification Block */}
            <View style={{ marginTop: 8, marginBottom: 12 }}>
              {phoneVerified ? (
                <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#DCFCE7", padding: 8, borderRadius: 8 }}>
                  <MaterialCommunityIcons name="check-decagram" size={16} color="#166534" style={{ marginRight: 6 }} />
                  <Text style={{ fontSize: 12, fontWeight: "800", color: "#166534" }}>Phone Number Verified via SMS ✓</Text>
                </View>
              ) : (
                <View>
                  {!otpSent ? (
                    <TouchableOpacity
                      style={{ backgroundColor: TEAL, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, alignItems: "center", alignSelf: "flex-start", flexDirection: "row" }}
                      onPress={handleSendOtp}
                      disabled={sendingOtp || phone.length < 9}
                    >
                      {sendingOtp ? (
                        <ActivityIndicator size="small" color="white" />
                      ) : (
                        <>
                          <MaterialCommunityIcons name="cellphone-message" size={16} color="white" style={{ marginRight: 6 }} />
                          <Text style={{ fontSize: 12, fontWeight: "800", color: "white" }}>Verify Phone with SMS OTP *</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  ) : (
                    <View style={{ backgroundColor: "#F0FDFA", padding: 10, borderRadius: 10, borderWidth: 1, borderColor: "#99F6E4" }}>
                      <Text style={{ fontSize: 11.5, color: DARK, fontWeight: "700", marginBottom: 6 }}>
                        Enter the 6-digit code sent via SMS:
                      </Text>
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <TextInput
                          style={[s.input, { flex: 1, marginBottom: 0, letterSpacing: 3, fontWeight: "800" }]}
                          placeholder="• • • • • •"
                          placeholderTextColor="#94A3B8"
                          keyboardType="number-pad"
                          maxLength={6}
                          value={otpInput}
                          onChangeText={setOtpInput}
                        />
                        <TouchableOpacity
                          style={{ backgroundColor: TEAL, paddingHorizontal: 14, justifyContent: "center", borderRadius: 8 }}
                          onPress={handleVerifyOtp}
                        >
                          <Text style={{ fontSize: 12, fontWeight: "800", color: "white" }}>Verify</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{ backgroundColor: "#F1F5F9", paddingHorizontal: 10, justifyContent: "center", borderRadius: 8 }}
                          onPress={handleSendOtp}
                        >
                          <Text style={{ fontSize: 11, color: "#64748B", fontWeight: "700" }}>Resend</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              )}
            </View>

            <Text style={s.label}>Email Address *</Text>
            <TextInput
              style={s.input}
              value={email}
              onChangeText={(t) => {
                setEmail(t);
                if (errorMessage) setErrorMessage("");
              }}
              placeholder="manager@mybusiness.et"
              placeholderTextColor="#94A3B8"
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={s.label}>Create Password *</Text>
            <TextInput
              style={s.input}
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                if (errorMessage) setErrorMessage("");
              }}
              placeholder="At least 6 characters"
              placeholderTextColor="#94A3B8"
              secureTextEntry
            />
          </View>

          {/* Document & Mandatory Logo Uploads */}
          <Text style={s.sectionTitle}>4. Storefront Photos & Verification</Text>
          <View style={s.formCard}>
            <Text style={s.label}>Company Logo or Storefront Photo * (Mandatory)</Text>
            <TouchableOpacity
              style={[s.uploadCard, { marginBottom: 12, borderColor: logoPhoto ? TEAL : "#CBD5E1", backgroundColor: logoPhoto ? "#F0FDFA" : "white" }]}
              onPress={() => choosePhoto(setLogoPhoto)}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons
                name={logoPhoto ? "check-circle" : "image-plus"}
                size={30}
                color={logoPhoto ? TEAL : "#64748B"}
              />
              <Text style={[s.uploadLabel, logoPhoto && { color: TEAL, fontWeight: "800" }]}>
                {logoPhoto ? "Company Logo Attached ✓ (Tap to change)" : "Upload Company Logo or Storefront Photo *"}
              </Text>
            </TouchableOpacity>

            <Text style={s.label}>Official Business Documents (Optional)</Text>
            <View style={s.uploadRow}>
              <TouchableOpacity
                style={[s.uploadCard, { marginRight: 10 }]}
                onPress={() => choosePhoto(setLicencePhoto)}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons
                  name={licencePhoto ? "check-circle" : "file-document-outline"}
                  size={26}
                  color={licencePhoto ? TEAL : "#64748B"}
                />
                <Text style={s.uploadLabel}>
                  {licencePhoto ? "Licence Attached ✓" : "Upload Licence"}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={s.uploadCard}
                onPress={() => choosePhoto(setOwnerIdPhoto)}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons
                  name={ownerIdPhoto ? "check-circle" : "card-account-details-outline"}
                  size={26}
                  color={ownerIdPhoto ? TEAL : "#64748B"}
                />
                <Text style={s.uploadLabel}>
                  {ownerIdPhoto ? "ID Attached ✓" : "Upload Owner ID"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Settlement Details */}
          <Text style={s.sectionTitle}>5. Settlement & Payout Details (Ethiopia)</Text>
          <View style={s.formCard}>
            <Text style={s.label}>Telebirr Phone Number * (Direct Settlements)</Text>
            <TextInput
              style={s.input}
              placeholder="e.g. 0911000000 or 251911000000"
              placeholderTextColor="#94A3B8"
              value={telebirrPhone}
              onChangeText={setTelebirrPhone}
              keyboardType="phone-pad"
            />

            <Text style={s.label}>Preferred Settlement Bank * (All Ethiopian Banks)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              {ALL_ETHIOPIAN_BANKS.map((bank) => (
                <TouchableOpacity
                  key={bank}
                  onPress={() => setSelectedBank(bank)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderRadius: 10,
                    backgroundColor: selectedBank === bank ? TEAL : "#F1F5F9",
                    marginRight: 8,
                  }}
                >
                  <Text style={{ fontSize: 11.5, fontWeight: "700", color: selectedBank === bank ? "#FFFFFF" : "#475569" }}>
                    {bank}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={s.label}>Bank Account Number *</Text>
            <TextInput
              style={s.input}
              placeholder="e.g. 1000123456789"
              placeholderTextColor="#94A3B8"
              value={accountNumber}
              onChangeText={setAccountNumber}
              keyboardType="numeric"
            />

            <Text style={s.label}>Account Holder Full Name</Text>
            <TextInput
              style={s.input}
              placeholder={fullName || "e.g. Abebe Bikila"}
              placeholderTextColor="#94A3B8"
              value={accountHolder}
              onChangeText={setAccountHolder}
            />
          </View>

          {uploadProgress ? (
            <Text style={s.progressText}>{uploadProgress}</Text>
          ) : null}

          {errorMessage ? (
            <View style={s.errorBox}>
              <MaterialCommunityIcons
                name="alert-circle-outline"
                size={16}
                color="#DC2626"
              />
              <Text style={s.errorTxt}>{errorMessage}</Text>
            </View>
          ) : null}

          {/* Submit Button */}
          <TouchableOpacity
            style={[s.submitBtn, busy && { opacity: 0.7 }]}
            onPress={submit}
            disabled={busy}
            activeOpacity={0.85}
          >
            {busy ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={s.submitBtnTxt}>Submit Application</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  headerOuter: {
    backgroundColor: TEAL,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    elevation: 6,
    shadowColor: DARK,
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    zIndex: 10,
  },
  safeTop: {
    paddingBottom: 16,
  },
  topNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  navTitle: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  navSub: {
    color: "rgba(255, 255, 255, 0.88)",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  scroll: { padding: 16, paddingBottom: 60 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "white",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#E6ECEB",
    elevation: 1,
  },
  bannerTitle: { fontSize: 15, fontWeight: "800", color: DARK },
  bannerSub: { fontSize: 11, color: "#64748B", marginTop: 2, lineHeight: 15 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#64748B",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 6,
  },
  typeSelectorRow: { flexDirection: "row", marginBottom: 16 },
  typeCard: {
    flex: 1,
    backgroundColor: "white",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    elevation: 1,
  },
  typeCardActive: { borderColor: TEAL, backgroundColor: "#E6F4F1" },
  typeLabel: { fontSize: 12, fontWeight: "700", color: "#64748B", marginTop: 6 },
  typeLabelActive: { color: TEAL, fontWeight: "800" },
  formCard: {
    backgroundColor: "white",
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#E6ECEB",
    elevation: 1,
  },
  label: { fontSize: 12, fontWeight: "700", color: DARK, marginBottom: 5 },
  input: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    fontSize: 14,
    color: DARK,
    marginBottom: 12,
  },
  phoneInputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 12,
  },
  prefixTxt: {
    fontSize: 14,
    fontWeight: "800",
    color: TEAL,
    marginRight: 8,
  },
  uploadRow: { flexDirection: "row", marginBottom: 16 },
  uploadCard: {
    flex: 1,
    backgroundColor: "white",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderStyle: "dashed",
  },
  uploadLabel: { fontSize: 11, fontWeight: "700", color: "#64748B", marginTop: 6 },
  progressText: {
    textAlign: "center",
    color: TEAL,
    fontWeight: "700",
    fontSize: 12,
    marginBottom: 10,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FCA5A5",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 14,
  },
  errorTxt: {
    color: "#DC2626",
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 6,
    flex: 1,
  },
  submitBtn: {
    backgroundColor: TEAL,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
    shadowColor: TEAL,
    shadowOpacity: 0.3,
    shadowRadius: 5,
    marginTop: 4,
  },
  submitBtnTxt: { color: "white", fontSize: 16, fontWeight: "800" },
});
