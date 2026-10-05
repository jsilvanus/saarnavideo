import type { Metadata } from "next";
import "./globals.css";
import SidebarToggle from "@/components/SidebarToggle";
import TopNav from "@/components/TopNav";
import YouTubeConnection from "@/components/YouTubeConnection";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getServerLocale } from "@/i18n/server";

export const metadata: Metadata = {
  title: "SaarnaVideo",
  description: "Automated worship-service video composition",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The chosen language is a cookie; without one the browser's Accept-Language decides (Finnish when unsupported).
  const locale = await getServerLocale();
  return (
    <html lang={locale}>
      <body>
        <I18nProvider initialLocale={locale}>
          <SidebarToggle />
          <YouTubeConnection />
          <TopNav />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
