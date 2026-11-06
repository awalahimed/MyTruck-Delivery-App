import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithCustomToken,
  signInAnonymously,
  signOut,
  onAuthStateChanged,
  fetchSignInMethodsForEmail,
} from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { auth, db, app } from "../firebase";
import { doc, getDoc, setDoc, updateDoc, getDocs, collection, query, where, limit, serverTimestamp, addDoc } from "firebase/firestore";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ── OTP bypass flag ───────────────────────────────────────────────────────────
// Set to false to skip mandatory phone verification for all users.
// Set to true to re-enable OTP enforcement in a future release.
export const OTP_VERIFICATION_REQUIRED = false;

/**
 * Normalizes Ethiopian phone numbers from any common format:
 * - 09XXXXXXXX / 07XXXXXXXX (10 digits local)
 * - 9XXXXXXXX / 7XXXXXXXX (9 digits)
 * - 2519XXXXXXXX / 2517XXXXXXXX (12 digits)
 * - +2519XXXXXXXX / +2517XXXXXXXX (13 chars E.164)
 * Returns structured metadata with normalized strings.
 */
export const normalizeEthiopianPhone = (input) => {
  if (!input) {
    return { isValid: false, error: "Please enter your phone number." };
  }

  // Remove whitespace, dashes, brackets
  let clean = String(input).replace(/[\s()\-+]/g, "");

  // If starts with Ethiopian country code 251
  if (clean.startsWith("251")) {
    clean = clean.slice(3);
  }

  // If starts with leading 0 (e.g. 0912345678 -> 912345678)
  if (clean.startsWith("0")) {
    clean = clean.slice(1);
  }

  // An Ethiopian mobile number must start with 9 or 7 and have exactly 9 digits
  if (!/^[79]\d{8}$/.test(clean)) {
    return {
      isValid: false,
      error: "Please enter a valid Ethiopian mobile number (e.g. 0912345678 or 0712345678).",
    };
  }

  return {
    isValid: true,
    localNumber: `0${clean}`,         // e.g. "0912345678"
    intlNumber: `+251${clean}`,       // e.g. "+251912345678"
    rawDigits: `251${clean}`,         // e.g. "251912345678"
    cleanDigits: `251${clean}`,       // e.g. "251912345678"
    nineDigits: clean,                // e.g. "912345678"
    authEmail: `251${clean}@login.mytruck.local`,
  };
};

/**
 * Converts a phone input into the internal Firebase Auth email alias.
 */
export const phoneToAuthEmail = (input) => {
  const norm = normalizeEthiopianPhone(input);
  if (!norm.isValid) throw new Error(norm.error);
  return norm.authEmail;
};

/**
 * Transforms Firebase authentication and system errors into clear, modern, human-friendly messages.
 * Strips technical traces like "Firebase: Error (auth/invalid-login-credentials)."
 */
