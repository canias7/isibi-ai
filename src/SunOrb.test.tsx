// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import SunOrb from './SunOrb';

describe('SunOrb', () => {
  it('renders a canvas and survives mount/unmount where WebGL & 2D are absent (jsdom)', () => {
    const { container, unmount } = render(<SunOrb size={64} className="home-orb" />);
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeTruthy();
    expect(canvas?.classList.contains('sun-orb')).toBe(true);
    expect(canvas?.classList.contains('home-orb')).toBe(true);
    expect(() => unmount()).not.toThrow();
  });
});
