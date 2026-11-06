import React, { useState } from "react";
import { View } from "react-native";
import { MagnifyingGlassIcon, XMarkIcon } from "react-native-heroicons/outline";
import Input from "./ui/Input";
import PressableScale from "./ui/PressableScale";
import { useTheme } from "../theme/theme";

const Search = ({ restaurants = [], dishes = [], setSearchInputHasValue, setSearchResults }) => {
  const { c } = useTheme();
  const [term, setTerm] = useState("");

  const handleSearchInputChange = (value) => {
    const normalized = value.trim().toLocaleLowerCase();
    setTerm(value);
    setSearchInputHasValue(normalized.length > 0);
    if (!normalized) {
      setSearchResults([]);
      return;
    }
    const all = [
      ...restaurants.map((item) => ({ ...item, searchType: "restaurant" })),
      ...dishes.map((item) => ({ ...item, searchType: "dish" })),
    ];
    setSearchResults(all.filter((item) => String(item.name || item.title || "").toLocaleLowerCase().includes(normalized)));
  };

  return (
    <View style={{ paddingHorizontal: 16 }}>
      <Input
        icon={MagnifyingGlassIcon}
        placeholder="Search restaurants and dishes"
        value={term}
        onChangeText={handleSearchInputChange}
        autoCapitalize="none"
        returnKeyType="search"
        accessibilityLabel="Search restaurants and dishes"
        style={{ marginBottom: 8 }}
        right={term ? <PressableScale onPress={() => handleSearchInputChange("")} hitSlop={10} accessibilityLabel="Clear search"><XMarkIcon size={18} color={c.textMuted} /></PressableScale> : null}
      />
    </View>
  );
};

export default Search;