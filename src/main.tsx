import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './ErrorBoundary';
import './index.css';
import { initOta } from './ota';

// Lock the WebView viewport. iOS auto-zooms when a sub-16px input is focused (our
// composer is 15px) and the page can get stuck zoomed/panned — everything clipped
// to one side with no way to pan back. Pinning the scale prevents that and any
// pinch-zoom drift. Done in JS too (not just index.html) so it ships via OTA.
(() => {
  const content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
  let m = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
  if (!m) { m = document.createElement('meta'); m.name = 'viewport'; document.head.appendChild(m); }
  m.setAttribute('content', content);
})();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

// Pull any over-the-air web update (native only; no-op in the browser).
void initOta();
