import { auditContrast, type ContrastAuditResult } from './contrast';

/**
 * Cutroom Canonical Design Tokens
 * 
 * Sourced from docs/DESIGN_CONTRACT.md and PRODUCT.md.
 * Dark charcoal/plum world with violet, ochre, maroon, sky blue, and light green accents.
 */

export const colors = {
  // Surface foundations (Dark Charcoal / Plum)
  bgApp: '#19161F',         // Deepest plum charcoal application backdrop
  bgPanel: '#221E29',       // Primary opaque panel background
  bgRaised: '#2B2533',      // Cards, popovers, elevated modals
  bgGlass: 'rgba(34, 30, 41, 0.78)', // Navigation and command glass
  bgGlassBorder: 'rgba(255, 255, 255, 0.08)',

  // Borders & Dividers
  borderSubtle: '#362F40',  // Dividers and nested panel borders
  borderDefault: '#443B4F', // Standard component borders
  borderStrong: '#635773',  // Emphasized boundaries
  borderFocus: '#A18AF7',   // Keyboard focus ring (2px violet)

  // Text & Typography
  textPrimary: '#F3F0F6',   // High-contrast off-white body text (>12:1)
  textSecondary: '#BAB3C5', // Muted labels, secondary metadata (>5.5:1)
  textTertiary: '#877E94',  // Disabled text, subtle timecodes (4.75:1 on app bg)
  textTertiaryPanel: '#9A91A7', // Measured tertiary for panel surfaces (>5:1 on panel bg)
  textInverse: '#191320',   // High-contrast text on solid violet/ochre fills

  // Interaction Accent: Violet
  accentViolet: '#A18AF7',
  accentVioletHover: '#B5A3F9',
  accentVioletSubtle: 'rgba(161, 138, 247, 0.14)',

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
  fast: '150ms cubic-bezier(0.16, 1, 0.3, 1)',
  normal: '220ms cubic-bezier(0.16, 1, 0.3, 1)',
  settle: '320ms cubic-bezier(0.16, 1, 0.3, 1)',
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