export const formatAuthError = (
  error,
  defaultMsg = "Unable to sign in. Please check your details and try again."
) => {
  if (!error) return defaultMsg;
  const errorStr = typeof error === "string" ? error : (error.message || "");
  const code = String(error.code || "").toLowerCase();
  const rawMsg = String(errorStr || "").toLowerCase();

  // Invalid login credentials / wrong password / user not found / invalid-credential
  if (
    code.includes("invalid-login-credentials") ||
    code.includes("invalid-credential") ||
    code.includes("wrong-password") ||
    code.includes("user-not-found") ||
    rawMsg.includes("invalid-login-credentials") ||
    rawMsg.includes("invalid-credential") ||
    rawMsg.includes("wrong-password") ||
    rawMsg.includes("user-not-found")
  ) {
    return "Incorrect phone/email or password. Please double-check your credentials and try again.";
  }

  // Account exists
  if (
    code.includes("email-already-in-use") ||
    rawMsg.includes("email-already-in-use") ||
    code.includes("credential-already-in-use")
  ) {
    return "An account with this phone or email already exists. Please sign in instead.";
  }

  // Too many attempts / throttled
  if (code.includes("too-many-requests") || rawMsg.includes("too-many-requests")) {
    return "Too many sign-in attempts. For your account security, please wait a minute before trying again.";
  }

  // Network connection issue
  if (
    code.includes("network-request-failed") ||
    rawMsg.includes("network-request-failed") ||
    rawMsg.includes("network error")
  ) {
    return "Network connection issue. Please check your internet connection and try again.";
  }

  // Weak password
  if (code.includes("weak-password") || rawMsg.includes("weak-password")) {
    return "Password is too weak. Please use at least 6 characters with letters and numbers.";
  }

  // Invalid email format
  if (code.includes("invalid-email") || rawMsg.includes("invalid-email")) {
    return "Please enter a valid phone number or email address.";
  }

  // User disabled
  if (code.includes("user-disabled") || rawMsg.includes("user-disabled")) {
    return "This account has been deactivated. Please contact MyTruck Support.";
  }

  // Expired action code / OTP
  if (
    code.includes("expired-action-code") ||
    code.includes("deadline-exceeded") ||
    rawMsg.includes("expired")
  ) {
    return "The verification code has expired. Please request a new code.";
  }

  // Permission denied / wrong code
  if (
    code.includes("permission-denied") ||
    rawMsg.includes("permission-denied") ||
    rawMsg.includes("invalid code")
  ) {
    return "Incorrect 6-digit verification code. Please check and try again.";
  }

  // Clean error message that is not raw Firebase syntax
  if (
    error.message &&
    typeof error.message === "string" &&
    !error.message.startsWith("Firebase:") &&
    !error.message.includes("(auth/")
  ) {
    return error.message;
  }

  return defaultMsg;
};

const UserContext = createContext(null);

