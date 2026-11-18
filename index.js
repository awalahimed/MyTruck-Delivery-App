// App entry. Installs the crash guard before any other code runs, and if the app's code fails
// while loading, shows the error instead of closing (release builds otherwise just close).
import "./utils/crashGuard";
import React from "react";
import { ScrollView, Text, View } from "react-native";
import { registerRootComponent } from "expo";

let App;
try {
  App = require("./App").default;
} catch (error) {
  const message = String(error?.message || error);
  const stack = String(error?.stack || "");
  console.error("MyTruck failed to load:", message, stack);
  App = function LoadFailed() {
    return (
      <View style={{ flex: 1, backgroundColor: "#0B2A26", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: "#FFFFFF", fontSize: 20, fontWeight: "800", marginBottom: 8 }}>MyTruck couldn't start</Text>
        <Text style={{ color: "#CBD5E1", fontSize: 13, marginBottom: 16 }}>
          Please send a screenshot of this screen to the MyTruck team.
        </Text>
        <ScrollView style={{ maxHeight: 360, backgroundColor: "#06201C", borderRadius: 12, padding: 12 }}>
          <Text selectable style={{ color: "#FCA5A5", fontSize: 12 }}>{message}</Text>
          <Text selectable style={{ color: "#94A3B8", fontSize: 10, marginTop: 8 }}>{stack}</Text>
        </ScrollView>
      </View>
    );
  };
}

registerRootComponent(App);
