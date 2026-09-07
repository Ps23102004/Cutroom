/**
 * Cutroom WCAG 2.1 Contrast Calculation Engine
 * 
 * Strict mathematical verification of contrast ratios.
 * Prevents unmeasured assertions.
 */

export function parseHexColor(hex: string): [number, number, number] {
  const cleanHex = hex.replace('#', '').trim();
  if (cleanHex.length === 3) {
    const r = parseInt(cleanHex[0] + cleanHex[0], 16);
    const g = parseInt(cleanHex[1] + cleanHex[1], 16);
    const b = parseInt(cleanHex[2] + cleanHex[2], 16);
    return [r, g, b];
  }
  if (cleanHex.length === 6) {
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    return [r, g, b];
  }
  throw new Error(`Invalid hex color: ${hex}`);
}

/**
 * Calculates sRGB relative luminance according to WCAG 2.1 specification:
 * https://www.w3.org/WAI/GL/wiki/Relative_luminance
 */
export function getRelativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((val) => {
    const srgb = val / 255;
    return srgb <= 0.04045
      ? srgb / 12.92
      : Math.pow((srgb + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Calculates contrast ratio between two colors according to WCAG 2.1:
 * (L1 + 0.05) / (L2 + 0.05), where L1 is the lighter color.
 */
export function getContrastRatio(hex1: string, hex2: string): number {
  const lum1 = getRelativeLuminance(parseHexColor(hex1));
  const lum2 = getRelativeLuminance(parseHexColor(hex2));
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  const ratio = (lighter + 0.05) / (darker + 0.05);
  return Math.round(ratio * 100) / 100;
}

export interface ContrastAuditResult {
  foreground: string;
  background: string;
  ratio: number;
  meetsAANormal: boolean; // >= 4.5:1
  meetsAALarge: boolean;  // >= 3.0:1
  meetsAAANormal: boolean;// >= 7.0:1
  meetsAAALarge: boolean; // >= 4.5:1
}

export function auditContrast(foreground: string, background: string): ContrastAuditResult {
  const ratio = getContrastRatio(foreground, background);
  return {
    foreground,
    background,
    ratio,
    meetsAANormal: ratio >= 4.5,
    meetsAALarge: ratio >= 3.0,
    meetsAAANormal: ratio >= 7.0,
    meetsAAALarge: ratio >= 4.5,
  };
}
