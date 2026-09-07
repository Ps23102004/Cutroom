import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '../Button';
import { Badge } from '../Badge';

describe('UI Primitives', () => {
  it('renders a button with correct text and accessible attributes', () => {
    render(<Button variant="primary">Create Project</Button>);
    const btn = screen.getByRole('button', { name: 'Create Project' });
    expect(btn).toBeDefined();
    expect(btn.getAttribute('aria-disabled')).toBe('false');
  });

  it('handles loading state with spinner and aria-busy', () => {
    render(<Button isLoading>Saving</Button>);
    const btn = screen.getByRole('button', { name: 'Saving' });
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.getAttribute('disabled')).not.toBeNull();
  });

  it('renders badges with domain variants', () => {
    const { container } = render(<Badge variant="approved">Approved</Badge>);
    expect(container.textContent).toBe('Approved');
  });
});
