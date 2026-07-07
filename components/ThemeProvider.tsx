"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
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
// Only the light/dark MODE is persisted per-browser. Pack + accent now live on
// the project (server-side) and are applied by <Nav> from the selected project.
const THEME_KEY = "theme";

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
    if (isThemeChoice(storedTheme)) setChoiceState(storedTheme);
    // Pack + accent are not read from storage — <Nav> applies them from the
    // selected project once projects load.
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

  const setChoice = useCallback((c: ThemeChoice) => {
    try {
      localStorage.setItem(THEME_KEY, c);
    } catch {}
    setChoiceState(c);
  }, []);

  // Pack + accent are applied only (no per-browser persistence). Persistence is
  // the project's job: the appearance editor writes them to the project via the
  // API, and <Nav> re-applies the selected project's values on navigation. An
  // unknown value falls back to the default so stale data can't break the UI.
  const setPack = useCallback((p: ThemePack) => {
    setPackState(isThemePack(p) ? p : "default");
  }, []);

  const setAccent = useCallback((a: AccentChoice) => {
    setAccentState(isAccentChoice(a) ? a : "blue");
  }, []);

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
