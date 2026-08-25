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
      <body><SidebarToggle /><YouTubeConnection />{children}</body>
    </html>
  );
}
