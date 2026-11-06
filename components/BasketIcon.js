import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import React from "react";
import { useSelector } from "react-redux";
import { selectBasketItems, selectBasketTotal } from "../features/basketSlice";
import { useNavigation } from "@react-navigation/native";

// Lightweight ETB formatter — replaces react-currency-formatter (React 16-only)
const formatETB = (amount) => {
  const num = Number(amount) || 0;
  return `ETB ${num.toFixed(2)}`;
};

const BasketIcon = () => {
  const navigation = useNavigation();

  const items = useSelector(selectBasketItems);
  const basketTotal = useSelector(selectBasketTotal);

  if (items.length === 0) return null;

  return (
    <View style={bs.container}>
      <TouchableOpacity
        onPress={() => navigation.navigate("Basket")}
        style={bs.button}
        activeOpacity={0.88}
      >
        <Text style={bs.countBadge}>
          {String(items.length)}
        </Text>
        <Text style={bs.label}>View Basket</Text>
        <Text style={bs.total}>{formatETB(basketTotal)}</Text>
      </TouchableOpacity>
    </View>
  );
};

const bs = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 16,
    width: "100%",
    zIndex: 50,
  },
  button: {
    backgroundColor: "#179B83",
    marginHorizontal: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 24,
    alignItems: "center",
    flexDirection: "row",
  },
  countBadge: {
    color: "white",
    fontWeight: "800",
    fontSize: 18,
    backgroundColor: "#0F806D",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    overflow: "hidden",
  },
  label: {
    flex: 1,
    color: "white",
    fontWeight: "800",
    fontSize: 18,
    textAlign: "center",
  },
  total: {
    fontSize: 18,
    color: "white",
    fontWeight: "800",
  },
});

export default BasketIcon;
