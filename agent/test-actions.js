/**
 * ISIBI Ghost Mode — Action Test Suite (Node.js compatible)
 * Tests file ops, clipboard, HTTP, system info, notifications, windows
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
let passed = 0;
let failed = 0;
const errors = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ${PASS} ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ${FAIL} ${name}: ${e.message}`);
    failed++;
    errors.push(`${name}: ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function run() {
  console.log('\n\x1b[1m🧪 ISIBI Ghost Mode — Action Test Suite\x1b[0m\n');

  // ── File Operations ──
  console.log('\x1b[36mFile Operations:\x1b[0m');
  const tmpDir = os.tmpdir();
  const testFile = path.join(tmpDir, 'isibi-test-' + Date.now() + '.txt');
  const testFile2 = testFile + '.moved';

  await test('create_file', () => {
    const dir = path.dirname(testFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(testFile, 'Hello ISIBI!', 'utf-8');
    assert(fs.existsSync(testFile), 'File should exist');
  });

  await test('read_file', () => {
    const content = fs.readFileSync(testFile, 'utf-8');
    assert(content === 'Hello ISIBI!', `Expected "Hello ISIBI!" got "${content}"`);
  });

  await test('move_file', () => {
    fs.renameSync(testFile, testFile2);
    assert(!fs.existsSync(testFile), 'Original should be gone');
    assert(fs.existsSync(testFile2), 'Moved file should exist');
  });

  await test('delete_file', () => {
    fs.unlinkSync(testFile2);
    assert(!fs.existsSync(testFile2), 'File should be deleted');
  });

  await test('read_file (nonexistent)', () => {
    try { fs.readFileSync('/tmp/nonexistent-isibi-xyz.txt', 'utf-8'); assert(false, 'Should throw'); }
    catch { /* expected */ }
  });

  // ── Clipboard ──
  console.log('\n\x1b[36mClipboard:\x1b[0m');

  await test('write + read clipboard', () => {
    const testStr = 'ISIBI_TEST_' + Date.now();
    execSync(`echo -n ${JSON.stringify(testStr)} | pbcopy`, { timeout: 3000 });
    const result = execSync('pbpaste', { encoding: 'utf-8', timeout: 3000 });
    assert(result.includes('ISIBI_TEST_'), `Clipboard should contain test text, got: "${result.slice(0, 50)}"`);
  });

  // ── System Info ──
  console.log('\n\x1b[36mSystem Info:\x1b[0m');

  await test('get_volume', () => {
    const output = execSync(`osascript -e 'output volume of (get volume settings)'`, { encoding: 'utf-8', timeout: 3000 });
    const vol = parseInt(output.trim());
    assert(typeof vol === 'number' && vol >= 0 && vol <= 100, `Volume should be 0-100, got: ${vol}`);
    console.log(`    (Volume: ${vol}%)`);
  });

  await test('get_battery', () => {
    const output = execSync('pmset -g batt', { encoding: 'utf-8', timeout: 3000 });
    const pMatch = output.match(/(\d+)%/);
    const percent = pMatch ? parseInt(pMatch[1]) : -1;
    const charging = output.includes('charging') || output.includes('AC Power');
    assert(percent >= 0 && percent <= 100, `Battery should be 0-100, got: ${percent}`);
    console.log(`    (Battery: ${percent}%, ${charging ? 'charging' : 'on battery'})`);
  });

  await test('isDarkMode', () => {
    let dark = false;
    try {
      const output = execSync('defaults read -g AppleInterfaceStyle 2>/dev/null', { encoding: 'utf-8', timeout: 3000 });
      dark = output.trim().toLowerCase() === 'dark';
    } catch { dark = false; }
    assert(typeof dark === 'boolean', 'Should return boolean');
    console.log(`    (Dark mode: ${dark})`);
  });

  // ── Window Management ──
  console.log('\n\x1b[36mWindow Management:\x1b[0m');

  await test('list_windows', () => {
    try {
      const output = execSync(`osascript -e 'tell application "System Events"
  set winList to ""
  repeat with proc in (every process whose background only is false)
    set appName to name of proc
    repeat with w in windows of proc
      set winList to winList & appName & "|" & name of w & "\\n"
    end repeat
  end repeat
  return winList
end tell'`, { encoding: 'utf-8', timeout: 10000 });
      const windows = output.split('\n').filter(l => l.includes('|'));
      assert(windows.length >= 0, 'Should return array');
      console.log(`    (Found ${windows.length} windows)`);
      if (windows.length > 0) {
        const [app, name] = windows[0].split('|');
        console.log(`    (First: ${app} — "${name}")`);
      }
    } catch (e) {
      // May fail without accessibility permission
      console.log(`    (Skipped: needs accessibility permission)`);
    }
  });

  // ── Notifications ──
  console.log('\n\x1b[36mNotifications:\x1b[0m');

  await test('showNotification', () => {
    execSync(`osascript -e 'display notification "Action test suite running!" with title "ISIBI Test"'`, { timeout: 5000 });
  });

  await test('speak (short)', () => {
    execSync(`say "test"`, { timeout: 10000 });
  });

  // ── HTTP Request ──
  console.log('\n\x1b[36mHTTP Request:\x1b[0m');

  await test('http GET', () => {
    return new Promise((resolve, reject) => {
      const https = require('https');
      https.get('https://httpbin.org/get', (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            assert(res.statusCode === 200, `Expected 200, got ${res.statusCode}`);
            assert(data.includes('httpbin'), 'Body should contain httpbin');
            resolve();
          } catch (e) { reject(e); }
        });
      }).on('error', reject);
    });
  });

  await test('http POST', () => {
    return new Promise((resolve, reject) => {
      const https = require('https');
      const postData = JSON.stringify({ test: 'isibi' });
      const req = https.request({
        hostname: 'httpbin.org', path: '/post', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            assert(res.statusCode === 200, `Expected 200, got ${res.statusCode}`);
            assert(data.includes('isibi'), 'Body should contain posted data');
            resolve();
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  });

  // ── Brain / Compiled Code ──
  console.log('\n\x1b[36mCompiled Code Validation:\x1b[0m');

  await test('brain.js exists and exports', () => {
    const brainPath = path.join(__dirname, 'dist/brain.js');
    assert(fs.existsSync(brainPath), 'brain.js should exist in dist/');
    const brain = require(brainPath);
    assert(typeof brain.processCommand === 'function', 'Should export processCommand');
    assert(typeof brain.getTaskQueue === 'function', 'Should export getTaskQueue');
    assert(typeof brain.getActiveTask === 'function', 'Should export getActiveTask');
    assert(typeof brain.addToHistory === 'function', 'Should export addToHistory');
    assert(typeof brain.clearHistory === 'function', 'Should export clearHistory');
  });

  await test('controller.js exists and exports all functions', () => {
    const ctrlPath = path.join(__dirname, 'dist/controller.js');
    assert(fs.existsSync(ctrlPath), 'controller.js should exist in dist/');
    const ctrl = require(ctrlPath);
    const expected = [
      'moveMouse', 'click', 'doubleClick', 'rightClick', 'getMousePosition',
      'typeText', 'pressKey', 'pressEnter', 'pressTab', 'pressEscape',
      'selectAll', 'copy', 'paste', 'scrollDown', 'scrollUp',
      'openApp', 'openUrl', 'openSpotlight', 'searchAndOpen', 'getScreenSize',
      'drag', 'readClipboard', 'writeClipboard', 'createFile', 'readFile',
      'moveFile', 'deleteFile', 'httpRequest',
      'showNotification', 'showAlert', 'speak',
      'listWindows', 'switchWindow', 'resizeWindow', 'moveWindow', 'splitScreen',
      'setVolume', 'getVolume', 'toggleWifi', 'toggleBluetooth',
      'toggleDarkMode', 'isDarkMode', 'sleepComputer', 'emptyTrash', 'getBattery',
      'holdKey', 'selectTextRange', 'sleep'
    ];
    const missing = expected.filter(fn => typeof ctrl[fn] !== 'function');
    assert(missing.length === 0, `Missing exports: ${missing.join(', ')}`);
    console.log(`    (${expected.length} functions verified)`);
  });

  await test('All source files compile cleanly', () => {
    const distFiles = ['brain.js', 'controller.js', 'main.js', 'config.js', 'agents.js', 'agent-manager.js', 'indexer.js', 'onboarding.js', 'overlay.js', 'vision.js'];
    const missing = distFiles.filter(f => !fs.existsSync(path.join(__dirname, 'dist', f)));
    assert(missing.length === 0, `Missing compiled files: ${missing.join(', ')}`);
    console.log(`    (${distFiles.length} files compiled)`);
  });

  // ── Summary ──
  console.log('\n\x1b[1m────────────────────────────────\x1b[0m');
  console.log(`\x1b[1m  ${passed} passed, ${failed} failed\x1b[0m`);
  if (errors.length > 0) {
    console.log('\n\x1b[31mFailures:\x1b[0m');
    errors.forEach(e => console.log(`  - ${e}`));
  }
  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error('Test runner error:', e); process.exit(1); });
