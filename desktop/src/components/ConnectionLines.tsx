import { useEffect, useRef } from 'react';
import type { NodePosition } from '../types';

interface ConnectionLinesProps {
  positions: Record<string, NodePosition>;
  appIds: string[];
}

export function ConnectionLines({ positions, appIds }: ConnectionLinesProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    drawConnections();
    const handler = () => drawConnections();
    window.addEventListener('node-moved', handler as EventListener);
    return () => window.removeEventListener('node-moved', handler as EventListener);
  }, [positions, appIds]);

  function drawConnections() {
    const svg = svgRef.current;
    if (!svg || appIds.length < 2) return;

    // Clear old
    svg.querySelectorAll('.connection-line,.connection-line-glow,.connection-dot,.connection-arrow,.junction-dot,.junction-ring')
      .forEach((el) => el.remove());

    const centers = appIds.map((id) => {
      const pos = positions[id];
      if (!pos) return null;
      return { x: pos.x + 36, y: pos.y + 36 };
    }).filter(Boolean) as { x: number; y: number }[];

    if (centers.length < 2) return;

    // Sequential connections
    for (let i = 0; i < centers.length - 1; i++) {
      drawLine(svg, centers[i], centers[i + 1], 0.5);
    }
    // Cross connections
    for (let i = 0; i < centers.length - 2; i++) {
      drawLine(svg, centers[i], centers[i + 2], 0.15);
    }
    // Loop
    if (centers.length > 3) {
      drawLine(svg, centers[0], centers[centers.length - 1], 0.12);
    }
    // Junction dots
    centers.forEach((c) => {
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', String(c.x));
      dot.setAttribute('cy', String(c.y));
      dot.setAttribute('r', '5');
      dot.setAttribute('class', 'junction-dot');
      svg.appendChild(dot);

      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      ring.setAttribute('cx', String(c.x));
      ring.setAttribute('cy', String(c.y));
      ring.setAttribute('r', '8');
      ring.setAttribute('class', 'junction-ring');
      ring.style.animationDelay = Math.random() * 2 + 's';
      svg.appendChild(ring);
    });
  }

  function drawLine(svg: SVGSVGElement, from: { x: number; y: number }, to: { x: number; y: number }, opacity: number) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 10) return;
    const bend = Math.min(dist * 0.25, 40);
    const mx = (from.x + to.x) / 2 - (dy / dist) * bend;
    const my = (from.y + to.y) / 2 + (dx / dist) * bend;
    const d = `M ${from.x} ${from.y} Q ${mx} ${my} ${to.x} ${to.y}`;

    // Glow
    const glow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    glow.setAttribute('d', d);
    glow.setAttribute('class', 'connection-line-glow');
    glow.style.opacity = String(opacity * 0.4);
    svg.appendChild(glow);

    // Line
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'connection-line');
    path.style.opacity = String(opacity);
    svg.appendChild(path);

    // Arrow
    const angle = Math.atan2(to.y - my, to.x - mx);
    const sz = 8;
    const ax = to.x - Math.cos(angle) * 5;
    const ay = to.y - Math.sin(angle) * 5;
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    arrow.setAttribute('points', `${ax},${ay} ${ax - sz * Math.cos(angle - 0.4)},${ay - sz * Math.sin(angle - 0.4)} ${ax - sz * Math.cos(angle + 0.4)},${ay - sz * Math.sin(angle + 0.4)}`);
    arrow.setAttribute('class', 'connection-arrow');
    arrow.style.opacity = String(opacity);
    svg.appendChild(arrow);

    // Traveling dot
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r', '3.5');
    dot.setAttribute('class', 'connection-dot');
    dot.style.opacity = String(Math.min(opacity * 2.5, 0.8));
    const am = document.createElementNS('http://www.w3.org/2000/svg', 'animateMotion');
    am.setAttribute('dur', (3 + Math.random() * 3) + 's');
    am.setAttribute('repeatCount', 'indefinite');
    am.setAttribute('path', d);
    dot.appendChild(am);
    svg.appendChild(dot);
  }

  return (
    <svg ref={svgRef} className="connections-svg" id="connections-svg">
      <defs>
        <linearGradient id="neon-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style={{ stopColor: '#ec4899', stopOpacity: 0.5 }} />
          <stop offset="50%" style={{ stopColor: '#8b5cf6', stopOpacity: 0.3 }} />
          <stop offset="100%" style={{ stopColor: '#06b6d4', stopOpacity: 0.5 }} />
        </linearGradient>
      </defs>
    </svg>
  );
}
