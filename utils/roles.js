/**
 * Single source of truth for what a signed-in account is allowed to open.
 * Roles are assigned in the Admin dashboard (customer, restaurant, shop,
 * driver, mini_admin, superadmin) or by seller sign-up (pendingSeller).
 *
 * UI gating only — data protection must still come from Firestore rules.
 */

// The platform owner account(s): exact matches only, never substrings like "admin".
const SUPER_ADMIN_EMAILS = ["superadmin@mytruck.et", "admin@mytruck.et"];
const SUPER_ADMIN_PHONE = "251911000001";

const normRole = (role) => String(role || "").toLowerCase().replace(/[-_\s]/g, "").trim();

export function getRoleInfo(user, dbUser) {
  const role = normRole(dbUser?.role);
  // Owner identity comes from the sign-in account only — never from editable profile fields
  // (anyone can type the owner's number into their own profile phone).
  const authEmail = String(user?.email || "").toLowerCase().trim();
  const isOwnerAccount =
    SUPER_ADMIN_EMAILS.includes(authEmail) || authEmail === `${SUPER_ADMIN_PHONE}@login.mytruck.local`;

  const isMiniAdmin = role === "miniadmin" || dbUser?.isMiniAdmin === true;
  const isStaffAdmin =
    isOwnerAccount ||
    role === "superadmin" ||
    role === "admin" ||
    isMiniAdmin ||
    dbUser?.isSuperAdmin === true ||
    dbUser?.isAdmin === true;

  const isDriver = role === "driver";
  const isSeller = ["pendingseller", "shop", "restaurant", "seller"].includes(role);
  // Anyone who isn't staff, a driver or a store is a customer (new accounts may have no role yet)
  const isCustomer = !isStaffAdmin && !isDriver && !isSeller;

  const status = String(dbUser?.accountStatus || "").toUpperCase();
  // Admins can't lock themselves out
  const isBlocked = !isStaffAdmin && (status === "BANNED" || status === "SUSPENDED");

  return { role, isOwnerAccount, isMiniAdmin, isStaffAdmin, isDriver, isSeller, isCustomer, isBlocked, accountStatus: status };
}

export function homeRouteFor(info) {
  if (info.isStaffAdmin) return "AdminDashboard";
  if (info.isDriver) return "DriverDashboard";
  if (info.isSeller) return "SellerHome";
  return "Home";
}
