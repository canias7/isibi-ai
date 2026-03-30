import { useEffect } from 'react';

export function Particles() {
  useEffect(() => {
    const container = document.getElementById('app');
    if (!container) return;
    const particles: HTMLDivElement[] = [];
    for (let i = 0; i < 12; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      p.style.left = Math.random() * 100 + '%';
      p.style.animationDelay = Math.random() * 8 + 's';
      p.style.animationDuration = (6 + Math.random() * 6) + 's';
      const sz = 1 + Math.random() * 2;
      p.style.width = sz + 'px';
      p.style.height = sz + 'px';
      container.appendChild(p);
      particles.push(p);
    }
    return () => particles.forEach((p) => p.remove());
  }, []);

  return null;
}
