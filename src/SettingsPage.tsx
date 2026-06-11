import { Capacitor } from '@capacitor/core';
import type { Session } from '@supabase/supabase-js';
import { keyActivate } from './a11y';
import { tap } from './haptics';
import { IconLogout, IconTrash } from './icons';
import { APP_VERSION, BUILD } from './version';
import type { BiometryStatus } from './biometric';

// The Settings view — presentational; all state and handlers live in App.
export default function SettingsPage({
  session, isGuest, bioStatus, faceId, notif, sounds, noteMsg,
  onToggleFaceId, onToggleNotif, onToggleSounds, onTestPush, onSignOut, onDeleteAccount, onOpenLegal,
}: {
  session: Session;
  isGuest: boolean;
  bioStatus: BiometryStatus | 'unknown';
  faceId: boolean;
  notif: boolean;
  sounds: boolean;
  noteMsg: string;
  onToggleFaceId: () => void;
  onToggleNotif: () => void;
  onToggleSounds: () => void;
  onTestPush: () => void;
  onSignOut: () => void;
  onDeleteAccount: () => void;
  onOpenLegal: (doc: 'privacy' | 'terms') => void;
}) {
  const native = Capacitor.getPlatform() !== 'web';
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
        </div>
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
