import { useRef, useState } from 'react';
import type { AppProject, UptimeData, NodePosition } from '../types';
import { useTimeAgo, useStatusInfo, useAppColor } from '../hooks';

interface AppNodeProps {
  app: AppProject;
  uptime?: UptimeData;
  position: NodePosition;
  isLoading?: string;
  onDragEnd: (id: string, pos: NodePosition) => void;
  onClick: (id: string) => void;
  onHealthCheck: (id: string) => void;
  onRestart: (id: string) => void;
}

export function AppNode({ app, uptime, position, isLoading, onDragEnd, onClick, onHealthCheck, onRestart }: AppNodeProps) {
  const { cls, label } = useStatusInfo(app.status);
  const color = useAppColor(app.name);
  const initial = (app.name || 'A')[0].toUpperCase();
  const lastCheck = useTimeAgo(uptime?.last_check);
  const uptimePct = uptime?.uptime_pct != null ? uptime.uptime_pct.toFixed(1) + '%' : '--';
  const responseMs = uptime?.response_time_ms != null ? uptime.response_time_ms + 'ms' : '--';

  const nodeRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const startRef = useRef({ x: 0, y: 0, moved: false });

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = nodeRef.current?.getBoundingClientRect();
    if (!rect) return;
    startRef.current = { x: e.clientX, y: e.clientY, moved: false };

    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startRef.current.x;
      const dy = ev.clientY - startRef.current.y;
      if (!startRef.current.moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      startRef.current.moved = true;
      setDragging(true);

      const canvas = document.getElementById('workflow-canvas');
      if (!canvas || !nodeRef.current) return;
      const canvasRect = canvas.getBoundingClientRect();
      const x = Math.max(0, ev.clientX - canvasRect.left - offsetX);
      const y = Math.max(0, ev.clientY - canvasRect.top - offsetY);
      nodeRef.current.style.left = x + 'px';
      nodeRef.current.style.top = y + 'px';

      // Dispatch custom event for connection redraw
      window.dispatchEvent(new CustomEvent('node-moved', { detail: { id: app.id, x, y } }));
    };

    const onUp = (ev: MouseEvent) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setDragging(false);

      if (!startRef.current.moved) {
        onClick(app.id);
      } else {
        const canvas = document.getElementById('workflow-canvas');
        if (canvas && nodeRef.current) {
          const canvasRect = canvas.getBoundingClientRect();
          const rect2 = nodeRef.current.getBoundingClientRect();
          onDragEnd(app.id, {
            x: rect2.left - canvasRect.left,
            y: rect2.top - canvasRect.top,
          });
        }
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div
      ref={nodeRef}
      className={`app-node ${cls} ${dragging ? 'dragging' : ''}`}
      data-id={app.id}
      style={{ position: 'absolute', left: position.x, top: position.y }}
    >
      <div className="node-square" style={{ background: color }} onMouseDown={onMouseDown}>
        <div className="status-ring" />
        {initial}
        <div className="node-dot" />
      </div>
      <div className="node-label">{app.name || 'Untitled'}</div>
      <div className="node-status-text">{label}</div>

      {!dragging && (
        <div className="node-tooltip">
          <div className="tt-name">{app.name || 'Untitled'}</div>
          <div className="tt-metrics">
            <div>
              <div className="tt-metric-value">{uptimePct}</div>
              <div className="tt-metric-label">Uptime</div>
            </div>
            <div>
              <div className="tt-metric-value">{responseMs}</div>
              <div className="tt-metric-label">Response</div>
            </div>
            <div>
              <div className="tt-metric-value">{lastCheck}</div>
              <div className="tt-metric-label">Checked</div>
            </div>
          </div>
          <div className="tt-actions">
            <button className="tt-btn tt-btn-primary" onMouseDown={(e) => e.stopPropagation()} onClick={() => onClick(app.id)}>Open</button>
            <button className="tt-btn tt-btn-secondary" onMouseDown={(e) => e.stopPropagation()} onClick={() => onHealthCheck(app.id)} disabled={!!isLoading}>
              {isLoading === 'health' ? <span className="spinner" style={{ width: 10, height: 10 }} /> : 'Check'}
            </button>
            <button className="tt-btn tt-btn-warn" onMouseDown={(e) => e.stopPropagation()} onClick={() => onRestart(app.id)} disabled={!!isLoading}>
              {isLoading === 'restart' ? <span className="spinner" style={{ width: 10, height: 10 }} /> : 'Restart'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
