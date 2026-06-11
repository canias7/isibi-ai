// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import RecoveryBubble from './RecoveryBubble';
import type { ChatMessage } from './api';

afterEach(cleanup);

const msg = (extra: Partial<ChatMessage>): ChatMessage => ({ role: 'assistant', content: '', failed: true, ...extra });

describe('RecoveryBubble (the failed-turn states)', () => {
  it('reads as still thinking while a SENT turn is being recovered — no buttons', () => {
    render(<RecoveryBubble m={msg({ sent: true })} onRetry={() => {}} />);
    expect(screen.getByText('Finishing up…')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('reads as reconnecting while an UNSENT turn auto-resends — no buttons', () => {
    render(<RecoveryBubble m={msg({ sent: false })} onRetry={() => {}} />);
    expect(screen.getByText('Reconnecting…')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offline shows one quiet line and no button (reconnect auto-resends)', () => {
    render(<RecoveryBubble m={msg({ offline: true })} onRetry={() => {}} />);
    expect(screen.getByText(/You're offline/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a stalled turn is the ONLY state with a button, and it fires onRetry', () => {
    const onRetry = vi.fn();
    render(<RecoveryBubble m={msg({ stalled: true, sent: false })} onRetry={onRetry} />);
    expect(screen.getByText(/didn't go through/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('stalled wording differs for a turn the server did receive', () => {
    render(<RecoveryBubble m={msg({ stalled: true, sent: true })} onRetry={() => {}} />);
    expect(screen.getByText(/No reply came back/)).toBeTruthy();
  });
});
