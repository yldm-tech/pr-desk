import { useMemo } from "react";
import { useTheme } from "./theme";

// The chart library paints SVG attributes, which cannot follow a custom property, so the colours are read from the theme once per theme change and handed over as values. A token that is not declared falls back to currentColor, which is still visible.
export function useThemeColors(names: readonly string[]): string[] {
  const { resolved } = useTheme();
  const key = names.join(",");
  return useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    return key.split(",").map((name) => style.getPropertyValue(name).trim() || "currentColor");
  }, [key, resolved]);
}
