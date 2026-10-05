/** Parses "12:30", "1:02:03" or plain seconds ("90"); undefined for empty or invalid input. */
export function parseTargetLength(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const parts = trimmed.split(":");
  if (parts.length > 3 || parts.some(part => !/^\d+$/.test(part.trim()))) return undefined;
  const numbers = parts.map(part => Number(part));
  if (numbers.length > 1 && numbers.slice(1).some(n => n >= 60)) return undefined;
  const seconds = numbers.reduce((total, n) => total * 60 + n, 0);
  return seconds > 0 ? seconds : undefined;
}

/** Inverse of parseTargetLength as mm:ss (or h:mm:ss). */
export function formatTargetLength(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return "";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

/** Reads a width/height input; returns an error code when it is not an even whole number in range. */
export function checkDimension(text: string, min: number, max: number): { value?: number; error?: "whole" | "range" | "even" } {
  const value = Number(text);
  if (!text.trim() || !Number.isInteger(value)) return { error: "whole" };
  if (value < min || value > max) return { error: "range" };
  if (value % 2 !== 0) return { error: "even" };
  return { value };
}
