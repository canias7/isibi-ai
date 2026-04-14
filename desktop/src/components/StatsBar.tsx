import type { AppProject } from '../types';

interface StatsBarProps {
  apps: AppProject[];
}

export function StatsBar({ apps }: StatsBarProps) {
  const total = apps.length;
  const online = apps.filter((a) => a.status === 'deployed').length;
  const errors = apps.filter((a) => a.status === 'error').length;

  return (
    <div className="stats-bar">
      <div className="stat-card blue">
        <div className="stat-value">{total}</div>
        <div className="stat-label">Total Apps</div>
      </div>
      <div className="stat-card green">
        <div className="stat-value">{online}</div>
        <div className="stat-label">Online</div>
      </div>
      <div className="stat-card red">
        <div className="stat-value">{errors}</div>
        <div className="stat-label">Errors</div>
      </div>
    </div>
  );
}
