import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import SidebarToggle from "@/components/SidebarToggle";
import TopNav from "@/components/TopNav";
import YouTubeConnection from "@/components/YouTubeConnection";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getServerLocale } from "@/i18n/server";
import { accessSecret } from "@/lib/access-gate";

export const metadata: Metadata = {
  title: "SaarnaVideo",
  description: "Automated worship-service video composition",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The chosen language is a cookie; without one the browser's Accept-Language decides (Finnish when unsupported).
  const locale = await getServerLocale();
  // The middleware passes the path along; the login page has none of the app's chrome (its API calls would be refused).
  const onLogin = (await headers()).get("x-saarnavideo-path") === "/login";
  return (
    <html lang={locale}>
      <body>
        <I18nProvider initialLocale={locale}>
          {onLogin ? null : (
            <>
              <SidebarToggle />
              <YouTubeConnection />
              <TopNav canLogout={accessSecret() !== null} />
            </>
          )}
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
