import { describe, it, expect } from 'vitest';
import { friendlyAuthError } from './authErrors';

describe('friendlyAuthError (login error copy)', () => {
  it('explains offline instead of blaming the code', () => {
    expect(friendlyAuthError('Failed to fetch', false)).toMatch(/offline/i);
  });

  it('turns the GoTrue rate-limit message into a countdown hint', () => {
    expect(friendlyAuthError('For security purposes, you can only request this after 47 seconds.', true))
      .toBe('Too many attempts — wait 47 seconds, then try again.');
    expect(friendlyAuthError('Email rate limit exceeded', true)).toMatch(/too many attempts/i);
  });

  it('points an expired/invalid code at the Resend button', () => {
    expect(friendlyAuthError('Token has expired or is invalid', true)).toMatch(/resend code/i);
  });

  it('names connection trouble when online but unreachable', () => {
    expect(friendlyAuthError('Failed to fetch', true)).toMatch(/connection/i);
  });

  it('passes unknown errors through untouched', () => {
    expect(friendlyAuthError('Something exotic happened', true)).toBe('Something exotic happened');
  });
});
