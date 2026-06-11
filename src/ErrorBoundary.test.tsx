// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';

vi.mock('./analytics', () => ({ track: vi.fn() }));
import { track } from './analytics';

afterEach(cleanup);

function Bomb(): never {
  throw new Error('kaboom');
}

describe('ErrorBoundary (no white screens)', () => {
  it('renders children when nothing throws', () => {
    render(<ErrorBoundary><p>fine</p></ErrorBoundary>);
    expect(screen.getByText('fine')).toBeTruthy();
  });

  it('a render crash shows the recovery screen and reports to analytics', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    expect(screen.getByText('Something went wrong.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
    expect(track).toHaveBeenCalledWith('crash', expect.objectContaining({ msg: expect.stringContaining('kaboom') }));
    spy.mockRestore();
  });

  it('a compact fallback isolates the crash and its reset re-renders children', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let blow = true;
    function MaybeBomb() {
      if (blow) throw new Error('overlay crash');
      return <p>recovered</p>;
    }
    render(
      <ErrorBoundary fallback={(reset) => <button onClick={() => { blow = false; reset(); }}>Close</button>}>
        <MaybeBomb />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByText('recovered')).toBeTruthy();
    spy.mockRestore();
  });
});