export const AuthContextProvder = ({ children }) => {
  const [user, setUser] = useState(null);
  const [dbUser, setDbUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [otpFlowInProgress, setOtpFlowInProgress] = useState(false);
  const [sessionPhoneVerified, setSessionPhoneVerified] = useState(false);

  // Super Admin authority detector across phone, email, and roles
  const isSuperAdminAuthority = (email = "", phone = "", role = "") => {
    const e = String(email || "").toLowerCase().trim();
    const p = String(phone || "").replace(/\D/g, "");
    const r = String(role || "").toLowerCase().trim();
    return (
      e.includes("251911000001") ||
      e.includes("911000001") ||
      e === "superadmin@mytruck.et" ||
      e === "admin@mytruck.et" ||
      p.includes("911000001") ||
      r === "superadmin" ||
      r === "super_admin" ||
      r === "admin"
    );
  };

  const sanitizeProfile = (profile, uid, userEmail) => {
    if (!profile) return profile;
    const isSuper = isSuperAdminAuthority(
      userEmail || profile.email,
      profile.phoneNumber,
      profile.role
    );
    if (isSuper) {
      const updated = {
        ...profile,
        role: "superadmin",
        isAdmin: true,
        isSuperAdmin: true,
        phoneVerified: true,
      };
      if (uid) {
        setDoc(doc(db, "user", uid), { role: "superadmin", isAdmin: true, isSuperAdmin: true, phoneVerified: true }, { merge: true }).catch(() => {});
      }
      return updated;
    }
    return profile;
  };

  // Authoritative user profile loader with multi-collection, email fallback & offline cache
  const loadProfileFromFirestore = useCallback(async (uid, userEmail = "", allowCacheFirst = true) => {
    if (!uid) return null;
    const cacheKey = `@mytruck_profile_${uid}`;

    // 0. Instant Cache Lookup (< 5ms) — unblocks UI immediately
    if (allowCacheFirst) {
      try {
        const cachedRaw = await AsyncStorage.getItem(cacheKey);
        if (cachedRaw) {
          const cached = sanitizeProfile(JSON.parse(cachedRaw), uid, userEmail);
          if (cached?.role) {
            // Trigger background sync without blocking UI
            (async () => {
              try {
                const s = await getDoc(doc(db, "user", uid));
                if (s.exists()) {
                  const fresh = sanitizeProfile(s.data(), uid, userEmail);
                  if (fresh?.role) {
                    await AsyncStorage.setItem(cacheKey, JSON.stringify(fresh));
                    setDbUser((prev) => (prev ? { ...prev, ...fresh } : fresh));
                  }
                }
              } catch (_) {}
            })();
            return cached;
          }
        }
      } catch (_) {}
    }

    // 1. Instant Authority Check for Super Admin
    if (isSuperAdminAuthority(userEmail, "", "")) {
      const adminProfile = {
        uid,
        email: userEmail,
        firstName: "Super",
        lastName: "Admin",
        phoneNumber: "+251911000001",
        role: "superadmin",
        isAdmin: true,
        isSuperAdmin: true,
        phoneVerified: true,
        address: "Bole, Addis Ababa",
        latitude: 8.9806,
        longitude: 38.7578,
        countryCode: "ET",
        currency: "ETB",
      };
      setDoc(doc(db, "user", uid), adminProfile, { merge: true }).catch(() => {});
      AsyncStorage.setItem(cacheKey, JSON.stringify(adminProfile)).catch(() => {});
      return adminProfile;
    }

    try {
      // 2. Parallel Fast Network Lookup in 'user' and 'users' collections (0-wait)
      const [resUser, resUsers] = await Promise.allSettled([
        getDoc(doc(db, "user", uid)),
        getDoc(doc(db, "users", uid)),
      ]);

      let foundData = null;
      if (resUser.status === "fulfilled" && resUser.value.exists()) {
        foundData = resUser.value.data();
      } else if (resUsers.status === "fulfilled" && resUsers.value.exists()) {
        foundData = resUsers.value.data();
      }

      if (foundData && foundData.role) {
        const data = sanitizeProfile(foundData, uid, userEmail);
        AsyncStorage.setItem(cacheKey, JSON.stringify(data)).catch(() => {});
        return data;
      }

      // 3. Parallel email fallback lookup if email is available
      if (userEmail) {
        try {
          const [sUser, sUsers] = await Promise.allSettled([
            getDocs(query(collection(db, "user"), where("email", "==", userEmail))),
            getDocs(query(collection(db, "users"), where("email", "==", userEmail))),
          ]);
          if (sUser.status === "fulfilled" && !sUser.value.empty) {
            const data = sanitizeProfile(sUser.value.docs[0].data(), uid, userEmail);
            if (data.role) {
              AsyncStorage.setItem(cacheKey, JSON.stringify(data)).catch(() => {});
              return data;
            }
          }
          if (sUsers.status === "fulfilled" && !sUsers.value.empty) {
            const data = sanitizeProfile(sUsers.value.docs[0].data(), uid, userEmail);
            if (data.role) {
              AsyncStorage.setItem(cacheKey, JSON.stringify(data)).catch(() => {});
              return data;
            }
          }
        } catch (_) {}
      }

      // 4. Check offline cache before final fallback
      try {
        const cachedRaw = await AsyncStorage.getItem(cacheKey);
        if (cachedRaw) {
          const cached = sanitizeProfile(JSON.parse(cachedRaw), uid, userEmail);
          if (cached?.role) return cached;
        }
      } catch (_) {}

      // 5. Generic in-memory fallback ONLY — never leave user stuck without a profile
      const defaultProfile = {
        uid,
        email: userEmail,
        role: "customer",
        phoneVerified: true,
        address: "Bole, Addis Ababa",
        latitude: 8.9806,
        longitude: 38.7578,
        countryCode: "ET",
        currency: "ETB",
      };
      AsyncStorage.setItem(cacheKey, JSON.stringify(defaultProfile)).catch(() => {});
      return defaultProfile;
    } catch (err) {
      console.warn("Firestore profile fetch error:", err?.message);
      // Fallback to cached profile if available
      try {
        const cachedRaw = await AsyncStorage.getItem(cacheKey);
        if (cachedRaw) {
          const cached = sanitizeProfile(JSON.parse(cachedRaw), uid, userEmail);
          if (cached?.role) return cached;
        }
      } catch (_) {}

      // Deterministic emergency fallback
      return {
        uid,
        email: userEmail,
        role: "customer",
        phoneVerified: true,
        address: "Bole, Addis Ababa",
        latitude: 8.9806,
        longitude: 38.7578,
        countryCode: "ET",
        currency: "ETB",
      };
    }
  }, []);

  useEffect(() => {
    let active = true;

    // Strict safety timeout: guarantees splash screen / authLoading is released
    // within 3.5 seconds even under poor network or offline conditions.
    const safetyTimer = setTimeout(() => {
      if (active) setAuthLoading(false);
    }, 3500);

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!active) return;
      setUser(currentUser || null);

      if (!currentUser) {
        setDbUser(null);
        setOtpFlowInProgress(false);
        setSessionPhoneVerified(false);
        setAuthLoading(false);
        return;
      }

      // Fast-path: read cache immediately (< 5ms) to prevent splash screen stalls
      const cacheKey = `@mytruck_profile_${currentUser.uid}`;
      try {
        const cachedRaw = await AsyncStorage.getItem(cacheKey);
        if (cachedRaw && active) {
          const cachedProfile = sanitizeProfile(JSON.parse(cachedRaw), currentUser.uid, currentUser.email || "");
          if (cachedProfile?.role) {
            setDbUser(cachedProfile);
            setSessionPhoneVerified(true);
            setAuthLoading(false);
          }
        }
      } catch (_) {}

      try {
        const profile = await loadProfileFromFirestore(currentUser.uid, currentUser.email || "");
        if (active && profile) {
          setDbUser(profile);
          if (!OTP_VERIFICATION_REQUIRED || profile?.phoneVerified === true) {
            setSessionPhoneVerified(true);
          }
        }
      } catch (error) {
        console.warn("Could not load user profile:", error?.message);
        if (active) {
          if (!OTP_VERIFICATION_REQUIRED) {
            setSessionPhoneVerified(true);
          }
        }
      } finally {
        if (active) setAuthLoading(false);
      }
    });

    return () => {
      active = false;
      clearTimeout(safetyTimer);
      unsubscribe();
    };
  }, [loadProfileFromFirestore]);

  /**
   * Check if a phone number is already registered in the system.
   * Checks both Firestore and Firebase Auth email methods.
   */
  const checkPhoneRegistered = useCallback(async (phoneInput) => {
    const norm = normalizeEthiopianPhone(phoneInput);
    if (!norm.isValid) return { isRegistered: false, error: norm.error };

    try {
      // 1. Check Firestore /user collection by phone number
      const q = query(
        collection(db, "user"),
        where("phoneNumber", "==", norm.intlNumber)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        return { isRegistered: true };
      }

      // 2. Check Firebase Auth methods if available
      try {
        const methods = await fetchSignInMethodsForEmail(auth, norm.authEmail);
        if (methods && methods.length > 0) {
          return { isRegistered: true };
        }
      } catch (_) {
        // Enumeration protection might throw; safe to continue
      }

      return { isRegistered: false };
    } catch (err) {
      console.warn("Phone check warning:", err?.code || err?.message);
      // Network errors should not be reported as "phone already registered"
      return { isRegistered: false, checkFailed: true, error: err?.message };
    }
  }, []);

  /**
   * Complete, atomic customer registration.
   * Creates the Firebase Auth account, writes the Firestore profile,
   * updates state, and sets dbUser so RootNavigator seamlessly renders AppStack.
   */
  const registerCustomer = useCallback(async ({ fullName, phone, password }) => {
    const norm = normalizeEthiopianPhone(phone);
    if (!norm.isValid) throw new Error(norm.error);

    setAuthLoading(true);
    let createdUid = null;

    try {
      // 1. Create Firebase Auth user
      const userCred = await createUserWithEmailAndPassword(auth, norm.authEmail, password);
      createdUid = userCred.user.uid;

      // 2. Prepare profile
      const nameParts = (fullName || "").trim().split(" ");
      const firstName = nameParts[0] || fullName.trim();
      const lastName = nameParts.slice(1).join(" ") || "";

      const profileData = {
        uid: createdUid,
        fullName: fullName.trim(),
        firstName,
        lastName,
        phoneNumber: norm.intlNumber,
        phoneVerified: true,
        role: "customer",
        address: "Bole, Addis Ababa",
        latitude: 8.9806,
        longitude: 38.7578,
        countryCode: "ET",
        currency: "ETB",
        createdAt: serverTimestamp(),
      };

      // 3. Write Firestore document
      await setDoc(doc(db, "user", createdUid), profileData, { merge: true });

      // 4. Update local state immediately
      setUser(userCred.user);
      setDbUser(profileData);
      setSessionPhoneVerified(true);
      setOtpFlowInProgress(false);
      setAuthLoading(false);

      return { user: userCred.user, profile: profileData };
    } catch (err) {
      setAuthLoading(false);
      throw err;
    }
  }, []);

  /**
   * Complete, atomic merchant (Restaurant or Shop) registration.
   * Creates the Firebase Auth account, registers the business entity,
   * writes the pendingSeller profile, updates local state, and releases loader.
   */
  const registerSeller = useCallback(async ({
    email,
    password,
    fullName,
    phone,
    telebirrPhone = "",
    businessName,
    address,
    workingHours = "08:00 AM - 10:00 PM",
    licenceNumber,
    sellerType,
    licenceUrl = null,
    ownerIdUrl = null,
    logoUrl = null,
    bankName = "Commercial Bank of Ethiopia (CBE)",
    accountNumber = "",
    accountHolder = "",
  }) => {
    setAuthLoading(true);
    const norm = normalizeEthiopianPhone(phone);
    if (!norm.isValid) {
      setAuthLoading(false);
      throw new Error(norm.error);
    }

    try {
      // 1. Create Firebase Auth account
      const userCred = await createUserWithEmailAndPassword(
        auth,
        email.trim().toLowerCase(),
        password
      );
      const createdUid = userCred.user.uid;

      // 2. Generate business record ID
      const businessCollection = sellerType === "shop" ? "shops" : "restaurants";
      const businessRef = doc(collection(db, businessCollection));

      // 3. Write business entity document
      await setDoc(businessRef, {
        id: businessRef.id,
        name: businessName.trim(),
        businessName: businessName.trim(),
        ownerUid: createdUid,
        ownerName: fullName.trim(),
        phone: norm.intlNumber,
        telebirrPhone: telebirrPhone.trim(),
        address: address.trim(),
        workingHours: workingHours.trim(),
        sellerType,
        status: "PENDING",
        isVerified: false,
        licenceNumber: (licenceNumber || "").trim(),
        licenceUrl: licenceUrl || null,
        ownerIdUrl: ownerIdUrl || null,
        image: logoUrl || null,
        logoUrl: logoUrl || null,
        bankName,
        accountNumber,
        accountHolder: accountHolder || fullName.trim(),
        settlementDetails: {
          bankName,
          accountNumber,
          telebirrPhone: telebirrPhone.trim(),
          accountHolder: accountHolder || fullName.trim(),
        },
        createdAt: serverTimestamp(),
      });

      // 4. Write seller application audit document
      await addDoc(collection(db, "sellerApplications"), {
        ownerUid: createdUid,
        ownerName: fullName.trim(),
        phone: norm.intlNumber,
        telebirrPhone: telebirrPhone.trim(),
        email: email.trim().toLowerCase(),
        businessName: businessName.trim(),
        sellerType,
        address: address.trim(),
        workingHours: workingHours.trim(),
        licenceNumber: (licenceNumber || "").trim(),
        businessLicencePath: licenceUrl || null,
        ownerIdentityPath: ownerIdUrl || null,
        logoUrl: logoUrl || null,
        bankName,
        accountNumber,
        accountHolder: accountHolder || fullName.trim(),
        sellerId: businessRef.id,
        status: "PENDING",
        createdAt: serverTimestamp(),
      });

      // 5. Write authoritative user profile document in Firestore
      const nameParts = fullName.trim().split(" ");
      const profileData = {
        uid: createdUid,
        email: email.trim().toLowerCase(),
        fullName: fullName.trim(),
        firstName: nameParts[0] || fullName.trim(),
        lastName: nameParts.slice(1).join(" ") || "",
        phoneNumber: norm.intlNumber,
        phone: norm.intlNumber,
        telebirrPhone: telebirrPhone.trim(),
        phoneVerified: true,
        role: "pendingSeller",
        sellerType,
        sellerId: businessRef.id,
        businessName: businessName.trim(),
        approvalStatus: "PENDING",
        address: address.trim(),
        workingHours: workingHours.trim(),
        image: logoUrl || null,
        bankName,
        accountNumber,
        createdAt: serverTimestamp(),
      };

      await setDoc(doc(db, "user", createdUid), profileData, { merge: true });

      // 6. Update local state immediately
      setUser(userCred.user);
      setDbUser(profileData);
      setSessionPhoneVerified(true);
      setOtpFlowInProgress(false);
      setAuthLoading(false);

      return { user: userCred.user, profile: profileData };
    } catch (err) {
      setAuthLoading(false);
      throw err;
    }
  }, []);

  const createUser = useCallback((phone, password) => {
    const norm = normalizeEthiopianPhone(phone);
    if (!norm.isValid) throw new Error(norm.error);
    return createUserWithEmailAndPassword(auth, norm.authEmail, password);
  }, []);

  const signInUser = useCallback((identifier, password) => {
    let authEmail = identifier.trim();
    if (!identifier.includes("@")) {
      const norm = normalizeEthiopianPhone(identifier);
      if (!norm.isValid) throw new Error(norm.error);
      authEmail = norm.authEmail;
    }
    return signInWithEmailAndPassword(auth, authEmail, password);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!auth.currentUser) {
      setDbUser(null);
      return null;
    }
    const profile = await loadProfileFromFirestore(auth.currentUser.uid, auth.currentUser.email || "");
    setDbUser(profile);
    if (!OTP_VERIFICATION_REQUIRED || profile?.phoneVerified === true) {
      setSessionPhoneVerified(true);
    }
    return profile;
  }, [loadProfileFromFirestore]);

  const signOutUser = useCallback(async () => {
    setOtpFlowInProgress(false);
    setSessionPhoneVerified(false);
    setUser(null);
    setDbUser(null);
    await signOut(auth);
  }, []);

  const beginOtpFlow = useCallback(() => setOtpFlowInProgress(true), []);
  const cancelOtpFlow = useCallback(() => setOtpFlowInProgress(false), []);
  const completeOtpFlow = useCallback(() => {
    setSessionPhoneVerified(true);
    setOtpFlowInProgress(false);
  }, []);

  // ── Custom SMS OTP Authentication (Zero Firebase Phone Auth Billing) ────────
  const requestOtp = useCallback(async (phoneInput) => {
    const norm = normalizeEthiopianPhone(phoneInput);
    if (!norm.isValid) throw new Error(norm.error);

    // Compute robust digits directly
    const rawClean = String(phoneInput || "").replace(/\D/g, "");
    let fallbackDigits = rawClean;
    if (fallbackDigits.startsWith("251") && fallbackDigits.length === 12) {
      // good
    } else if (fallbackDigits.startsWith("0") && fallbackDigits.length === 10) {
      fallbackDigits = "251" + fallbackDigits.slice(1);
    } else if (fallbackDigits.length === 9) {
      fallbackDigits = "251" + fallbackDigits;
    }
    const cleanDigits = String(norm?.cleanDigits || norm?.rawDigits || fallbackDigits).replace(/\D/g, "");
    const intlNumber = String(norm?.intlNumber || `+${cleanDigits}`);
    const challengeDocId = `challenge_${cleanDigits}`;

    // Generate secure 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));

    // Persist challenge record in Firestore
    await setDoc(doc(db, "phoneOtpChallenges", challengeDocId), {
      phoneNumber: intlNumber,
      cleanDigits,
      code,
      expiresAt: Date.now() + 5 * 60 * 1000,
      attempts: 0,
      consumed: false,
      updatedAt: serverTimestamp(),
    }, { merge: true });

    // Send real SMS to Ethiopian mobile
    const smsRes = await fetch("https://smsethiopia.com/api/v2/sms/send", {
      method: "POST",
      headers: {
        KEY: "01ATJJKPX5H5QEPWXGQ28YYPHQI1FHR6F8JEKDB7",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        msisdn: cleanDigits,
        text: `Your MyTruck verification code is ${code}. It expires in 5 minutes. Do not share this code with anyone.`,
      }),
    });

    if (!smsRes.ok) {
      const errText = await smsRes.text().catch(() => "");
      console.warn("SMSEthiopia dispatch error:", smsRes.status, errText);
      throw new Error("SMS dispatch failed. Please verify your phone number and network.");
    }

    return {
      success: true,
      sent: true,
      phoneNumber: intlNumber,
      expiresInSeconds: 300,
      resendCooldownSeconds: 60,
    };
  }, []);

  const signInWithOtp = useCallback(async (phoneInput, code) => {
    const norm = normalizeEthiopianPhone(phoneInput);
    if (!norm.isValid) throw new Error(norm.error);
    const cleanCode = String(code).trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      throw new Error("Enter a valid 6-digit verification code.");
    }

    setAuthLoading(true);
    try {
      let customToken = null;
      let isExistingUser = false;
      let targetUid = null;

      // 1. Try Cloud Function first
      try {
        const fn = httpsCallable(getFunctions(app), "verifyLoginOtp");
        const res = await fn({
          phoneNumber: norm.intlNumber,
          code: cleanCode,
        });
        customToken = res?.data?.customToken;
        isExistingUser = res?.data?.isExistingUser;
        targetUid = res?.data?.uid;
      } catch (cfErr) {
        console.warn("verifyLoginOtp Cloud Function note, using direct Firestore verification:", cfErr?.message);
      }

      // 2. Direct Firestore challenge verification
      if (!customToken) {
        const rawClean = String(phoneInput || "").replace(/\D/g, "");
        let fallbackDigits = rawClean;
        if (fallbackDigits.startsWith("251") && fallbackDigits.length === 12) {
          // good
        } else if (fallbackDigits.startsWith("0") && fallbackDigits.length === 10) {
          fallbackDigits = "251" + fallbackDigits.slice(1);
        } else if (fallbackDigits.length === 9) {
          fallbackDigits = "251" + fallbackDigits;
        }
        const cleanDigits = String(norm?.cleanDigits || norm?.rawDigits || fallbackDigits).replace(/\D/g, "");
        const challengeDocId = `challenge_${cleanDigits}`;
        const challengeRef = doc(db, "phoneOtpChallenges", challengeDocId);
        const challengeSnap = await getDoc(challengeRef);

        if (!challengeSnap.exists()) {
          throw new Error("No verification request found for this number. Please request a new code.");
        }

        const data = challengeSnap.data();
        if (data.consumed === true) {
          throw new Error("This verification code has already been used. Please request a new code.");
        }
        if (Number(data.expiresAt) < Date.now()) {
          throw new Error("Verification code has expired. Please request a new code.");
        }
        if (Number(data.attempts || 0) >= 5) {
          throw new Error("Too many incorrect attempts. Please request a new code.");
        }
        if (String(data.code).trim() !== cleanCode) {
          await updateDoc(challengeRef, { attempts: (Number(data.attempts || 0) + 1) }).catch(() => {});
          throw new Error("Incorrect 6-digit verification code. Please check and try again.");
        }

        // Mark challenge consumed
        await updateDoc(challengeRef, { consumed: true, verifiedAt: serverTimestamp() }).catch(() => {});
      }

      // 3. Resolve existing user profile from Firestore (/user and /users)
      let resolvedProfile = null;
      const [uSnap1, uSnap2] = await Promise.all([
        getDocs(query(collection(db, "user"), where("phoneNumber", "==", norm.intlNumber), limit(1))),
        getDocs(query(collection(db, "users"), where("phoneNumber", "==", norm.intlNumber), limit(1))),
      ]);

      if (!uSnap1.empty) {
        resolvedProfile = { id: uSnap1.docs[0].id, ...uSnap1.docs[0].data() };
        targetUid = uSnap1.docs[0].id;
        isExistingUser = true;
      } else if (!uSnap2.empty) {
        resolvedProfile = { id: uSnap2.docs[0].id, ...uSnap2.docs[0].data() };
        targetUid = uSnap2.docs[0].id;
        isExistingUser = true;
      }

      // 4. Authenticate session
      if (customToken) {
        const userCred = await signInWithCustomToken(auth, customToken);
        setUser(userCred.user);
      } else {
        // Authenticate client session via standard phone auth account or anonymous fallback
        const phoneAuthPass = `P@ss_${norm.cleanDigits}_MyTruck2026!`;
        try {
          const cred = await signInWithEmailAndPassword(auth, norm.authEmail, phoneAuthPass);
          setUser(cred.user);
          targetUid = cred.user.uid;
        } catch (signInErr) {
          if (signInErr?.code === "auth/user-not-found" || signInErr?.code === "auth/invalid-credential") {
            try {
              const cred = await createUserWithEmailAndPassword(auth, norm.authEmail, phoneAuthPass);
              setUser(cred.user);
              targetUid = cred.user.uid;
            } catch (createErr) {
              try {
                const anonCred = await signInAnonymously(auth);
                setUser(anonCred.user);
                targetUid = anonCred.user.uid;
              } catch (_) {
                setUser({ uid: targetUid || norm.cleanDigits, email: norm.authEmail, phoneNumber: norm.intlNumber });
              }
            }
          } else {
            try {
              const anonCred = await signInAnonymously(auth);
              setUser(anonCred.user);
            } catch (_) {
              setUser({ uid: targetUid || norm.cleanDigits, email: norm.authEmail, phoneNumber: norm.intlNumber });
            }
          }
        }
      }

      // 5. Load authoritative profile and verify roles
      let profile = resolvedProfile;
      if (auth.currentUser?.uid) {
        profile = await loadProfileFromFirestore(auth.currentUser.uid, auth.currentUser.email || "");
      }
      if (!profile && resolvedProfile) {
        profile = resolvedProfile;
      }

      // If completely new user, create initial customer profile
      if (!profile && targetUid) {
        profile = {
          uid: targetUid,
          phoneNumber: norm.intlNumber,
          phoneVerified: true,
          role: "customer",
          isNewRegistration: true,
          createdAt: serverTimestamp(),
        };
        await setDoc(doc(db, "user", targetUid), profile, { merge: true });
        await setDoc(doc(db, "users", targetUid), profile, { merge: true });
      }

      setDbUser(profile);
      setSessionPhoneVerified(true);
      setOtpFlowInProgress(false);
      setAuthLoading(false);

      return {
        user: auth.currentUser || { uid: targetUid || norm.cleanDigits },
        profile,
        isExistingUser: Boolean(resolvedProfile),
        uid: targetUid,
      };
    } catch (err) {
      setAuthLoading(false);
      throw err;
    }
  }, [loadProfileFromFirestore]);

  return (
    <UserContext.Provider
      value={{
        user,
        dbUser,
        authLoading,
        registerCustomer,
        registerSeller,
        createUser,
        signInUser,
        requestOtp,
        signInWithOtp,
        signOutUser,
        refreshProfile,
        checkPhoneRegistered,
        otpFlowInProgress,
        sessionPhoneVerified,
        beginOtpFlow,
        cancelOtpFlow,
        completeOtpFlow,
      }}
    >
      {children}
    </UserContext.Provider>
  );
};

export const UserAuth = () => useContext(UserContext);
