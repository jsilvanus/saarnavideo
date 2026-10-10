"use client";

import { useOpenWorkspace } from "./useWorkspace";

/** Shows the error of one action, placed next to the control that started it. */
export function InlineError({ scope }: { scope: string }) {
  const { scopedErrors } = useOpenWorkspace();
  const message = scopedErrors[scope];
  if (!message) return null;
  // A span, not a <p>: it is placed inside <label> elements, which only allow phrasing content.
  return (
    <span className="error" role="alert" style={{ display: "block", marginTop: 6 }}>
      {message}
    </span>
  );
}
