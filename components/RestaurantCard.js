import { View, Text, Pressable, StyleSheet } from "react-native";
import { StarIcon } from "react-native-heroicons/solid";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useNavigation } from "@react-navigation/native";
import SmartImage from "./ui/SmartImage";

const RestaurantCard = ({
  id,
  title,
  rating,
  address,
  image,
  lat,
  description,
  lng,
  genre,
  minDeliveryTime,
  maxDeliveryTime,
  isOpen,
}) => {
  const navigation = useNavigation();
  const isShopType = genre && (genre.toLowerCase().includes("shop") || genre.toLowerCase().includes("grocery") || genre.toLowerCase().includes("retail"));

  return (
    <Pressable
      onPress={() => navigation.navigate("Restaurant", { id })}
      style={({ pressed }) => [styles.card, { opacity: pressed ? 0.93 : 1 }]}
    >
      {/* Image */}
      <View style={styles.imageContainer}>
        <SmartImage
          uri={image}
          fallbackType={isShopType ? "shop" : "restaurant"}
          style={styles.image}
          resizeMode="cover"
        />
        {/* Open/Closed badge */}
        {isOpen !== undefined && (
          <View style={[styles.openBadge, { backgroundColor: isOpen ? "#DCFCE7" : "#FEE2E2" }]}>
            <Text style={{ color: isOpen ? "#166534" : "#B91C1C", fontSize: 10, fontWeight: "700" }}>
              {isOpen ? "Open" : "Closed"}
            </Text>
          </View>
        )}

        {/* Promotional Deal Badge */}
        <View style={styles.dealBadge}>
          <Text style={styles.dealBadgeText}>Up to 25% OFF</Text>
        </View>
      </View>


      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>

        {/* Rating + time */}
        <View style={styles.row}>
          <View style={styles.ratingPill}>
            <StarIcon color="#10B981" size={12} />
            <Text style={styles.ratingText}>{rating || "—"}</Text>
          </View>
          <View style={styles.timePill}>
            <MaterialCommunityIcons name="clock-outline" size={12} color="#64748B" />
            <Text style={styles.timeText}>{minDeliveryTime}–{maxDeliveryTime} min</Text>
          </View>
        </View>

        {/* Genre */}
        {!!genre && (
          <View style={styles.genrePill}>
            <Text style={styles.genreText}>{genre}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: "white",
    marginRight: 14,
    borderRadius: 18,
    width: 220,
    overflow: "hidden",
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
  },
  imageContainer: { position: "relative" },
  image: { height: 130, width: "100%", backgroundColor: "#F1F5F9" },
  openBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  dealBadge: {
    position: "absolute",
    bottom: 8,
    left: 8,
    backgroundColor: "rgba(225, 29, 72, 0.92)",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2.5,
  },
  dealBadgeText: {
    color: "#FFFFFF",
    fontSize: 9.5,
    fontWeight: "800",
  },

  info: { padding: 10 },
  title: { fontWeight: "800", fontSize: 15, color: "#0B2A26", marginBottom: 6 },
  row: { flexDirection: "row", marginBottom: 6 },
  ratingPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#DCFCE7",
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 6,
  },
  ratingText: { color: "#166534", fontSize: 11, fontWeight: "700", marginLeft: 3 },
  timePill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 6,
  },
  timeText: { color: "#64748B", fontSize: 11, marginLeft: 3 },
  genrePill: {
    backgroundColor: "#FFF4EC",
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  genreText: { color: "#F47721", fontSize: 11, fontWeight: "700" },
});

export default RestaurantCard;
