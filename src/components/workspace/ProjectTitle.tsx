import { useEffect, useState } from "react";
import { errorMessage } from "@/components/api";
import { useT } from "@/i18n/I18nProvider";

export function ProjectTitle({ title, onSave }: { title: string; onSave: (title: string) => Promise<void> }) {
  const t = useT();
  const [value, setValue] = useState(title);
  const [error, setError] = useState("");
  useEffect(() => setValue(title), [title]);
  const save = async () => {
    const next = value.trim();
    if (!next || next === title) return setValue(title);
    try {
      setError("");
      await onSave(next);
    } catch (e) {
      setError(errorMessage(e, t("project.titleSaveFailed")));
    }
  };
  return (
    <label>
      {t("project.title")}
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => e.key === "Enter" && void save()}
      />
      {error && <small className="error">{error}</small>}
    </label>
  );
}
