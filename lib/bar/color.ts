// Shared color helper (also used privately inside the engine). Lightens or
// darkens a hex color by `a` per channel.
export function shade(hex: string, a: number): string {
  let c = hex.replace("#", "");
  if (c.length === 3)
    c = c
      .split("")
      .map((x) => x + x)
      .join("");
  const cl = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
  const r = cl(parseInt(c.slice(0, 2), 16) + a);
  const g = cl(parseInt(c.slice(2, 4), 16) + a);
  const b = cl(parseInt(c.slice(4, 6), 16) + a);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
