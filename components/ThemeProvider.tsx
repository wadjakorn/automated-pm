"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
  isAccentChoice,
  isThemeChoice,
  isThemePack,
  resolveTheme,
  type AccentChoice,
  type ThemeChoice,
  type ThemePack,
} from "./theme";

interface Ctx {
  choice: ThemeChoice;
  setChoice: (c: ThemeChoice) => void;
  pack: ThemePack;
  setPack: (p: ThemePack) => void;
  accent: AccentChoice;
  setAccent: (a: AccentChoice) => void;
  resolved: "light" | "dark";
}

const ThemeCtx = createContext<Ctx | null>(null);
const THEME_KEY = "theme";
const PACK_KEY = "theme-pack";
const ACCENT_KEY = "theme-accent";

function apply(resolved: "light" | "dark", pack: ThemePack, accent: AccentChoice) {
  const el = document.documentElement;
  el.classList.toggle("dark", resolved === "dark");
  el.dataset.themePack = pack;
  el.dataset.accent = accent;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>("system");
  const [pack, setPackState] = useState<ThemePack>("default");
  const [accent, setAccentState] = useState<AccentChoice>("blue");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    const storedTheme =
      typeof localStorage !== "undefined" ? localStorage.getItem(THEME_KEY) : null;
    const storedPack =
      typeof localStorage !== "undefined" ? localStorage.getItem(PACK_KEY) : null;
    const storedAccent =
      typeof localStorage !== "undefined" ? localStorage.getItem(ACCENT_KEY) : null;
    const c: ThemeChoice = isThemeChoice(storedTheme) ? storedTheme : "system";
    const p: ThemePack = isThemePack(storedPack) ? storedPack : "default";
    const a: AccentChoice = isAccentChoice(storedAccent) ? storedAccent : "blue";
    setChoiceState(c);
    setPackState(p);
    setAccentState(a);
  }, []);

  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const recompute = () => {
      const r = resolveTheme(choice, mql.matches);
      setResolved(r);
      apply(r, pack, accent);
    };
    recompute();
    if (choice === "system") {
      mql.addEventListener("change", recompute);
      return () => mql.removeEventListener("change", recompute);
    }
  }, [choice, pack, accent]);

  const setChoice = (c: ThemeChoice) => {
    try {
      localStorage.setItem(THEME_KEY, c);
    } catch {}
    setChoiceState(c);
  };

  const setPack = (p: ThemePack) => {
    try {
      localStorage.setItem(PACK_KEY, p);
    } catch {}
    setPackState(p);
  };

  const setAccent = (a: AccentChoice) => {
    try {
      localStorage.setItem(ACCENT_KEY, a);
    } catch {}
    setAccentState(a);
  };

  return (
    <ThemeCtx.Provider
      value={{ choice, setChoice, pack, setPack, accent, setAccent, resolved }}
    >
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme(): Ctx {
  const c = useContext(ThemeCtx);
  if (!c) throw new Error("useTheme must be used within ThemeProvider");
  return c;
}
