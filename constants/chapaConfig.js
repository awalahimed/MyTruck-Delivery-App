/**
 * Chapa Payment Gateway Configuration (client side)
 *
 * Only the PUBLIC key may live in the app. The secret key is a Firebase secret
 * used by the Cloud Functions in functions/index.js
 * (createChapaCheckout / verifyChapaPayment):
 *   firebase functions:secrets:set CHAPA_SECRET_KEY
 */
export const CHAPA_CONFIG = {
  BASE_URL: "https://api.chapa.co/v1",
  PUBLIC_KEY: "CHAPUBK-6GYkFNPBH58i3J0bGemrXBELG2ukStJi",
};

export default CHAPA_CONFIG;
