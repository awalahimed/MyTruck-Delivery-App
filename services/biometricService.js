import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// SecureStore Keys (Backed by Android Keystore & Hardware-backed EncryptedSharedPreferences)
const KEY_BIOMETRIC_ENABLED = "mytruck_bio_enabled_v1";
const KEY_BIOMETRIC_IDENTIFIER = "mytruck_bio_user_id_v1";
const KEY_BIOMETRIC_CREDENTIAL = "mytruck_bio_credential_v1";
const KEY_BIOMETRIC_NAME = "mytruck_bio_user_name_v1";
const KEY_BIOMETRIC_ROLE = "mytruck_bio_user_role_v1";
const KEY_BIOMETRIC_LAST_LOGIN = "mytruck_bio_last_login_v1";

/**
 * Check device biometric hardware capabilities and enrollment
 */
export async function checkBiometricSupport() {
  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();

    // Fingerprint type is 1 in expo-local-authentication
    const supportsFingerprint = supportedTypes.includes(
      LocalAuthentication.AuthenticationType.FINGERPRINT
    );
    const supportsFacial = supportedTypes.includes(
      LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION
    );

    let biometricType = "None";
    if (supportsFingerprint) {
      biometricType = "Fingerprint";
    } else if (supportsFacial) {
      biometricType = "Face ID";
    } else if (supportedTypes.length > 0) {
      biometricType = "Biometrics";
    }

    return {
      hasHardware,
      isEnrolled,
      supportsFingerprint,
      biometricType,
      isReady: hasHardware && isEnrolled,
    };
  } catch (err) {
    console.warn("checkBiometricSupport error:", err?.message);
    return {
      hasHardware: false,
      isEnrolled: false,
      supportsFingerprint: false,
      biometricType: "None",
      isReady: false,
    };
  }
}

/**
 * Check if the user has actively enabled biometric authentication
 * and has a valid Keystore-protected credential stored.
 */
export async function isBiometricEnabled() {
  try {
    const enabled = await SecureStore.getItemAsync(KEY_BIOMETRIC_ENABLED);
    if (enabled !== "true") return false;

    const cred = await SecureStore.getItemAsync(KEY_BIOMETRIC_CREDENTIAL);
    return Boolean(cred && cred.length > 0);
  } catch (err) {
    console.warn("isBiometricEnabled error:", err?.message);
    return false;
  }
}

/**
 * Get non-sensitive summary of saved biometric profile for welcome screen
 */
export async function getSavedBiometricAccount() {
  try {
    const [identifier, name, role, lastLogin] = await Promise.all([
      SecureStore.getItemAsync(KEY_BIOMETRIC_IDENTIFIER),
      SecureStore.getItemAsync(KEY_BIOMETRIC_NAME),
      SecureStore.getItemAsync(KEY_BIOMETRIC_ROLE),
      SecureStore.getItemAsync(KEY_BIOMETRIC_LAST_LOGIN),
    ]);

    if (!identifier) return null;

    return {
      identifier,
      name: name || "User",
      role: role || "customer",
      lastLogin: lastLogin || null,
    };
  } catch (err) {
    console.warn("getSavedBiometricAccount error:", err?.message);
    return null;
  }
}

/**
 * Trigger native Android biometric prompt
 */
export async function authenticateWithBiometrics(
  promptMessage = "Scan your fingerprint to access MyTruck"
) {
  try {
    const support = await checkBiometricSupport();
    if (!support.hasHardware) {
      return {
        success: false,
        error: "Biometric hardware is not available on this device.",
      };
    }
    if (!support.isEnrolled) {
      return {
        success: false,
        error: "No biometric credentials enrolled in Android Settings.",
      };
    }

    const authResult = await LocalAuthentication.authenticateAsync({
      promptMessage,
      cancelLabel: "Use Password",
      fallbackLabel: "Use Password",
      disableDeviceFallback: true,
    });

    if (authResult.success) {
      return { success: true };
    }

    if (authResult.error === "user_cancel" || authResult.error === "system_cancel") {
      return { success: false, cancelled: true };
    }

    return {
      success: false,
      error: authResult.warning || authResult.error || "Biometric authentication failed.",
    };
  } catch (err) {
    console.warn("authenticateWithBiometrics error:", err?.message);
    return {
      success: false,
      error: err?.message || "Biometric verification error.",
    };
  }
}

/**
 * Securely enroll/store credentials backed by Android Keystore
 */
export async function saveBiometricCredentials({
  identifier,
  credential,
  name,
  role,
}) {
  if (!identifier || !credential) {
    throw new Error("Missing required identifier or credential to store.");
  }

  // Require biometric prompt before enrolling
  const auth = await authenticateWithBiometrics("Confirm your fingerprint to enable biometric login");
  if (!auth.success) {
    if (auth.cancelled) {
      throw new Error("Biometric enrollment cancelled.");
    }
    throw new Error(auth.error || "Biometric verification failed during enrollment.");
  }

  await SecureStore.setItemAsync(KEY_BIOMETRIC_ENABLED, "true");
  await SecureStore.setItemAsync(KEY_BIOMETRIC_IDENTIFIER, String(identifier).trim());
  await SecureStore.setItemAsync(KEY_BIOMETRIC_CREDENTIAL, String(credential).trim());
  await SecureStore.setItemAsync(KEY_BIOMETRIC_NAME, String(name || "User").trim());
  await SecureStore.setItemAsync(KEY_BIOMETRIC_ROLE, String(role || "customer").trim());
  await SecureStore.setItemAsync(KEY_BIOMETRIC_LAST_LOGIN, new Date().toISOString());

  return true;
}

/**
 * Retrieve securely stored credential after successful biometric authentication
 */
export async function retrieveBiometricCredentials() {
  const [identifier, credential, role, name] = await Promise.all([
    SecureStore.getItemAsync(KEY_BIOMETRIC_IDENTIFIER),
    SecureStore.getItemAsync(KEY_BIOMETRIC_CREDENTIAL),
    SecureStore.getItemAsync(KEY_BIOMETRIC_ROLE),
    SecureStore.getItemAsync(KEY_BIOMETRIC_NAME),
  ]);

  if (!identifier || !credential) {
    return null;
  }

  return {
    identifier,
    credential,
    role: role || "customer",
    name: name || "User",
  };
}

/**
 * Record timestamp of successful biometric login
 */
export async function recordBiometricLoginSuccess() {
  try {
    await SecureStore.setItemAsync(KEY_BIOMETRIC_LAST_LOGIN, new Date().toISOString());
  } catch (_) {}
}

/**
 * Disable biometrics and wipe saved credentials from Android Keystore
 */
export async function disableBiometrics() {
  try {
    await Promise.all([
      SecureStore.deleteItemAsync(KEY_BIOMETRIC_ENABLED).catch(() => {}),
      SecureStore.deleteItemAsync(KEY_BIOMETRIC_IDENTIFIER).catch(() => {}),
      SecureStore.deleteItemAsync(KEY_BIOMETRIC_CREDENTIAL).catch(() => {}),
      SecureStore.deleteItemAsync(KEY_BIOMETRIC_NAME).catch(() => {}),
      SecureStore.deleteItemAsync(KEY_BIOMETRIC_ROLE).catch(() => {}),
      SecureStore.deleteItemAsync(KEY_BIOMETRIC_LAST_LOGIN).catch(() => {}),
    ]);
    return true;
  } catch (err) {
    console.warn("disableBiometrics error:", err?.message);
    return false;
  }
}

