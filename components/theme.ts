export type ThemeChoice = "light" | "dark" | "system";

export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): "light" | "dark" {
  if (choice === "system") return prefersDark ? "dark" : "light";
  return choice;
}

export function nextChoice(current: ThemeChoice): ThemeChoice {
  return current === "light" ? "dark" : current === "dark" ? "system" : "light";
}
