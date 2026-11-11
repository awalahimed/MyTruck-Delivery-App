import { createSlice } from "@reduxjs/toolkit";
import { getCustomerPrice } from "../utils/pricing";

const initialState = {
  items: [],
};

export const basketSlice = createSlice({
  name: "basket",
  initialState,
  reducers: {
    // Multi-merchant cart support: users can add items from any restaurant or shop
    addToBasket: (state, action) => {
      const payload = action.payload;
      if (!payload || !payload.id) return;
      state.items.push(payload);
    },

    removeFromBasket: (state, action) => {
      const targetId = action.payload?.id;
      const index = state.items.findIndex((item) => item.id === targetId);
      if (index >= 0) {
        state.items.splice(index, 1);
      }
    },

    removeMerchantFromBasket: (state, action) => {
      const merchantId = action.payload;
      state.items = state.items.filter(
        (item) => (item.restaurantId || item.sellerId || item.shopId) !== merchantId
      );
    },

    clearBasket: (state) => {
      state.items = [];
    },

    // Re-applies the platform markup (payload = pricing config) to items already in the cart,
    // so the cart and the order always use the Super Admin's current prices.
    repriceBasket: (state, action) => {
      const cfg = action.payload || null;
      for (const item of state.items) {
        if (item.merchantBasePrice == null) continue;
        const base = Number(item.merchantBasePrice);
        if (!Number.isFinite(base) || base <= 0) continue;
        const oldPrice = Number(item.price || 0);
        const newPrice = getCustomerPrice(base, cfg);
        if (newPrice === oldPrice) continue;
        const oldOriginal = Number(item.originalPrice || oldPrice);
        const ratio = oldPrice > 0 ? oldOriginal / oldPrice : 1;
        const newOriginal = Math.max(newPrice, Math.round(newPrice * ratio));
        item.price = newPrice;
        item.discountedPrice = newPrice;
        item.originalPrice = newOriginal;
        item.savingsAmount = Math.max(0, newOriginal - newPrice);
      }
    },
  },
});

export const {
  addToBasket,
  removeFromBasket,
  removeMerchantFromBasket,
  clearBasket,
  repriceBasket,
} = basketSlice.actions;

export const selectBasketItems = (state) => state.basket.items;

export const selectBasketItemsWithId = (state, id) =>
  state.basket.items.filter((item) => item.id === id);

export const selectBasketTotal = (state) =>
  (state?.basket?.items || []).reduce((total, item) => total + Number(item?.price || 0), 0);

/**
 * Groups all cart items by merchant (restaurant or shop).
 * Returns array of { merchantId, merchantName, sellerType, items, subtotal }
 */
export const selectBasketByMerchant = (state) => {
  const items = state?.basket?.items || [];
  const map = new Map();

  for (const item of (items || [])) {
    if (!item) continue;
    const mId =
      item.restaurantId ||
      item.sellerId ||
      item.shopId ||
      "merchant_default";
    const mName =
      item.restaurantName ||
      item.sellerName ||
      item.shopName ||
      "MyTruck Partner";
    const sType = item.sellerType || (item.productType ? "shop" : "restaurant");
    const mLat = item.restaurantLat || item.merchantLat || item.lat || item.latitude || null;
    const mLng = item.restaurantLng || item.merchantLng || item.lng || item.longitude || null;
    const mAddr = item.restaurantAddress || item.merchantAddress || item.address || null;
    const mPhone = item.restaurantPhone || item.merchantPhone || item.phone || item.phoneNumber || null;
    const mCity = item.restaurantCity || item.city || null;

    if (!map.has(mId)) {
      map.set(mId, {
        merchantId: mId,
        merchantName: mName,
        sellerType: sType,
        merchantLat: mLat,
        merchantLng: mLng,
        merchantAddress: mAddr,
        merchantPhone: mPhone,
        merchantCity: mCity,
        items: [],
        subtotal: 0,
      });
    }

    const group = map.get(mId);
    if (!group.merchantLat && mLat) group.merchantLat = mLat;
    if (!group.merchantLng && mLng) group.merchantLng = mLng;
    if (!group.merchantAddress && mAddr) group.merchantAddress = mAddr;
    if (!group.merchantPhone && mPhone) group.merchantPhone = mPhone;
    if (!group.merchantCity && mCity) group.merchantCity = mCity;
    group.items.push(item);
    group.subtotal += Number(item.price || 0);
  }

  return Array.from(map.values());
};

export default basketSlice.reducer;
