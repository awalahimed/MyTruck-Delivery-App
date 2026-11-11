/**
 * Lightweight timing for the checkout and payment path.
 *
 * - Always records the last few timings in memory.
 * - Logs to the console in development, and shows a short timing note only in test builds
 *   (extra.perfTimings, set by the PERF_TIMINGS build variable). Customers never see it.
 */
import Constants from "expo-constants";

const TEST_BUILD = Boolean(Constants.expoConfig?.extra?.perfTimings);
const records = [];

export const perfTimingsVisible = () => TEST_BUILD;

/** Start a named timer. Call the returned function to stop it and get the elapsed milliseconds. */
export function startTimer(label) {
  const t0 = Date.now();
  return () => {
    const ms = Date.now() - t0;
    records.push({ label, ms, at: new Date().toISOString() });
    if (records.length > 50) records.shift();
    if (__DEV__ || TEST_BUILD) console.log(`[perf] ${label}: ${ms} ms`);
    return ms;
  };
}

export const recentTimings = () => records.slice(-20);
