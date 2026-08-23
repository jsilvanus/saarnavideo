"use client";

import { useState } from "react";

export default function SidebarToggle() {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <>
      <input
        id="sidebar-toggle"
        className="sidebar-toggle-input"
        type="checkbox"
        checked={collapsed}
        onChange={event => setCollapsed(event.target.checked)}
        aria-label="Collapse sidebar"
      />
      <label className="sidebar-toggle" htmlFor="sidebar-toggle" title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
        {collapsed ? "›" : "‹"}
      </label>
    </>
  );
}
