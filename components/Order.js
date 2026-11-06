import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { collection, query, where, getDocs } from "firebase/firestore";
import { ShoppingBagIcon } from "react-native-heroicons/outline";
import { db } from "../firebase";
import DishInfo from "./DishInfo";
import Collapsible from "./ui/Collapsible";
import Txt from "./ui/Txt";
import { Skeleton } from "./ui/Skeleton";
import { statusInfo } from "../constants/orderStatus";
import { money, formatDate } from "../utils/format";
import { useTheme, toneColors } from "../theme/theme";

const Order = ({ orderId, status, timestamp, restaurantName, total }) => {
  const { c, radius, shadow } = useTheme();
  const [dishes, setDishes] = useState(null);
  const info = statusInfo(status);
  const tone = toneColors(c, info.tone);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, "orderDishes"), where("orderId", "==", orderId)));
        const items = [];
        snap.forEach((d) => items.push({ ...d.data() }));
        if (alive) setDishes(items);
      } catch (e) {
        if (alive) setDishes([]);
      }
    })();
    return () => { alive = false; };
  }, [orderId]);

  const count = dishes ? dishes.reduce((s, d) => s + Number(d.quantity || 1), 0) : null;

  return (
    <View style={[{ backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: 14 }, shadow.card]}>
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <View style={{ flex: 1, marginRight: 10 }}>
          <Txt v="heading" numberOfLines={1}>{restaurantName || "Order"}</Txt>
          <Txt v="caption" tone="muted" style={{ marginTop: 2 }}>
            {formatDate(timestamp)} · #{String(orderId).slice(0, 6).toUpperCase()}
          </Txt>
        </View>
        <Txt v="heading">{money(total)}</Txt>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 10 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone.fg, marginRight: 6 }} />
        <Txt v="caption" style={{ color: tone.fg, fontWeight: "800" }}>{info.label}</Txt>
      </View>

      <View style={{ height: 1, backgroundColor: c.border, marginTop: 12 }} />
      {dishes === null ? (
        <Skeleton width="35%" height={12} style={{ marginTop: 14 }} />
      ) : dishes.length ? (
        <Collapsible bare icon={ShoppingBagIcon} title={`${count} item${count === 1 ? "" : "s"}`} style={{ marginTop: 2 }}>
          {dishes.map((d, i) => <DishInfo key={`${d.dishId}-${i}`} id={d.dishId} quantity={d.quantity} />)}
        </Collapsible>
      ) : null}
    </View>
  );
};

export default Order;