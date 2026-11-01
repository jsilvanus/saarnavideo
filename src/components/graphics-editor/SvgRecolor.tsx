import { useEffect, useState, type FC } from "react";
import { useT } from "@/i18n/I18nProvider";
import { layerRecolor, svgColors, SVG_RECOLOR_STYLE_KEY } from "@/domain/svg";
import { ColorField } from "./ColorField";
import type { Layer } from "./types";

/** The `src` of an image layer with its colour map as a preview query (the asset route recolours SVGs on the fly). */
export function previewSrc(layer: Pick<Layer, "src" | "style">): string {
  const map = layerRecolor(layer.style as Record<string, unknown> | undefined);
  const src = layer.src || "";
  return src && Object.keys(map).length && !src.includes("?") ? `${src}?recolor=${encodeURIComponent(JSON.stringify(map))}` : src;
}

/**
 * Colour map of an SVG image layer: every colour the file paints with, each replaceable by another colour (church
 * palettes included). Stored on the layer as `style["svg-recolor"]`; the worker rasterises the recoloured SVG at render time.
 */
export const SvgRecolor: FC<{ layer: Layer; onStyle: (id: string, key: string, value: string) => void }> = ({ layer, onStyle }) => {
  const t = useT();
  const [colors, setColors] = useState<string[] | null>(null);
  const src = layer.src || "";
  useEffect(() => {
    let alive = true;
    setColors(null);
    if (!src) return;
    fetch(src).then(r => (r.ok ? r.text() : "")).then(text => { if (alive) setColors(svgColors(text)); }).catch(() => { if (alive) setColors([]); });
    return () => { alive = false; };
  }, [src]);
  const map = layerRecolor(layer.style as Record<string, unknown> | undefined);
  const write = (next: Record<string, string>) => onStyle(layer.id, SVG_RECOLOR_STYLE_KEY, Object.keys(next).length ? JSON.stringify(next) : "");
  if (colors === null) return <small>{t("ge.svg.loading")}</small>;
  if (!colors.length) return <small>{t("ge.svg.noColors")}</small>;
  return <div className="ge-svg-recolor"><b>{t("ge.svg.title")}</b><small>{t("ge.svg.help")}</small>
    {colors.map(color => <div key={color} className="ge-svg-color">
      <ColorField label={color} value={map[color] ?? color} fallback={color} onChange={value => {
        const next = { ...map };
        if (!value || value.toLowerCase() === color) delete next[color]; else next[color] = value;
        write(next);
      }} />
    </div>)}
    {Object.keys(map).length > 0 && <button type="button" onClick={() => write({})}>{t("ge.svg.reset")}</button>}
  </div>;
};
