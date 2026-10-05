"use client";

import OpenProject from "./OpenProject";
import { useWorkspace } from "./useWorkspace";
import { useT } from "@/i18n/I18nProvider";

export default function Workspace() {
  const { selected, setCreating } = useWorkspace();
  const t = useT();
  return (
    <section className="workspace">
      {!selected ? (
        <div className="empty">
          <h1>{t("workspace.createProject")}</h1>
          <button onClick={() => setCreating(true)}>{t("sidebar.new")}</button>
        </div>
      ) : (
        <OpenProject />
      )}
    </section>
  );
}
