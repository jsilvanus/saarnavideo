import { useEffect, useState } from "react";
import { errorMessage } from "@/components/api";

export function ProjectTitle({ title, onSave }: { title: string; onSave: (title: string) => Promise<void> }) {
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
      setError(errorMessage(e, "Otsikkoa ei voitu tallentaa"));
    }
  };
  return (
    <label>
      Otsikko
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
