import { View, Text, Pressable, StyleSheet } from "react-native";
import { StarIcon, MapPinIcon } from "react-native-heroicons/solid";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useNavigation } from "@react-navigation/native";
import SmartImage from "./ui/SmartImage";

const RestaurantItem = ({
  id,
  title,
  rating,
  address,
  image,
  description,
  genre,
  lat,
  lng,
  minDeliveryTime,
  maxDeliveryTime,
  isOpen,
}) => {
  const navigation = useNavigation();
  const isShopType = genre && (genre.toLowerCase().includes("shop") || genre.toLowerCase().includes("grocery") || genre.toLowerCase().includes("retail"));

  return (
    <Pressable
      onPress={() => navigation.navigate("Restaurant", { id })}
      style={({ pressed }) => [styles.card, { opacity: pressed ? 0.95 : 1 }]}
    >
      {/* Image */}
      <View style={styles.imageWrap}>
        <SmartImage
          uri={image}
          fallbackType={isShopType ? "shop" : "restaurant"}
          style={styles.image}
          resizeMode="cover"
        />
        {isOpen !== undefined && (
          <View style={[styles.openBadge, { backgroundColor: isOpen ? "#DCFCE7" : "#FEE2E2" }]}>
            <Text style={{ color: isOpen ? "#166534" : "#B91C1C", fontSize: 10, fontWeight: "700" }}>
              {isOpen ? "Open" : "Closed"}
            </Text>
          </View>
        )}
        <View style={styles.dealBadge}>
          <Text style={styles.dealBadgeText}>25% OFF</Text>
        </View>
      </View>


      {/* Info */}
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>

        <View style={styles.pillRow}>
          <View style={styles.ratingPill}>
            <StarIcon color="#10B981" size={13} />
            <Text style={styles.ratingText}>{rating || "—"}</Text>
          </View>
          <View style={styles.timePill}>
            <MaterialCommunityIcons name="clock-outline" size={13} color="#64748B" />
            <Text style={styles.timeText}>{minDeliveryTime}–{maxDeliveryTime} min</Text>
          </View>
          {!!genre && (
            <View style={styles.genrePill}>
              <Text style={styles.genreText}>{genre}</Text>
            </View>
          )}
        </View>

        {!!address && (
          <View style={styles.addressRow}>
            <MapPinIcon color="#94A3B8" size={13} />
            <Text style={styles.addressText} numberOfLines={1}>{address}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: "white",
    marginBottom: 12,
    borderRadius: 18,
    flexDirection: "row",
    overflow: "hidden",
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
  },
  imageWrap: { position: "relative", width: 110 },
  image: { width: 110, height: 110, backgroundColor: "#F1F5F9" },
  openBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  dealBadge: {
    position: "absolute",
    bottom: 6,
    left: 6,
    backgroundColor: "rgba(225, 29, 72, 0.92)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  dealBadgeText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "800",
  },

  info: { flex: 1, padding: 12, justifyContent: "center" },
  title: { fontWeight: "800", fontSize: 15, color: "#0B2A26", marginBottom: 6 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", marginBottom: 6 },
  ratingPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#DCFCE7",
    borderRadius: 7,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 6,
    marginBottom: 4,
  },
  ratingText: { color: "#166534", fontSize: 11, fontWeight: "700", marginLeft: 3 },
  timePill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    borderRadius: 7,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 6,
    marginBottom: 4,
  },
  timeText: { color: "#64748B", fontSize: 11, marginLeft: 3 },
  genrePill: {
    backgroundColor: "#FFF4EC",
    borderRadius: 7,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 6,
    marginBottom: 4,
  },
  genreText: { color: "#F47721", fontSize: 11, fontWeight: "700" },
  addressRow: { flexDirection: "row", alignItems: "center" },
  addressText: { color: "#94A3B8", fontSize: 11, flex: 1, marginLeft: 3 },
});

export default RestaurantItem;
