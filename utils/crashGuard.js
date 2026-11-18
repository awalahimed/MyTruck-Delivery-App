/**
 * Keeps a JavaScript error from silently closing the app.
 *
 * In a release build, React Native closes the app on any uncaught error thrown outside of
 * rendering (timers, effects, event and native callbacks), with no message. This replaces that
 * with the "Something went wrong" screen (components/ErrorBoundary.js), which shows the error.
 *
 * Imported first by index.js, so it is active before any other app code runs.
 * Development builds keep React Native's red error screen.
 */
let lastFatal = null;
const listeners = new Set();

const errorUtils = global.ErrorUtils;
const previousHandler = errorUtils?.getGlobalHandler?.();

if (errorUtils?.setGlobalHandler) {
  errorUtils.setGlobalHandler((error, isFatal) => {
    if (__DEV__ || !isFatal) {
      previousHandler?.(error, isFatal);
      return;
    }
    lastFatal = error instanceof Error ? error : new Error(String(error));
    console.error("MyTruck fatal error:", lastFatal?.message, lastFatal?.stack);
    listeners.forEach((cb) => {
      try {
        cb(lastFatal);
      } catch (_) {}
    });
  });
}

/** Calls cb with each fatal error, including one that happened before cb was registered. */
export function onFatalError(cb) {
  listeners.add(cb);
  if (lastFatal) cb(lastFatal);
  return () => listeners.delete(cb);
}

export function clearFatalError() {
  lastFatal = null;
}
