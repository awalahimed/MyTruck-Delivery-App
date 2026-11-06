import { View, StyleSheet } from "react-native";

export function Skeleton({ width = "100%", height = 14, style, borderRadius = 8 }) {
  return (
    <View
      style={[
        { width, height, borderRadius, backgroundColor: "#E2E8F0" },
        style,
      ]}
    />
  );
}

export function ProductGridSkeleton() {
  return (
    <View style={{ padding: 14 }}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={{ flexDirection: "row", backgroundColor: "white", borderRadius: 14, padding: 12, marginBottom: 12 }}>
          <Skeleton width={80} height={80} borderRadius={10} style={{ marginRight: 10 }} />
          <View style={{ flex: 1, justifyContent: "center" }}>
            <Skeleton width="60%" height={14} style={{ marginBottom: 6 }} />
            <Skeleton width="40%" height={12} style={{ marginBottom: 6 }} />
            <Skeleton width="30%" height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}
