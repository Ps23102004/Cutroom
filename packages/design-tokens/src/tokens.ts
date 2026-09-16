import { auditContrast, type ContrastAuditResult } from './contrast';

/**
 * Cutroom Canonical Design Tokens
 *
 * Sourced from docs/DESIGN_CONTRACT.md and PRODUCT.md.
 * Violet Noir: near-black surfaces with light violet, ochre, maroon,
 * sky blue, and light green accents.
 */

export const colors = {
  // Surface foundations (Violet Noir: near-black with a violet undertone)
  bgApp: '#08080C',         // Deepest near-black application backdrop
  bgPanel: '#0F0F16',       // Primary opaque panel background
  bgRaised: '#17171F',      // Cards, popovers, elevated modals
  bgGlass: 'rgba(15, 15, 22, 0.78)', // Navigation and command glass
  bgGlassBorder: 'rgba(255, 255, 255, 0.09)',

  // Borders & Dividers (stepped for visible surface separation)
  borderSubtle: '#1E1E2A',  // Dividers and nested panel borders
  borderDefault: '#2A2A3A', // Standard component borders
  borderStrong: '#3D3D55',  // Emphasized boundaries
  borderFocus: '#C4B5FD',   // Keyboard focus ring (2px light violet)

  // Text & Typography
  textPrimary: '#FAF8FF',   // High-contrast white body text (>16:1)
  textSecondary: '#C2BCCC', // Muted labels, secondary metadata (>9:1)
  textTertiary: '#8E87A0',  // Disabled text, subtle timecodes (5.8:1 on app bg)
  textTertiaryPanel: '#9D95B0', // Measured tertiary for panel surfaces (>6:1 on panel bg)
  textInverse: '#0B0A10',   // High-contrast text on solid violet/ochre fills

  // Interaction Accent: Light Violet
  accentViolet: '#C4B5FD',
  accentVioletHover: '#D6CBFF',
  accentVioletSubtle: 'rgba(196, 181, 253, 0.14)',

  // Editorial Accent: Warm Ochre
  ochre: '#D6AE69',
  ochreHover: '#E5C07B',
  ochreSubtle: 'rgba(214, 174, 105, 0.14)',

  // Editorial Accent: Maroon / Wine (Surfaces & badges ONLY; NEVER dark body text on dark bg)
  maroon: '#713D50',
  maroonHover: '#8A4A62',
  maroonSubtle: 'rgba(113, 61, 80, 0.22)',

  // Informational Accent: Sky Blue
  sky: '#8CC8E8',
  skySubtle: 'rgba(140, 200, 232, 0.14)',

  // Positive & Verification: Light Green (Displayed ONLY when backed by actual verified state)
  positive: '#A7D7A1',
  positiveSubtle: 'rgba(167, 215, 161, 0.14)',

  // Destructive & Error
  destructive: '#E06C75',
  destructiveSubtle: 'rgba(224, 108, 117, 0.16)',
} as const;

export const dimensions = {
  sidebarWidth: '216px',
  topBarHeight: '56px',
  contentGutter: '24px',
  controlHeight: '38px',
  minHitTarget: '36px',
  headerHeight: '56px',
} as const;

export const spacing = {
  tight: '4px',
  compact: '8px',
  default: '16px',
  medium: '24px',
  large: '32px',
  xlarge: '48px',
} as const;

export const radii = {
  sm: '4px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  full: '9999px',
} as const;

export const typography = {
  fontFamilySans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  fontFamilyMono: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Monaco, Consolas, monospace',
  fontSizeXs: '11px',
  fontSizeSm: '12px',
  fontSizeBase: '14px',
  fontSizeMd: '16px',
  fontSizeLg: '18px',
  fontSizeXl: '20px',
  fontSize2xl: '24px',
  lineHeightTight: '1.2',
  lineHeightBase: '1.43',
  lineHeightRelaxed: '1.6',
} as const;

export const transitions = {
  instant: '100ms cubic-bezier(0.16, 1, 0.3, 1)',
  fast: '150ms cubic-bezier(0.16, 1, 0.3, 1)',
  normal: '220ms cubic-bezier(0.16, 1, 0.3, 1)',
  settle: '320ms cubic-bezier(0.16, 1, 0.3, 1)',
  spring: '320ms cubic-bezier(0.34, 1.4, 0.64, 1)',
} as const;

export const motion = {
  instant: 'var(--motion-instant, 100ms)',
  fast: 'var(--motion-fast, 150ms)',
  base: 'var(--motion-base, 220ms)',
  slow: 'var(--motion-slow, 320ms)',
  easeStandard: 'var(--ease-standard, cubic-bezier(0.16, 1, 0.3, 1))',
  easeSpring: 'var(--ease-spring, cubic-bezier(0.34, 1.4, 0.64, 1))',
} as const;

/**
 * Measured WCAG Contrast Audit Table
 * Evaluated mathematically via getContrastRatio() to eliminate unmeasured assertions.
 */
export function getVerifiedContrastTable(): ContrastAuditResult[] {
  return [
    auditContrast(colors.textPrimary, colors.bgApp),
    auditContrast(colors.textPrimary, colors.bgPanel),
    auditContrast(colors.textPrimary, colors.bgRaised),
    auditContrast(colors.textSecondary, colors.bgApp),
    auditContrast(colors.textSecondary, colors.bgPanel),
    auditContrast(colors.textSecondary, colors.bgRaised),
    auditContrast(colors.textTertiary, colors.bgApp),
    auditContrast(colors.textTertiaryPanel, colors.bgPanel),
    auditContrast(colors.textInverse, colors.accentViolet),
    auditContrast(colors.textInverse, colors.ochre),
    auditContrast(colors.sky, colors.bgApp),
    auditContrast(colors.positive, colors.bgApp),
    auditContrast(colors.destructive, colors.bgApp),
  ];
}
