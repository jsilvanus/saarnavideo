import type { Pair } from "./types";
import styles from "./connectors.module.css";

type Props = { label: string; rows: Pair[]; onChange: (rows: Pair[]) => void; keyPlaceholder?: string; valuePlaceholder?: string };

/** Name/value rows for headers and query parameters. */
export default function PairsEditor({ label, rows, onChange, keyPlaceholder = "nimi", valuePlaceholder = "arvo" }: Props) {
  const update = (index: number, patch: Partial<Pair>) => onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <div className={styles.rows}>
      <span className={styles.muted}>{label}</span>
      {rows.map((row, index) => (
        <div className={styles.row2} key={index}>
          <input aria-label={`${label}: nimi`} className={styles.mono} value={row.key} placeholder={keyPlaceholder} onChange={(e) => update(index, { key: e.target.value })} />
          <input aria-label={`${label}: arvo`} className={styles.mono} value={row.value} placeholder={valuePlaceholder} onChange={(e) => update(index, { value: e.target.value })} />
          <button type="button" className={styles.icon} aria-label={`Poista rivi ${index + 1}`} onClick={() => onChange(rows.filter((_, i) => i !== index))}>
            ×
          </button>
        </div>
      ))}
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={() => onChange([...rows, { key: "", value: "" }])}>
          ＋ Lisää rivi
        </button>
      </div>
    </div>
  );
}
