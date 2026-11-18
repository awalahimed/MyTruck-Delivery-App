/**
 * Expo config plugin: when the Android app crashes, show the error on screen instead of only
 * Android's "MyTruck Delivery keeps stopping" message, so the cause can be seen without a computer.
 *
 * Adds CrashReportActivity (plugins/crash-reporter/CrashReportActivity.kt), registers it in its own
 * ":crash" process, and installs it first thing in MainApplication.onCreate.
 */
const fs = require("fs");
const path = require("path");
const { withAndroidManifest, withDangerousMod, withMainApplication, AndroidConfig } = require("@expo/config-plugins");

const ACTIVITY = ".CrashReportActivity";

const withCrashReportSource = (config) =>
  withDangerousMod(config, [
    "android",
    async (cfg) => {
      const pkg = cfg.android?.package;
      if (!pkg) throw new Error("withCrashReporter: android.package is not set in app.json");
      const src = fs.readFileSync(path.join(__dirname, "crash-reporter", "CrashReportActivity.kt"), "utf8");
      const dir = path.join(cfg.modRequest.platformProjectRoot, "app", "src", "main", "java", ...pkg.split("."));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "CrashReportActivity.kt"), src.replace("__PACKAGE__", pkg));
      return cfg;
    },
  ]);

const withCrashReportManifest = (config) =>
  withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.activity = (app.activity || []).filter((a) => a.$["android:name"] !== ACTIVITY);
    app.activity.push({
      $: {
        "android:name": ACTIVITY,
        "android:process": ":crash",
        "android:exported": "false",
        "android:excludeFromRecents": "true",
        "android:theme": "@android:style/Theme.DeviceDefault.NoActionBar",
      },
    });
    return cfg;
  });

const withCrashReportInstall = (config) =>
  withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes("CrashReportActivity.install")) {
      const anchor = /override fun onCreate\(\) \{\s*\n(\s*)super\.onCreate\(\)\n/;
      if (!anchor.test(src)) throw new Error("withCrashReporter: could not find onCreate in MainApplication.kt");
      src = src.replace(
        anchor,
        (m, indent) =>
          `${m}${indent}CrashReportActivity.install(this)\n` +
          `${indent}// The crash screen's own process must not start React Native\n` +
          `${indent}if (CrashReportActivity.isCrashProcess()) return\n`
      );
    }
    cfg.modResults.contents = src;
    return cfg;
  });

module.exports = (config) => withCrashReportInstall(withCrashReportManifest(withCrashReportSource(config)));
