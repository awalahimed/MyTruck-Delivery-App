/**
 * MyTruck Delivery — Platform Pricing & Customer Markup Engine
 *
 * Implements authoritative pricing rules:
 * Merchant puts base price (e.g. 500 ETB) ->
 * Platform adds configured fees (e.g. 20% markup + 100 ETB flat fees) ->
 * Customer sees and purchases for 700 ETB!
 */

export const DEFAULT_PRICING_CONFIG = {
  itemMarkupPercent: 20, // 20% markup on food/grocery base price
  itemMarkupFlat: 100,   // 100 ETB flat markup per item (500 + 100 + 100 = 700 ETB)
  deliveryRatePerKm: 25, // 25 ETB per km — distance-based delivery pricing
  minimumDeliveryFee: 50, // Minimum delivery fee (2 km equivalent)
  serviceFee: 15,        // Platform service fee (ETB)
  deliveryCommissionPercent: 20, // 20% company cut from delivery fee
  commissionRate: 15,    // Platform catalog commission %
};

export const MAX_CUSTOMER_ORDER_DISTANCE_KM = 15;
export const FAR_DISTANCE_NOTICE =
  "This is more than 15 km away. For your convenience and fast delivery, please select an item nearer to you.";

/**
 * Checks if a merchant/shop is more than 15 km away from the customer's delivery location.
 * @param {Object} origin Merchant coordinates { latitude, longitude } or { lat, lng }
 * @param {Object} destination Customer coordinates { latitude, longitude } or { lat, lng }
 * @param {number} [maxKm=15]
 * @returns {boolean}
 */
export function isFarDistance(origin, destination, maxKm = MAX_CUSTOMER_ORDER_DISTANCE_KM) {
  const oLat = origin?.latitude ?? origin?.lat;
  const oLon = origin?.longitude ?? origin?.lng;
  const dLat = destination?.latitude ?? destination?.lat;
  const dLon = destination?.longitude ?? destination?.lng;
  if (oLat == null || oLon == null || dLat == null || dLon == null) return false;
  const dist = calculateDistanceKm(oLat, oLon, dLat, dLon);
  return dist > maxKm;
}

/**
 * Calculates straight-line spherical distance between two coordinates in kilometers (Haversine formula).
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Distance in kilometers (rounded to 1 decimal place)
 */
