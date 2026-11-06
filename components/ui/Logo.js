import { Image, View, Text, StyleSheet } from "react-native";

export default function Logo({ size = 48, showText = false }) {
  return (
    <View style={s.wrap}>
      <Image
        source={require("../../assets/icon.png")}
        style={{ width: size, height: size, borderRadius: size * 0.2 }}
        resizeMode="contain"
      />
      {showText ? <Text style={s.txt}>MyTruck Delivery</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: "center" },
  txt: { color: "#179B83", fontWeight: "800", marginTop: 6, fontSize: 16 },
});
