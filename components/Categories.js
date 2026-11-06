import { ScrollView } from "react-native";
import React, { useEffect, useState } from "react";
import CategoryCard from "./CategoryCard";
import { db } from "../firebase";
import { collection, getDocs } from "firebase/firestore";

const FALLBACK_CATEGORIES = [
  { title: "Pizza",   imgUrl: "https://i.postimg.cc/Y0xGVM7b/pizza-crop.jpg" },
  { title: "Burger",  imgUrl: "https://i.postimg.cc/x1ZkBsrD/burger-crop.jpg" },
  { title: "Biryani", imgUrl: "https://i.postimg.cc/4NTQSx6b/biryani-crop.jpg" },
  { title: "Sandwich",imgUrl: "https://i.postimg.cc/zDTnKYsL/sandwich-crop.jpg" },
  { title: "Pasta",   imgUrl: "https://i.postimg.cc/Zq9NqGP5/pasta-crop.jpg" },
  { title: "Pastry",  imgUrl: "https://i.postimg.cc/LXKJ8n6x/pastry-crop.jpg" },
];

const Categories = ({ onCategorySelect }) => {
  const [categories, setCategories] = useState(FALLBACK_CATEGORIES);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const snap = await getDocs(collection(db, "categories"));
        if (!active) return;
        const remote = [];
        snap.forEach((d) => {
          const data = d.data();
          if (data.title && data.imgUrl) remote.push({ title: data.title, imgUrl: data.imgUrl });
        });
        if (remote.length > 0) setCategories(remote);
      } catch {
        // keep fallback
      }
    })();
    return () => { active = false; };
  }, []);

  return (
    <ScrollView
      horizontal
      contentContainerStyle={{ paddingHorizontal: 15, paddingTop: 10 }}
      showsHorizontalScrollIndicator={false}
    >
      {categories.map((cat, i) => (
        <CategoryCard
          key={i}
          imgUrl={cat.imgUrl}
          title={cat.title}
          onPress={() => onCategorySelect?.(cat.title)}
        />
      ))}
    </ScrollView>
  );
};

export default Categories;
