"use client";

import OpenProject from "./OpenProject";
import { useWorkspace } from "./useWorkspace";

export default function Workspace() {
  const { selected, setCreating } = useWorkspace();
  return (
    <section className="workspace">
      {!selected ? (
        <div className="empty">
          <h1>Luo projekti</h1>
          <button onClick={() => setCreating(true)}>＋ Uusi projekti</button>
        </div>
      ) : (
        <OpenProject />
      )}
    </section>
  );
}
