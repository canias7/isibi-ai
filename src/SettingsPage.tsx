import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { Session } from '@supabase/supabase-js';
import { keyActivate, radioArrowNav } from './a11y';
import { tap } from './haptics';
import { IconLogout, IconTrash, IconCheck } from './icons';
import { APP_VERSION, BUILD } from './version';
import { THEMES, type SoundTheme } from './earcons';
import { REMINDER_SOUNDS, reminderSoundLabel } from './reminderSounds';
import type { BiometryStatus } from './biometric';

// Section headers for the reminder-sound picker, in catalog order.
const REM_SOUND_SECTIONS = [...new Set(REMINDER_SOUNDS.map((s) => s.section))];

// The Settings view — presentational; all state and handlers live in App.
export default function SettingsPage({
  session, isGuest, bioStatus, faceId, notif, sounds, soundTheme, reminderSound, noteMsg,
  onToggleFaceId, onToggleNotif, onToggleSounds, onPickSoundTheme, onPickReminderSound, onTestPush, onSignOut, onDeleteAccount, onOpenLegal,
}: {
  session: Session;
  isGuest: boolean;
  bioStatus: BiometryStatus | 'unknown';
  faceId: boolean;
  notif: boolean;
  sounds: boolean;
  soundTheme: SoundTheme;
  reminderSound: string;
  noteMsg: string;
  onToggleFaceId: () => void;
  onToggleNotif: () => void;
  onToggleSounds: () => void;
  onPickSoundTheme: (t: SoundTheme) => void;
  onPickReminderSound: (id: string) => void;
  onTestPush: () => void;
  onSignOut: () => void;
  onDeleteAccount: () => void;
  onOpenLegal: (doc: 'privacy' | 'terms') => void;
}) {
  const native = Capacitor.getPlatform() !== 'web';
  const [sndOpen, setSndOpen] = useState(false); // collapsed dropdown for the 18 reminder sounds
  return (
    <div className="page settings-page">
      <div className="page-inner">
        <div className="set-account">
          <span className="set-account-av">{(session.user.email ?? 'G').charAt(0).toUpperCase()}</span>
          <div className="set-account-text">
            <div className="set-account-name">{isGuest || !session.user.email ? 'Guest' : session.user.email.split('@')[0].replace(/^./, (ch) => ch.toUpperCase())}</div>
            <div className="set-account-sub">{isGuest || !session.user.email ? 'Guest session on this device' : session.user.email}</div>
          </div>
        </div>

        <div className="set-label">Preferences</div>
        <div className="set-card">
          {native && (bioStatus === 'ready' || bioStatus === 'unenrolled') && (
            <div className="set-row" onClick={onToggleFaceId} onKeyDown={keyActivate(onToggleFaceId)} role="button" tabIndex={0} aria-pressed={faceId}>
              <div className="set-row-text">
                <div className="set-row-title">Require Face ID</div>
                <div className="set-row-sub">{bioStatus === 'unenrolled' ? 'Set up Face ID in iOS Settings to use this.' : 'Lock the app when you open or return to it.'}</div>
              </div>
              <span className={`tgl ${faceId ? 'on' : ''}`}><span className="tgl-knob" /></span>
            </div>
          )}
          {native && (
            <div className="set-row" onClick={onToggleNotif} onKeyDown={keyActivate(onToggleNotif)} role="button" tabIndex={0} aria-pressed={notif}>
              <div className="set-row-text">
                <div className="set-row-title">Notifications</div>
                <div className="set-row-sub">Get push alerts from Go Farther.</div>
              </div>
              <span className={`tgl ${notif ? 'on' : ''}`}><span className="tgl-knob" /></span>
            </div>
          )}
          <div className="set-row" onClick={onToggleSounds} onKeyDown={keyActivate(onToggleSounds)} role="button" tabIndex={0} aria-pressed={sounds}>
            <div className="set-row-text">
              <div className="set-row-title">Sounds</div>
              <div className="set-row-sub">Soft tones when you send and a reply arrives.</div>
            </div>
            <span className={`tgl ${sounds ? 'on' : ''}`}><span className="tgl-knob" /></span>
          </div>
          {sounds && (
            <div className="set-row set-sound-row">
              <div className="set-row-text">
                <div className="set-row-title">Sound style</div>
                <div className="snd-chips" role="radiogroup" aria-label="Sound style" onKeyDown={radioArrowNav}>
                  {THEMES.map((t) => (
                    <button
                      key={t.id}
                      className={`snd-chip${soundTheme === t.id ? ' on' : ''}`}
                      role="radio"
                      aria-checked={soundTheme === t.id}
                      onClick={() => onPickSoundTheme(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="set-row-sub">Tap one to hear it.</div>
              </div>
            </div>
          )}
        </div>
        {native && (
          <>
            <div className="set-label">Reminder sound</div>
            <div className="set-card">
              {/* Collapsed by default — 18 sounds was a wall of scroll. Tap to drop
                  down the grouped list; tap a sound to hear + pick it. */}
              <button
                className="set-row set-row-tap rem-snd-head"
                aria-expanded={sndOpen}
                onClick={() => { void tap(); setSndOpen((v) => !v); }}
              >
                <div className="set-row-title">Sound</div>
                <span className="rem-snd-current">{reminderSoundLabel(reminderSound)}</span>
                <span className={`rem-snd-chev${sndOpen ? ' open' : ''}`} aria-hidden="true">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                </span>
              </button>
              {sndOpen && (
                <div className="rem-snd-list">
                  <div className="rem-snd-hint">What plays when a reminder goes off. Tap one to hear it.</div>
                  {REM_SOUND_SECTIONS.map((sec) => (
                    <div className="rem-snd-group" key={sec}>
                      <div className="rem-snd-sec">{sec}</div>
                      <div role="radiogroup" aria-label={`${sec} reminder sounds`} onKeyDown={radioArrowNav}>
                        {REMINDER_SOUNDS.filter((s) => s.section === sec).map((s) => (
                          <button
                            key={s.id}
                            className={`rem-snd-row${reminderSound === s.id ? ' on' : ''}`}
                            role="radio"
                            aria-checked={reminderSound === s.id}
                            onClick={() => onPickReminderSound(s.id)}
                          >
                            <span className="rem-snd-name">{s.label}</span>
                            {reminderSound === s.id && <IconCheck size={16} />}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        {native && notif && (
          <button className="set-test-btn" onClick={onTestPush}>Send a test notification</button>
        )}

        {noteMsg && <p className="set-note" role="status" aria-live="polite">{noteMsg}</p>}

        {!isGuest && (
          <>
            <div className="set-label">Account</div>
            <div className="set-card">
              <button className="set-row set-row-tap" onClick={onSignOut}>
                <div className="set-row-title">Sign out</div>
                <span className="set-row-ico"><IconLogout size={18} /></span>
              </button>
              <button className="set-row set-row-tap danger" onClick={() => { void tap(); onDeleteAccount(); }}>
                <div className="set-row-title">Delete account</div>
                <span className="set-row-ico"><IconTrash size={18} /></span>
              </button>
            </div>
            <p className="set-foot-note">Deleting your account permanently removes your chats, memories, connected-app links, and bank connections. This can’t be undone.</p>
          </>
        )}

        <div className="set-label">About</div>
        <div className="set-card">
          <button className="set-row set-row-tap" onClick={() => { void tap(); onOpenLegal('privacy'); }}>
            <div className="set-row-title">Privacy Policy</div>
            <span className="set-row-chev" aria-hidden>›</span>
          </button>
          <button className="set-row set-row-tap" onClick={() => { void tap(); onOpenLegal('terms'); }}>
            <div className="set-row-title">Terms of Service</div>
            <span className="set-row-chev" aria-hidden>›</span>
          </button>
        </div>

        <div className="set-version">Go Farther · v{APP_VERSION}{BUILD !== '0' ? ` (${BUILD})` : ''}</div>
      </div>
    </div>
  );
}
