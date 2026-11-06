import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import SmartImage from "./ui/SmartImage";
import Txt from "./ui/Txt";
import { useTheme } from "../theme/theme";

const DishInfo = ({ id, quantity }) => {
  const { c } = useTheme();
  const [dish, setDish] = useState({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "dishes", id));
        if (alive && snap.exists()) setDish(snap.data());
      } catch (e) {
        console.warn("Could not load dish", e.message);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 5 }}>
      <SmartImage uri={dish.image} style={{ width: 36, height: 36, borderRadius: 10, marginRight: 10 }} />
      <Txt v="body" style={{ flex: 1, fontWeight: "600" }} numberOfLines={1}>{dish.name || "Item"}</Txt>
      <Txt v="caption" style={{ color: c.primary, fontWeight: "800" }}>×{quantity}</Txt>
    </View>
  );
};

export default DishInfo;