export function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const nLat1 = Number(lat1);
  const nLon1 = Number(lon1);
  const nLat2 = Number(lat2);
  const nLon2 = Number(lon2);

  if (isNaN(nLat1) || isNaN(nLon1) || isNaN(nLat2) || isNaN(nLon2)) {
    return 2.0; // Default 2 km → 50 ETB minimum delivery fee
  }

  const R = 6371; // Earth's radius in km
  const dLat = ((nLat2 - nLat1) * Math.PI) / 180;
  const dLon = ((nLon2 - nLon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((nLat1 * Math.PI) / 180) *
      Math.cos((nLat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c;
  return Number(d.toFixed(1));
}

/**
 * Calculates delivery quote using distance-based pricing: 25 ETB per km.
 * - Minimum fee: 50 ETB (covers first 2 km)
 * - Rate: 25 ETB/km on actual Haversine distance
 * - ETA: estimated delivery time in minutes
 * - Intercity: flagged when distance > 20 km or cities differ
 *
 * @param {Object} origin { latitude, longitude, city }
 * @param {Object} destination { latitude, longitude, city }
 * @param {Object} [options] Custom pricing overrides
 * @returns {Object} Quote: distanceKm, etaMinutes, deliveryFee, isIntercity, ratePerKm
 */
export function calculateDeliveryQuote(origin, destination, options = {}) {
  const oLat = origin?.latitude || origin?.lat || 8.992;
  const oLon = origin?.longitude || origin?.lng || 38.752;
  const dLat = destination?.latitude || destination?.lat || 8.978;
  const dLon = destination?.longitude || destination?.lng || 38.775;

  const distanceKm = calculateDistanceKm(oLat, oLon, dLat, dLon);

  // Check if explicit city names differ or distance exceeds 20 km
  const originCity = String(origin?.city || "").trim().toLowerCase();
  const destCity = String(destination?.city || "").trim().toLowerCase();
  const cityMismatch =
    originCity && destCity && originCity !== destCity && !destCity.includes(originCity) && !originCity.includes(destCity);

  const isIntercity = Boolean(options.forceIntercity || distanceKm > 20 || cityMismatch);

  // Distance-based rate: 25 ETB/km, minimum 50 ETB
  const ratePerKm = Number(options.deliveryRatePerKm || DEFAULT_PRICING_CONFIG.deliveryRatePerKm || 25);
  const minimumFee = Number(options.minimumDeliveryFee || DEFAULT_PRICING_CONFIG.minimumDeliveryFee || 50);

  const rawFee = distanceKm * ratePerKm;
  const deliveryFee = Math.max(minimumFee, Math.round(rawFee));

  // ETA: local 15–45 min, intercity adds time proportional to distance
  const etaMinutes = isIntercity
    ? Math.round(35 + distanceKm * 1.5)
    : Math.max(15, Math.round(15 + distanceKm * 2.5));

  return {
    distanceKm,
    etaMinutes,
    deliveryFee,
    isIntercity,
    ratePerKm,
    minimumDeliveryFee: minimumFee,
    originLat: Number(oLat),
    originLng: Number(oLon),
    destLat: Number(dLat),
    destLng: Number(dLon),
  };
}

/**
 * Authoritative Order Financials & Commission Engine.
 *
 * Distance-based delivery pricing (25 ETB/km, min 50 ETB):
 * - Customer pays: subtotal + serviceFee + deliveryFee (e.g. 455 + 15 + 105 = 575 ETB for 4.2 km)
 * - Restaurant gets: subtotal (e.g. 455 ETB, 100% of items)
 * - Rider gets: deliveryFee minus 20% company cut (e.g. 105 - 21 = 84 ETB, 80% of delivery fee)
 * - Company keeps: serviceFee (15 ETB) + 20% cut from delivery (21 ETB) = 36 ETB
 * - Integrity Check: 455 + 84 + 36 = 575 ETB ✓
 *
 * @param {Object} params
 * @param {number} params.subtotal Net items price (merchant gets 100%)
 * @param {number} [params.deliveryFee=50] Delivery fee paid by customer (distance-based)
 * @param {number} [params.serviceFee=15] Service fee paid by customer
 * @param {number} [params.deliveryCommissionPercent=20] Company commission on delivery fee
 * @returns {Object} Complete financial breakdown
 */
export function calculateOrderFinancials({
  subtotal = 0,
  deliveryFee = 50,
  serviceFee = 15,
  deliveryCommissionPercent = 20,
} = {}) {
  const cleanSubtotal = Number((Number(subtotal) || 0).toFixed(2));
  const cleanDeliveryFee = Number((Number(deliveryFee) || 50).toFixed(2));
  const cleanServiceFee = Number((Number(serviceFee) != null ? Number(serviceFee) : 15).toFixed(2));
  const cleanCommPct = Number(deliveryCommissionPercent != null ? deliveryCommissionPercent : 20);

  // Total paid by customer
  const total = Number((cleanSubtotal + cleanDeliveryFee + cleanServiceFee).toFixed(2));

  // Restaurant gets 100% of their item sales
  const restaurantEarnings = cleanSubtotal;

  // Company takes 20% commission on the delivery fee
  const deliveryCommission = Number(((cleanDeliveryFee * cleanCommPct) / 100).toFixed(2));

  // Rider gets delivery fee minus 20% company cut
  const driverEarnings = Number((cleanDeliveryFee - deliveryCommission).toFixed(2));

  // Company keeps service fee + delivery commission
  const companyProfit = Number((cleanServiceFee + deliveryCommission).toFixed(2));

  // Total amount company needs to transfer out (Restaurant + Driver)
  const totalOwedOut = Number((restaurantEarnings + driverEarnings).toFixed(2));

  // Mathematical balance verification
  const isBalanced = Math.abs(total - (restaurantEarnings + driverEarnings + companyProfit)) < 0.01;

  return {
    subtotal: cleanSubtotal,
    deliveryFee: cleanDeliveryFee,
    serviceFee: cleanServiceFee,
    total,
    deliveryCommissionPercent: cleanCommPct,
    deliveryCommission,
    restaurantEarnings,
    driverEarnings,
    companyProfit,
    totalOwedOut,
    isBalanced,
  };
}

/**
 * Aggregates financial transactions across completed/paid orders for reporting and dashboards.
 *
 * Example: 20 orders @ 530 ETB
 * - Money received: 20 × 530 = 10,600 ETB
 * - Owed to the restaurant: 20 × 455 = 9,100 ETB
 * - Owed to riders: 20 × 48 = 960 ETB
 * - Company profit: 20 × 27 = 540 ETB
 * - Total owed out: 9,100 + 960 = 10,060 ETB
 * - Verification: 9,100 + 960 + 540 = 10,600 ETB ✓
 *
 * @param {Array} orders List of order objects
 * @param {Array} [driverPayouts=[]] List of recorded driver payout settlements
 * @returns {Object} Comprehensive financial report
 */
export function aggregateFinancialMetrics(orders = [], driverPayouts = []) {
  let completedOrdersCount = 0;
  let totalOrdersCount = orders.length;
  let totalReceived = 0; // Gross GMV paid by customers
  let restaurantBalancePayable = 0; // Owed to restaurants/shops
  let driverTotalEarnings = 0; // Owed to drivers (80% of delivery fee)
  let totalDeliveryFees = 0;
  let totalServiceFees = 0;
  let companyDeliveryCommission = 0; // 20% cut of delivery fees
  let totalCompanyProfit = 0; // Service fees + Delivery commissions

  // Track unique processed orders to prevent duplicate calculations
  const processedOrderIds = new Set();

  for (const o of orders) {
    if (!o) continue;
    const isCompleteOrPaid =
      o.status === "COMPLETE" ||
      o.status === "DELIVERED" ||
      o.paymentStatus === "PAID" ||
      (o.paymentMethod === "COD" && o.status === "COMPLETE");

    if (!isCompleteOrPaid) continue;

    // Idempotency check: avoid double-counting
    const idKey = String(o.id || o.orderId || Math.random());
    if (processedOrderIds.has(idKey)) continue;
    processedOrderIds.add(idKey);

    completedOrdersCount += 1;

    // Resolve order financial figures
    const subtotal = Number(o.subtotal || o.merchantBaseSubtotal || (o.total ? o.total - 75 : 0)) || 0;
    const deliveryFee = Number(o.deliveryFee || 50);
    const serviceFee = Number(o.serviceFee != null ? o.serviceFee : 15);
    const commPct = Number(o.deliveryCommissionPercent != null ? o.deliveryCommissionPercent : 20);

    const fin = calculateOrderFinancials({
      subtotal,
      deliveryFee,
      serviceFee,
      deliveryCommissionPercent: commPct,
    });

    totalReceived += fin.total;
    restaurantBalancePayable += fin.restaurantEarnings;
    driverTotalEarnings += fin.driverEarnings;
    totalDeliveryFees += fin.deliveryFee;
    totalServiceFees += fin.serviceFee;
    companyDeliveryCommission += fin.deliveryCommission;
    totalCompanyProfit += fin.companyProfit;
  }

  // Calculate transferred driver payouts from settlements
  let totalPaidToDrivers = 0;
  const processedPayoutIds = new Set();
  for (const p of driverPayouts) {
    if (!p) continue;
    const pId = String(p.id || Math.random());
    if (processedPayoutIds.has(pId)) continue;
    processedPayoutIds.add(pId);
    if (p.status === "TRANSFERRED" || p.status === "COMPLETED" || p.status === "PAID") {
      totalPaidToDrivers += Number(p.amount || 0);
    }
  }

  // Outstanding driver payments remaining to be transferred
  const driverOutstandingBalance = Math.max(0, Number((driverTotalEarnings - totalPaidToDrivers).toFixed(2)));

  // Total liabilities owed out to partners
  const totalOwedOut = Number((restaurantBalancePayable + driverTotalEarnings).toFixed(2));

  // Net money remaining with company after current driver transfers
  const companyRemainingCash = Number((totalReceived - restaurantBalancePayable - totalPaidToDrivers).toFixed(2));

  return {
    totalOrdersCount,
    completedOrdersCount,
    totalReceived: Number(totalReceived.toFixed(2)),
    restaurantBalancePayable: Number(restaurantBalancePayable.toFixed(2)),
    driverTotalEarnings: Number(driverTotalEarnings.toFixed(2)),
    totalDeliveryFees: Number(totalDeliveryFees.toFixed(2)),
    totalServiceFees: Number(totalServiceFees.toFixed(2)),
    companyDeliveryCommission: Number(companyDeliveryCommission.toFixed(2)),
    totalCompanyProfit: Number(totalCompanyProfit.toFixed(2)),
    totalPaidToDrivers: Number(totalPaidToDrivers.toFixed(2)),
    driverOutstandingBalance,
    totalOwedOut,
    companyRemainingCash,
  };
}

/**
 * Calculates the customer-facing retail price from merchant base price.
 * @param {number|string} merchantBasePrice The price entered by the restaurant or shop
 * @param {Object} [config] Platform pricing configuration
 * @returns {number} The customer retail price (e.g. 700 ETB for 500 ETB merchant price)
 */
export function getCustomerPrice(merchantBasePrice, config = null) {
  const base = Number(merchantBasePrice || 0);
  if (base <= 0) return 0;

  const cfg = config || DEFAULT_PRICING_CONFIG;
  const markupPercent = Number(cfg.itemMarkupPercent != null ? cfg.itemMarkupPercent : DEFAULT_PRICING_CONFIG.itemMarkupPercent);
  const markupFlat = Number(cfg.itemMarkupFlat != null ? cfg.itemMarkupFlat : DEFAULT_PRICING_CONFIG.itemMarkupFlat);

  // Example: 500 + (500 * 0.20 = 100) + 100 = 700 ETB
  const markedUp = Math.round(base * (1 + markupPercent / 100) + markupFlat);
  return markedUp;
}

/**
 * Calculates price breakdown for an item
 */
export function getItemPriceBreakdown(merchantBasePrice, config = null) {
  const base = Number(merchantBasePrice || 0);
  const customerPrice = getCustomerPrice(base, config);
  const platformFee = Math.max(0, customerPrice - base);

  return {
    merchantBasePrice: base,
    customerPrice,
    platformFee,
  };
}

/**
 * Universal Discount & Retail Pricing Resolver.
 * Guarantees that every item (whether seeded, fallback, or merchant-submitted)
 * provides transparent, attractive crossed-out old price and selling price.
 *
 * @param {Object} item Dish or Product object
 * @param {Object} [config] Platform pricing configuration
 * @returns {Object} Complete discount and retail breakdown
 */
export function getItemDiscountInfo(item, config = null) {
  if (!item) {
    return {
      customerSellingPrice: 0,
      customerOriginalPrice: 0,
      discountPercent: 0,
      hasDiscount: false,
      savingsAmount: 0,
      formattedSelling: "ETB 0.00",
      formattedOriginal: "ETB 0.00",
    };
  }

  const rawPrice = Number(item.price || item.discountedPrice || 0);
  const customerSellingPrice = getCustomerPrice(rawPrice, config);

  let rawOriginalPrice = 0;
  if (item.originalPrice && Number(item.originalPrice) > rawPrice) {
    rawOriginalPrice = Number(item.originalPrice);
  } else if (item.discountPercent && Number(item.discountPercent) > 0 && Number(item.discountPercent) < 100) {
    rawOriginalPrice = Math.round(rawPrice / (1 - Number(item.discountPercent) / 100));
  } else {
    // Seeded attractive promotional discount: 20% to 25% OFF
    rawOriginalPrice = Math.round(rawPrice * 1.25);
  }

  let customerOriginalPrice = getCustomerPrice(rawOriginalPrice, config);

  // Guarantee that customerOriginalPrice is always strictly higher than customerSellingPrice for visual integrity
  if (customerOriginalPrice <= customerSellingPrice && customerSellingPrice > 0) {
    customerOriginalPrice = Math.round(customerSellingPrice * 1.25);
  }

  const savingsAmount = Math.max(0, customerOriginalPrice - customerSellingPrice);
  const discountPercent =
    customerOriginalPrice > 0 && savingsAmount > 0
      ? Math.round((savingsAmount / customerOriginalPrice) * 100)
      : (item.discountPercent || 20);

  return {
    customerSellingPrice,
    customerOriginalPrice,
    rawSellingPrice: rawPrice,
    rawOriginalPrice,
    discountPercent,
    hasDiscount: savingsAmount > 0,
    savingsAmount,
    formattedSelling: `ETB ${Number(customerSellingPrice).toFixed(2)}`,
    formattedOriginal: `ETB ${Number(customerOriginalPrice).toFixed(2)}`,
  };
}


