import type { ReactNode } from "react";

export function Panel({ title, text, children }: { title: string; text?: string; children: ReactNode }) {
  return (
    <section className="panel">
      <h2>{title}</h2>
      {text && <p className="muted">{text}</p>}
      {children}
    </section>
  );
}
