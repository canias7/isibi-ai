import { useState, useEffect } from 'react';
import type { NotificationItem } from '../types';
import { useTimeAgo } from '../hooks';

interface NotificationsPanelProps {
  open: boolean;
  onClose: () => void;
}

function NotifItem({ item, onRead }: { item: NotificationItem; onRead: (id: string) => void }) {
  const time = useTimeAgo(item.created_at);
  return (
    <div className={`notif-item ${item.is_read ? '' : 'unread'}`} onClick={() => onRead(item.id)}>
      <div className="notif-title">{item.title || 'Notification'}</div>
      <div className="notif-body">{item.body || ''}</div>
      <div className="notif-time">{time}</div>
    </div>
  );
}

export function NotificationsPanel({ open, onClose }: NotificationsPanelProps) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  useEffect(() => {
    if (open) {
      window.isibi.getNotifications().then((r) => {
        if (r?.data) setNotifications(r.data);
      });
    }
  }, [open]);

  const markRead = async (id: string) => {
    await window.isibi.markRead(id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
  };

  const markAllRead = async () => {
    await window.isibi.markAllRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };

  return (
    <div className={`notif-panel ${open ? 'open' : ''}`}>
      <div className="notif-header">
        <h3>Notifications</h3>
        <button className="btn-icon" onClick={onClose}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div style={{ padding: '6px 16px' }}>
        <button className="btn-secondary" style={{ width: '100%', padding: 7 }} onClick={markAllRead}>
          Mark all read
        </button>
      </div>
      <div className="notif-list">
        {notifications.length === 0 ? (
          <div className="empty-state" style={{ padding: 30 }}><p>No notifications</p></div>
        ) : (
          notifications.map((n) => <NotifItem key={n.id} item={n} onRead={markRead} />)
        )}
      </div>
    </div>
  );
}
