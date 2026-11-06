import React from "react";
import { Image, Text, Pressable } from "react-native";

export default function CategoriesCard({ imgUrl, title, onPress }) {
  return (
    <Pressable
      onPress={onPress ?? (() => {})}
      className="relative mr-2"
      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
    >
      <Image
        source={{ uri: imgUrl }}
        className="h-24 w-24 rounded-2xl"
      />
      <Text className="absolute bottom-1 left-1 text-white font-bold">
        {title}
      </Text>
    </Pressable>
  );
}
