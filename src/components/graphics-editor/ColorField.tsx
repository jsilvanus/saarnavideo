import type { FC } from "react";
import { useT } from "@/i18n/I18nProvider";
import { findPaletteColor, normalizeHex, PALETTES } from "@/domain/palettes";

/**
 * A colour value (any CSS colour) with the church palettes as swatches and a free colour picker.
 * The text field stays so that rgba(), names and empty values (= not set) keep working.
 */
export const ColorField: FC<{
  label: string; value: string; placeholder?: string; fallback?: string;
  onChange: (value: string) => void;
}> = ({ label, value, placeholder, fallback = "#000000", onChange }) => {
  const t = useT();
  const current = normalizeHex(value);
  return (
    <div className="ge-color">
      <label>{label}
        <span className="ge-color-row">
          <input type="color" value={current ?? normalizeHex(fallback) ?? "#000000"} onChange={e => onChange(e.target.value)} aria-label={t("ge.colorPicker")} />
          <input type="text" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
        </span>
      </label>
      {PALETTES.map(palette => (
        <div key={palette.key} className="ge-swatches" role="group" aria-label={palette.name}>
          <small>{palette.name}</small>
          <span>
            {palette.colors.map(c => (
              <button key={c.hex + c.name} type="button" className={`ge-swatch ${current === c.hex ? "ge-active" : ""}`} style={{ background: c.hex }}
                title={`${c.name} ${c.hex}`} aria-label={`${c.name} ${c.hex}`} onClick={() => onChange(c.hex)} />
            ))}
          </span>
        </div>
      ))}
      {current && findPaletteColor(current) && <small className="ge-color-name">{findPaletteColor(current)!.name}</small>}
    </div>
  );
};
