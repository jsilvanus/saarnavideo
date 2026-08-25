import type { Metadata } from "next";
import "./globals.css";
import SidebarToggle from "@/components/SidebarToggle";
import YouTubeConnection from "@/components/YouTubeConnection";

export const metadata: Metadata = {
  title: "SaarnaVideo",
  description: "Automated worship-service video composition",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fi">
      <body>
        <SidebarToggle />
        <YouTubeConnection />
        <nav style={{ position: "fixed", top: 12, right: 16, zIndex: 1000 }}>
          <a href="/assets" style={{ background: "white", border: "1px solid #ccc", borderRadius: 8, padding: "8px 12px", textDecoration: "none", color: "inherit", boxShadow: "0 1px 4px #0002" }}>Graphics library</a>
        </nav>
        {children}
      </body>
    </html>
  );
}
