import { View } from "react-native";
import { StarIcon, MapPinIcon, ChevronRightIcon } from "react-native-heroicons/solid";
import { useNavigation } from "@react-navigation/native";
import PressableScale from "./ui/PressableScale";
import SmartImage from "./ui/SmartImage";
import Txt from "./ui/Txt";
import { useTheme } from "../theme/theme";
import { money } from "../utils/format";
import { getCustomerPrice, getItemDiscountInfo } from "../utils/pricing";
import { usePricingConfig } from "../utils/usePricingConfig";

const SearchCard = ({ results }) => {
  // Re-render with the Super Admin's live pricing
  const pricingConfig = usePricingConfig();
  const navigation = useNavigation();
  const { c } = useTheme();
  const id = results.restaurantId ? results.restaurantId : results.id;
  const isDish = !!results.price;
  const info = isDish ? getItemDiscountInfo(results) : null;

  return (
    <PressableScale
      onPress={() => navigation.navigate("Restaurant", { id })}
      scaleTo={0.985}
      containerStyle={{ paddingHorizontal: 16 }}
      style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border }}
    >
      <SmartImage uri={results.image} style={{ width: 64, height: 64, borderRadius: 14, marginRight: 12 }} />
      <View style={{ flex: 1 }}>
        <Txt v="heading" numberOfLines={1}>{results.name}</Txt>
        {isDish && info ? (
          <>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 5, marginTop: 2 }}>
              <Txt v="heading" tone="primary" style={{ color: "#E11D48" }}>{money(info.customerSellingPrice)}</Txt>
              <Txt v="caption" style={{ textDecorationLine: "line-through", color: c.textFaint }}>
                {money(info.customerOriginalPrice)}
              </Txt>
              <View style={{ backgroundColor: "#FEE2E2", paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3 }}>
                <Txt v="caption" style={{ color: "#E11D48", fontWeight: "800", fontSize: 9.5 }}>
                  -{info.discountPercent}%
                </Txt>
              </View>
            </View>
            <Txt v="caption" tone="faint">Dish · Save {money(info.savingsAmount)}</Txt>
          </>
        ) : (

          <>
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
              <View style={{ flexDirection: "row", alignItems: "center", marginRight: 8 }}>
                <StarIcon size={13} color={c.accent} style={{ marginRight: 3 }} />
                <Txt v="caption" style={{ fontWeight: "800" }}>{results.rating}</Txt>
              </View>
              <Txt v="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>{results.genre}</Txt>
            </View>
            {results.address ? (
              <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
                <MapPinIcon size={12} color={c.textFaint} style={{ marginRight: 3 }} />
                <Txt v="caption" tone="faint" numberOfLines={1} style={{ flex: 1 }}>{results.address}</Txt>
              </View>
            ) : null}
          </>
        )}
      </View>
      <ChevronRightIcon size={16} color={c.textFaint} />
    </PressableScale>
  );
};

export default SearchCard;