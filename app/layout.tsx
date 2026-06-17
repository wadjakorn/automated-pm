import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Project Manager",
  description: "Kanban board with a state machine and an LLM-friendly CLI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
