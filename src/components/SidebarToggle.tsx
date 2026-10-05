"use client";

import { useState } from "react";
import { useT } from "@/i18n/I18nProvider";

export default function SidebarToggle() {
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);
  return (
    <>
      <input
        id="sidebar-toggle"
        className="sidebar-toggle-input"
        type="checkbox"
        checked={collapsed}
        onChange={event => setCollapsed(event.target.checked)}
        aria-label={t("sidebar.collapse")}
      />
      <label className="sidebar-toggle" htmlFor="sidebar-toggle" title={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}>
        {collapsed ? "›" : "‹"}
      </label>
    </>
  );
}
