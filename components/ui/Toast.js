import React, { useEffect, useRef, useState } from "react";
import { Animated, Text, StyleSheet } from "react-native";

/**
 * Lightweight inline Toast component.
 * Usage: <Toast message="Added!" nonce={Date.now()} bottom={24} />
 * Each time `nonce` changes, the toast appears and fades out.
 */
export default function Toast({ message, nonce, bottom = 24 }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!nonce || !message) return;
    setVisible(true);
    opacity.setValue(1);
    const timeout = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start(() => setVisible(false));
    }, 1800);
    return () => clearTimeout(timeout);
  }, [nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;

  return (
    <Animated.View style={[s.toast, { bottom, opacity }]}>
      <Text style={s.txt}>{message}</Text>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  toast: {
    position: "absolute",
    alignSelf: "center",
    backgroundColor: "rgba(15,23,42,0.85)",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 24,
    zIndex: 999,
  },
  txt: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
});
