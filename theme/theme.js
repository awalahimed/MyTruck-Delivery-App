// MyTruck brand theme
const brand = {
  primary: "#179B83",
  accent: "#F47721",
  dark: "#0B2A26",
  bg: "#F5FAF9",
};

const colors = {
  primary: brand.primary,
  accent: brand.accent,
  dark: brand.dark,
  bg: brand.bg,
  surface: "#FFFFFF",
  surfaceAlt: "#F1F5F9",
  border: "#E2E8F0",
  text: "#0F172A",
  textMuted: "#64748B",
  textFaint: "#94A3B8",
  error: "#EF4444",
  errorBg: "#FEE2E2",
  primaryTint: "#E6F7F2",
  // extras referenced by agent-rewritten screens
  danger: "#EF4444",
  dangerTint: "#FEE2E2",
};

const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
};

const shadow = {
  card: {
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  float: {
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 6,
  },
};

export function useTheme() {
  return { c: colors, radius, shadow, brand, dark: false };
}

export { brand, colors };

export function toneColors(c, tone) {
  const map = {
    success: { fg: "#166534", bg: "#DCFCE7" },
    warning: { fg: "#A16207", bg: "#FEF9C3" },
    error:   { fg: "#B91C1C", bg: "#FEE2E2" },
    info:    { fg: "#1E40AF", bg: "#DBEAFE" },
    muted:   { fg: c?.textMuted || "#64748B", bg: "#F1F5F9" },
    primary: { fg: c?.primary || "#179B83", bg: c?.primaryTint || "#E6F7F2" },
  };
  return map[tone] || map.muted;
}
