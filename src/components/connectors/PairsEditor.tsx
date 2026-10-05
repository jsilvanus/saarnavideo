import { useT } from "@/i18n/I18nProvider";
import type { Pair } from "./types";
import styles from "./connectors.module.css";

type Props = { label: string; rows: Pair[]; onChange: (rows: Pair[]) => void; keyPlaceholder?: string; valuePlaceholder?: string };

/** Name/value rows for headers and query parameters. */
export default function PairsEditor({ label, rows, onChange, keyPlaceholder, valuePlaceholder }: Props) {
  const t = useT();
  const update = (index: number, patch: Partial<Pair>) => onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <div className={styles.rows}>
      <span className={styles.muted}>{label}</span>
      {rows.map((row, index) => (
        <div className={styles.row2} key={index}>
          <input aria-label={t("conn.pairName", { label })} className={styles.mono} value={row.key} placeholder={keyPlaceholder ?? t("conn.keyDefault")} onChange={(e) => update(index, { key: e.target.value })} />
          <input aria-label={t("conn.pairValue", { label })} className={styles.mono} value={row.value} placeholder={valuePlaceholder ?? t("conn.valueDefault")} onChange={(e) => update(index, { value: e.target.value })} />
          <button type="button" className={styles.icon} aria-label={t("conn.removeRow", { n: index + 1 })} onClick={() => onChange(rows.filter((_, i) => i !== index))}>
            ×
          </button>
        </div>
      ))}
      <div className={styles.actions}>
        <button type="button" className={styles.button} onClick={() => onChange([...rows, { key: "", value: "" }])}>
          {t("conn.addRow")}
        </button>
      </div>
    </div>
  );
}
