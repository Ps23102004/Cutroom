import { describe, it, expect } from 'vitest';
import { colors, dimensions, getVerifiedContrastTable } from '../tokens';
import { getContrastRatio, auditContrast } from '../contrast';

describe('Design Tokens & Contrast Verification', () => {
  it('enforces exact sidebar width of 216px', () => {
    expect(dimensions.sidebarWidth).toBe('216px');
  });

  it('enforces top bar height of 56px', () => {
    expect(dimensions.topBarHeight).toBe('56px');
    expect(dimensions.headerHeight).toBe('56px');
  });

  it('verifies textPrimary meets WCAG AAA on all application backgrounds', () => {
    const onApp = auditContrast(colors.textPrimary, colors.bgApp);
    const onPanel = auditContrast(colors.textPrimary, colors.bgPanel);
    const onRaised = auditContrast(colors.textPrimary, colors.bgRaised);

    expect(onApp.ratio).toBeGreaterThanOrEqual(7.0);
    expect(onPanel.ratio).toBeGreaterThanOrEqual(7.0);
    expect(onRaised.ratio).toBeGreaterThanOrEqual(7.0);
  });

  it('verifies textSecondary meets WCAG AA (> 4.5:1) on all application backgrounds', () => {
    const onApp = auditContrast(colors.textSecondary, colors.bgApp);
    const onPanel = auditContrast(colors.textSecondary, colors.bgPanel);
    const onRaised = auditContrast(colors.textSecondary, colors.bgRaised);

    expect(onApp.ratio).toBeGreaterThanOrEqual(4.5);
    expect(onPanel.ratio).toBeGreaterThanOrEqual(4.5);
    expect(onRaised.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('verifies tertiary text contrast is measured and validated', () => {
    // textTertiary on app background meets AA normal (>= 4.5:1)
    const onApp = auditContrast(colors.textTertiary, colors.bgApp);
    expect(onApp.ratio).toBeGreaterThanOrEqual(4.5);

    // textTertiaryPanel on panel background meets AA normal (>= 4.5:1)
    const onPanel = auditContrast(colors.textTertiaryPanel, colors.bgPanel);
    expect(onPanel.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('verifies accent contrast ratios are positive and legible', () => {
    const violetOnDark = getContrastRatio(colors.accentViolet, colors.bgApp);
    expect(violetOnDark).toBeGreaterThanOrEqual(4.5);

    const inverseOnViolet = getContrastRatio(colors.textInverse, colors.accentViolet);
    expect(inverseOnViolet).toBeGreaterThanOrEqual(4.5); // Meets WCAG AA Normal text (6.49:1)
  });

  it('returns all items in the verified contrast table without failures', () => {
    const table = getVerifiedContrastTable();
    expect(table.length).toBeGreaterThan(5);
    for (const item of table) {
      expect(item.meetsAALarge).toBe(true);
    }
  });
});
