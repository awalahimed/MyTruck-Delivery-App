import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { UserAuth } from "../contexts/AuthContext";
import { getPricingConfig, setPricingConfig, subscribePricingConfig } from "./pricing";
import { store } from "../store";
import { repriceBasket } from "../features/basketSlice";

/**
 * Returns the live platform pricing config and re-renders the caller whenever the
 * Super Admin changes it. Screens that show prices call this so they never show stale prices.
 */
export function usePricingConfig() {
  const [cfg, setCfg] = useState(getPricingConfig);
  useEffect(() => {
    setCfg(getPricingConfig());
    return subscribePricingConfig(setCfg);
  }, []);
  return cfg;
}

/**
 * Keeps the app-wide pricing config in sync with platformSettings/config.
 * Mounted once in App.js; reads need a signed-in user (see firestore.rules).
 */
export function PricingConfigSync() {
  const { user } = UserAuth() || {};
  const uid = user?.uid;
  useEffect(() => {
    if (!uid) return undefined;
    const unsub = onSnapshot(
      doc(db, "platformSettings", "config"),
      (snap) => {
        setPricingConfig(snap.exists() ? snap.data() : {});
        store.dispatch(repriceBasket(getPricingConfig()));
      },
      (error) => {
        // Keep the last known prices if the read is refused or offline
        console.warn("Pricing settings unavailable:", error?.code, error?.message);
      }
    );
    return unsub;
  }, [uid]);
  return null;
}
