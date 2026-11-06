import React, { useState, useEffect } from "react";
import { View, Text, ScrollView, TouchableOpacity } from "react-native";
import { ArrowRightIcon } from "react-native-heroicons/outline";
import RestaurantCard from "./RestaurantCard";
import { db } from "../firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useNavigation } from "@react-navigation/native";

const FeaturedRow = ({ id, title, description, featuredCategory }) => {
  const [restaurant, setRestaurant] = useState([]);
  const navigation = useNavigation();

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const resRef = collection(db, "restaurants");
        const snapshot = await getDocs(resRef);
        const restaurants = [];
        snapshot.forEach((doc) => {
          restaurants.push({ ...doc.data(), id: doc.id });
        });
        if (active) setRestaurant(restaurants);
      } catch (e) {
        console.warn("FeaturedRow: could not load restaurants", e?.message);
      }
    })();
    return () => { active = false; };
  }, []);

  return (
    <View>
      <View className="mt-4 flex-row items-center justify-between px-4">
        <Text className="font-bold text-2xl">{title}</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate("Home")}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ArrowRightIcon color="#179B83" />
        </TouchableOpacity>
      </View>

      <Text className="text-sm text-gray-500 px-4">{description}</Text>

      <ScrollView
        horizontal
        contentContainerStyle={{ paddingHorizontal: 15 }}
        showsHorizontalScrollIndicator={false}
        className="pt-4"
      >
        {restaurant.map((item) => (
          <RestaurantCard
            key={item.id}
            id={item.id}
            title={item.name}
            rating={item.rating}
            description={item.description}
            address={item.address}
            image={item.image}
            genre={item.genre}
            lat={item.lat}
            lng={item.lng}
            minDeliveryTime={item.minDeliveryTime}
            maxDeliveryTime={item.maxDeliveryTime}
          />
        ))}
      </ScrollView>
    </View>
  );
};

export default FeaturedRow;
