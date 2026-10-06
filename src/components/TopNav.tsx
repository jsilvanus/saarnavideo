"use client";

import Link from "next/link";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useT } from "@/i18n/I18nProvider";

export default function TopNav({ canLogout = false }: { canLogout?: boolean }) {
  const t = useT();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }
  return (
    <nav style={{ position: "fixed", top: 12, right: 16, zIndex: 1000, display: "flex", gap: 8 }}>
      {([["/assets", "nav.assets"], ["/settings", "nav.settings"]] as const).map(([href, key]) => (
        <Link key={href} href={href} style={{ background: "white", border: "1px solid #ccc", borderRadius: 8, padding: "8px 12px", textDecoration: "none", color: "inherit", boxShadow: "0 1px 4px #0002" }}>{t(key)}</Link>
      ))}
      <LanguageSwitcher />
      {canLogout ? (
        <button type="button" onClick={logout} style={{ background: "white", border: "1px solid #ccc", borderRadius: 8, padding: "8px 12px", cursor: "pointer", boxShadow: "0 1px 4px #0002" }}>{t("nav.logout")}</button>
      ) : null}
    </nav>
  );
}
