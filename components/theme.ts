export type ThemeChoice = "light" | "dark" | "system";
export type AccentChoice = "blue" | "green" | "rose" | "amber" | "violet";
export type ThemePack =
  | "default"
  | "claude"
  | "pixel"
  | "apple"
  | "nord"
  | "dracula"
  | "solarized"
  | "gruvbox"
  | "tokyonight"
  | "catppuccin"
  | "monokai"
  | "onedark"
  | "ayu"
  | "rosepine"
  | "everforest"
  | "highcontrast";

export const THEME_CHOICES: ThemeChoice[] = ["light", "dark", "system"];

// `swatch` is [surface, accent, secondary] — three representative colors shown
// as preview dots in Appearance so a long pack list stays scannable.
export const THEME_PACKS: {
  key: ThemePack;
  label: string;
  description: string;
  supportsAccent: boolean;
  swatch: [string, string, string];
}[] = [
  {
    key: "default",
    label: "Default",
    description: "Neutral workbench UI with optional accent presets.",
    supportsAccent: true,
    swatch: ["#ffffff", "#0969da", "#1f2328"],
  },
  {
    key: "claude",
    label: "Claude-like",
    description: "Warm, quiet, editorial surfaces with restrained chrome.",
    supportsAccent: false,
    swatch: ["#f7f3ed", "#a4632a", "#2f2418"],
  },
  {
    key: "pixel",
    label: "8-bit",
    description: "Crisp edges, limited palette, and playful retro structure.",
    supportsAccent: false,
    swatch: ["#12121a", "#ff6b6b", "#8cf0d8"],
  },
  {
    key: "apple",
    label: "Apple-like",
    description: "Layered, polished, material-aware system styling.",
    supportsAccent: false,
    swatch: ["#f4f5f8", "#0a84ff", "#111827"],
  },
  {
    key: "nord",
    label: "Nord",
    description: "Arctic, cool blue-gray palette with low-contrast calm.",
    supportsAccent: false,
    swatch: ["#2e3440", "#88c0d0", "#eceff4"],
  },
  {
    key: "dracula",
    label: "Dracula",
    description: "Dark charcoal with vivid purple, pink, and green accents.",
    supportsAccent: false,
    swatch: ["#282a36", "#bd93f9", "#50fa7b"],
  },
  {
    key: "solarized",
    label: "Solarized",
    description: "Ethan Schoonover's precision palette, light and dark.",
    supportsAccent: false,
    swatch: ["#002b36", "#268bd2", "#859900"],
  },
  {
    key: "gruvbox",
    label: "Gruvbox",
    description: "Warm retro groove with earthy, high-comfort contrast.",
    supportsAccent: false,
    swatch: ["#282828", "#fe8019", "#b8bb26"],
  },
  {
    key: "tokyonight",
    label: "Tokyo Night",
    description: "Sleek deep-blue toned workspace with neon accents.",
    supportsAccent: false,
    swatch: ["#1a1b26", "#7aa2f7", "#bb9af7"],
  },
  {
    key: "catppuccin",
    label: "Catppuccin",
    description: "Soft pastel palette — Latte by day, Mocha by night.",
    supportsAccent: false,
    swatch: ["#1e1e2e", "#cba6f7", "#89b4fa"],
  },
  {
    key: "monokai",
    label: "Monokai Pro",
    description: "Vivid syntax colors over a warm charcoal base.",
    supportsAccent: false,
    swatch: ["#2d2a2e", "#ff6188", "#a9dc76"],
  },
  {
    key: "onedark",
    label: "One Dark",
    description: "Balanced Atom-classic developer palette.",
    supportsAccent: false,
    swatch: ["#282c34", "#61afef", "#c678dd"],
  },
  {
    key: "ayu",
    label: "Ayu",
    description: "Deep background with high-contrast, amber-forward syntax.",
    supportsAccent: false,
    swatch: ["#1f2430", "#ffcc66", "#73d0ff"],
  },
  {
    key: "rosepine",
    label: "Rosé Pine",
    description: "Muted natural pine and rose with a soho-lounge mood.",
    supportsAccent: false,
    swatch: ["#191724", "#c4a7e7", "#ebbcba"],
  },
  {
    key: "everforest",
    label: "Everforest",
    description: "Comfy, low-contrast green forest palette.",
    supportsAccent: false,
    swatch: ["#2d353b", "#a7c080", "#dbbc7f"],
  },
  {
    key: "highcontrast",
    label: "High Contrast",
    description: "Maximum-contrast pack tuned for WCAG AAA accessibility.",
    supportsAccent: false,
    swatch: ["#000000", "#ffd400", "#ffffff"],
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
