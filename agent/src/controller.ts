/**
 * Screen Controller — moves mouse, clicks, types, presses keys.
 *
 * Uses @nut-tree-fork/nut-js for cross-platform mouse/keyboard control.
 * All movements are smooth and animated for the ghost orb effect.
 */

import { mouse, keyboard, Point, Button, Key, straightTo, centerOf, screen } from '@nut-tree-fork/nut-js';

// Configure smooth mouse movement
mouse.config.autoDelayMs = 0;
mouse.config.mouseSpeed = 600; // pixels per second

export interface ScreenSize {
  width: number;
  height: number;
}

// ── Mouse Control ───────────────────────────────────────────────────────

export async function moveMouse(x: number, y: number): Promise<void> {
  await mouse.move(straightTo(new Point(x, y)));
}

export async function click(x: number, y: number): Promise<void> {
  await mouse.move(straightTo(new Point(x, y)));
  await sleep(100);
  await mouse.click(Button.LEFT);
}

export async function doubleClick(x: number, y: number): Promise<void> {
  await mouse.move(straightTo(new Point(x, y)));
  await sleep(100);
  await mouse.doubleClick(Button.LEFT);
}

export async function rightClick(x: number, y: number): Promise<void> {
  await mouse.move(straightTo(new Point(x, y)));
  await sleep(100);
  await mouse.click(Button.RIGHT);
}

export async function getMousePosition(): Promise<{ x: number; y: number }> {
  const pos = await mouse.getPosition();
  return { x: pos.x, y: pos.y };
}

// ── Keyboard Control ────────────────────────────────────────────────────

export async function typeText(text: string, delayMs = 50): Promise<void> {
  for (const char of text) {
    await keyboard.type(char);
    await sleep(delayMs + Math.random() * 20); // Natural typing speed
  }
}

export async function pressKey(...keys: Key[]): Promise<void> {
  await keyboard.pressKey(...keys);
  await sleep(50);
  await keyboard.releaseKey(...keys);
}

export async function pressEnter(): Promise<void> {
  await pressKey(Key.Enter);
}

export async function pressTab(): Promise<void> {
  await pressKey(Key.Tab);
}

export async function pressEscape(): Promise<void> {
  await pressKey(Key.Escape);
}

export async function selectAll(): Promise<void> {
  if (process.platform === 'darwin') {
    await pressKey(Key.LeftCmd, Key.A);
  } else {
    await pressKey(Key.LeftControl, Key.A);
  }
}

export async function copy(): Promise<void> {
  if (process.platform === 'darwin') {
    await pressKey(Key.LeftCmd, Key.C);
  } else {
    await pressKey(Key.LeftControl, Key.C);
  }
}

export async function paste(): Promise<void> {
  if (process.platform === 'darwin') {
    await pressKey(Key.LeftCmd, Key.V);
  } else {
    await pressKey(Key.LeftControl, Key.V);
  }
}

// ── Scroll ──────────────────────────────────────────────────────────────

export async function scrollDown(amount = 3): Promise<void> {
  await mouse.scrollDown(amount);
}

export async function scrollUp(amount = 3): Promise<void> {
  await mouse.scrollUp(amount);
}

// ── App Launching ───────────────────────────────────────────────────────

export async function openApp(appName: string): Promise<void> {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`open -a "${appName}"`);
  } else if (process.platform === 'win32') {
    execSync(`start "" "${appName}"`);
  } else {
    execSync(`xdg-open "${appName}" &`);
  }
  await sleep(1000); // Wait for app to open
}

export async function openUrl(url: string): Promise<void> {
  const { execSync } = require('child_process');
  if (process.platform === 'darwin') {
    execSync(`open "${url}"`);
  } else if (process.platform === 'win32') {
    execSync(`start "" "${url}"`);
  } else {
    execSync(`xdg-open "${url}"`);
  }
  await sleep(1500);
}

// ── Spotlight / System Search ───────────────────────────────────────────

export async function openSpotlight(): Promise<void> {
  if (process.platform === 'darwin') {
    await pressKey(Key.LeftCmd, Key.Space);
    await sleep(500);
  } else if (process.platform === 'win32') {
    await pressKey(Key.LeftSuper);
    await sleep(500);
  }
}

export async function searchAndOpen(query: string): Promise<void> {
  await openSpotlight();
  await typeText(query, 30);
  await sleep(500);
  await pressEnter();
  await sleep(1000);
}

// ── Screen Info ─────────────────────────────────────────────────────────

export async function getScreenSize(): Promise<ScreenSize> {
  const s = await screen.width();
  const h = await screen.height();
  return { width: s, height: h };
}

// ── Utility ─────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { sleep, Key };
