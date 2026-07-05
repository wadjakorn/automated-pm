import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "Project Manager",
  description: "Kanban board with a state machine and an LLM-friendly CLI",
};

// Runs before first paint to set theme mode/pack/accent from storage — prevents a flash.
const NO_FLASH = `(function(){try{var c=localStorage.getItem('theme');var p=localStorage.getItem('theme-pack');var a=localStorage.getItem('theme-accent');var d=c==='dark'||((!c||c==='system')&&matchMedia('(prefers-color-scheme: dark)').matches);var pack=p==='claude'||p==='pixel'||p==='apple'||p==='default'?p:'default';var accent=a==='green'||a==='rose'||a==='amber'||a==='violet'||a==='blue'?a:'blue';document.documentElement.classList.toggle('dark',d);document.documentElement.dataset.themePack=pack;document.documentElement.dataset.accent=accent;}catch(e){}})();`;

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
