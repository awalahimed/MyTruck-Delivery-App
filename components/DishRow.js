import { View, Text, Pressable, TouchableOpacity } from "react-native";
import { MinusCircleIcon, PlusCircleIcon } from "react-native-heroicons/solid";
import React, { useState } from "react";
import SmartImage from "./ui/SmartImage";

// Lightweight ETB formatter — replaces react-currency-formatter (React 16-only)
const formatETB = (amount) => {
  const num = Number(amount) || 0;
  return `ETB ${num.toFixed(2)}`;
};
import {
  addToBasket,
  selectBasketItemsWithId,
  removeFromBasket,
} from "../features/basketSlice";
import { useDispatch, useSelector } from "react-redux";
import { getItemDiscountInfo } from "../utils/pricing";

const DishRow = ({ id, name, description, price, originalPrice, image, restaurantId }) => {
  const [isPressed, setIsPressed] = useState(false);

  const dispatch = useDispatch();
  const items = useSelector((state) => selectBasketItemsWithId(state, id));
  const info = getItemDiscountInfo({ price, originalPrice });

  const addItems = () => {
    dispatch(
      addToBasket({
        id,
        restaurantId,
        name,
        description,
        price: info.customerSellingPrice,
        merchantBasePrice: info.rawSellingPrice,
        originalPrice: info.customerOriginalPrice,
        discountedPrice: info.customerSellingPrice,
        hasDiscount: true,
        discountPercent: info.discountPercent,
        savingsAmount: info.savingsAmount,
        image,
      })
    );
  };

  const removeItemFromBasket = () => {
    if (!items.length > 0) return;

    dispatch(removeFromBasket({ id }));
  };

  return (
    <>
      <Pressable
        onPress={() => setIsPressed(!isPressed)}
        className="m-2  rounded-3xl bg-white shadow shadow-slate-200 p-4 border border-gray-200"
      >
        <View className="flex-row">
          <View className="flex-1 pr-2 justify-center">
            <Text className="text-xl mb-1 font-semibold">{name}</Text>
            <Text className="text-gray-400">{description}</Text>
            <View className="flex-row items-baseline mt-3 space-x-2">
              <Text className="text-rose-600 text-base font-bold">
                {String(info.formattedSelling || "ETB 0.00")}
              </Text>
              <Text className="text-gray-400 text-xs line-through">
                {String(info.formattedOriginal || "ETB 0.00")}
              </Text>
              <View className="bg-rose-100 px-1.5 py-0.5 rounded">
                <Text className="text-rose-600 text-[10px] font-extrabold">
                  -{String(info.discountPercent ?? 0)}% OFF
                </Text>
              </View>
            </View>
            <Text className="text-emerald-600 text-xs font-semibold mt-1">
              Save ETB {(Number(info.savingsAmount) || 0).toFixed(0)}
            </Text>
          </View>


          <View>
            <SmartImage
              uri={image}
              fallbackType="dish"
              style={{
                width: 112,
                height: 112,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "#F5FAF9",
              }}
              resizeMode="cover"
            />
            <View className="bg-white pt-3">
              <View className="flex-row items-center justify-between ">
                <TouchableOpacity onPress={removeItemFromBasket}>
                  <MinusCircleIcon
                    color={items.length > 0 ? "#179B83" : "lightgray"}
                    size={42}
                  />
                </TouchableOpacity>

                {items.length === 0 ? (
                  <Text> </Text>
                ) : (
                  <Text>{items.length}</Text>
                )}

                <TouchableOpacity onPress={addItems}>
                  <PlusCircleIcon color="#179B83" size={42} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Pressable>
    </>
  );
};

export default DishRow;
