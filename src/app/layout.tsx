import type { Metadata } from "next";
import "./globals.css";
import SidebarToggle from "@/components/SidebarToggle";

export const metadata: Metadata = {
  title: "SaarnaVideo",
  description: "Automated worship-service video composition",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fi">
      <body><SidebarToggle />{children}</body>
    </html>
  );
}
