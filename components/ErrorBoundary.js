import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";

const TEAL = "#179B83";
const DARK = "#0B2A26";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, showDetails: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.warn("MyTruck ErrorBoundary caught an exception:", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleRestart = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, showDetails: false });
    if (typeof this.props.onReset === "function") {
      this.props.onReset();
    }
  };

  handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (_) {}
    this.setState({ hasError: false, error: null, errorInfo: null, showDetails: false });
  };

  render() {
    if (this.state.hasError) {
      const errorMsg = this.state.error?.message || String(this.state.error || "Unknown error");
      const componentStack = this.state.errorInfo?.componentStack || "";
      return (
        <View style={s.container}>
          <View style={s.card}>
            <View style={s.iconCircle}>
              <MaterialCommunityIcons name="alert-circle-outline" size={44} color="#EF4444" />
            </View>
            <Text style={s.title}>Something went wrong</Text>
            <Text style={s.message}>
              An unexpected issue occurred. We've protected your session so you don't lose any data.
            </Text>

            {this.state.showDetails ? (
              <ScrollView style={s.detailsBox} contentContainerStyle={{ padding: 10 }}>
                <Text style={s.detailsText}>{errorMsg}</Text>
                {Boolean(componentStack) && (
                  <Text style={[s.detailsText, { marginTop: 8, color: "#94A3B8" }]}>
                    {componentStack}
                  </Text>
                )}
              </ScrollView>
            ) : (
              <TouchableOpacity
                onPress={() => this.setState({ showDetails: true })}
                style={{ marginBottom: 16 }}
              >
                <Text style={{ color: "#94A3B8", fontSize: 12, textDecorationLine: "underline" }}>
                  View technical details
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={s.restartBtn}
              onPress={this.handleRestart}
              activeOpacity={0.88}
            >
              <Text style={s.restartBtnTxt}>Restart MyTruck</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={s.signOutBtn}
              onPress={this.handleSignOut}
              activeOpacity={0.88}
            >
              <Text style={s.signOutBtnTxt}>Sign Out / Switch Account</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DARK,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 28,
    alignItems: "center",
    width: "100%",
    maxWidth: 360,
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 10,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#FEF2F2",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: DARK,
    marginBottom: 8,
    textAlign: "center",
  },
  message: {
    fontSize: 13,
    color: "#64748B",
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 20,
  },
  detailsBox: {
    maxHeight: 100,
    width: "100%",
    backgroundColor: "#F8FAFC",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 16,
  },
  detailsText: {
    fontSize: 11,
    color: "#EF4444",
    fontFamily: "monospace",
  },
  restartBtn: {
    backgroundColor: TEAL,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 14,
    width: "100%",
    alignItems: "center",
    marginBottom: 10,
  },
  restartBtnTxt: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
  signOutBtn: {
    backgroundColor: "#F1F5F9",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 14,
    width: "100%",
    alignItems: "center",
  },
  signOutBtnTxt: {
    color: "#475569",
    fontSize: 13,
    fontWeight: "700",
  },
});

