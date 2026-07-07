import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "Project Manager",
  description: "Kanban board with a state machine and an LLM-friendly CLI",
};

// Runs before first paint to set the light/dark MODE from per-browser storage —
// prevents a mode flash. Pack + accent are per-project (server-side) and can't
// be known before hydration, so we seed the defaults here; <Nav> then applies
// the selected project's pack/accent (a brief theme flash on first load of a
// non-default project is the accepted tradeoff of per-project theming).
const NO_FLASH = `(function(){try{var c=localStorage.getItem('theme');var d=c==='dark'||((!c||c==='system')&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.dataset.themePack='default';document.documentElement.dataset.accent='blue';}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
