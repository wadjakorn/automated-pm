export type ThemeChoice = "light" | "dark" | "system";
export type AccentChoice = "blue" | "green" | "rose" | "amber" | "violet";
export type ThemePack = "default" | "claude" | "pixel" | "apple";

export const THEME_CHOICES: ThemeChoice[] = ["light", "dark", "system"];

export const THEME_PACKS: {
  key: ThemePack;
  label: string;
  description: string;
  supportsAccent: boolean;
}[] = [
  {
    key: "default",
    label: "Default",
    description: "Neutral workbench UI with optional accent presets.",
    supportsAccent: true,
  },
  {
    key: "claude",
    label: "Claude-like",
    description: "Warm, quiet, editorial surfaces with restrained chrome.",
    supportsAccent: false,
  },
  {
    key: "pixel",
    label: "8-bit",
    description: "Crisp edges, limited palette, and playful retro structure.",
    supportsAccent: false,
  },
  {
    key: "apple",
    label: "Apple-like",
    description: "Layered, polished, material-aware system styling.",
    supportsAccent: false,
  },
];

export const ACCENT_PRESETS: {
  key: AccentChoice;
  label: string;
  swatch: string;
}[] = [
  { key: "blue", label: "Blue", swatch: "#2563eb" },
  { key: "green", label: "Green", swatch: "#16a34a" },
  { key: "rose", label: "Rose", swatch: "#e11d48" },
  { key: "amber", label: "Amber", swatch: "#d97706" },
  { key: "violet", label: "Violet", swatch: "#7c3aed" },
];

export function isThemeChoice(value: string | null | undefined): value is ThemeChoice {
  return value === "light" || value === "dark" || value === "system";
}

export function isThemePack(value: string | null | undefined): value is ThemePack {
  return THEME_PACKS.some((pack) => pack.key === value);
}

export function isAccentChoice(value: string | null | undefined): value is AccentChoice {
  return ACCENT_PRESETS.some((preset) => preset.key === value);
}

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): "light" | "dark" {
  if (choice === "system") return prefersDark ? "dark" : "light";
  return choice;
}

export function nextChoice(current: ThemeChoice): ThemeChoice {
  return current === "light" ? "dark" : current === "dark" ? "system" : "light";
}
