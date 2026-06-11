// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { BrandConstellation } from './brand';

afterEach(cleanup);

describe('BrandConstellation (the empty-state mark)', () => {
  it('renders the amber core with its satellites, hidden from screen readers', () => {
    const { container } = render(<BrandConstellation />);
    const svg = container.querySelector('svg.gf-empty-art');
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute('aria-hidden')).toBe('true');
    // core gradient + 4 satellites + 3 far stars + glow + core = 9 circles
    expect(container.querySelectorAll('circle').length).toBe(9);
    expect(container.querySelector('radialGradient')).toBeTruthy();
  });
});
