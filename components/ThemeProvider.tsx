"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { resolveTheme, type ThemeChoice } from "./theme";

interface Ctx {
  choice: ThemeChoice;
  setChoice: (c: ThemeChoice) => void;
  resolved: "light" | "dark";
}
const ThemeCtx = createContext<Ctx | null>(null);
const KEY = "theme";

function apply(resolved: "light" | "dark") {
  const el = document.documentElement;
  el.classList.toggle("dark", resolved === "dark");
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  // On mount, read the stored choice and sync to the DOM/media query.
  useEffect(() => {
    const stored = (typeof localStorage !== "undefined" && localStorage.getItem(KEY)) as ThemeChoice | null;
    const c: ThemeChoice = stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
    setChoiceState(c);
  }, []);

  // Re-resolve whenever the choice changes, and follow the OS when on "system".
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const recompute = () => {
      const r = resolveTheme(choice, mql.matches);
      setResolved(r);
      apply(r);
    };
    recompute();
    if (choice === "system") {
      mql.addEventListener("change", recompute);
      return () => mql.removeEventListener("change", recompute);
    }
  }, [choice]);

  const setChoice = (c: ThemeChoice) => {
    try {
      localStorage.setItem(KEY, c);
    } catch {
      /* ignore (private mode) */
    }
    setChoiceState(c);
  };

  return <ThemeCtx.Provider value={{ choice, setChoice, resolved }}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): Ctx {
  const c = useContext(ThemeCtx);
  if (!c) throw new Error("useTheme must be used within ThemeProvider");
  return c;
}
