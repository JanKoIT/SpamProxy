// Screenshot script using Puppeteer-like Chromium automation
// Usage: node scripts/take-screenshots.js

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3080';
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');

const pages = [
  { name: 'login', path: '/login', width: 1280, height: 800 },
  { name: 'dashboard', path: '/dashboard', width: 1440, height: 900 },
  { name: 'quarantine', path: '/quarantine', width: 1440, height: 900 },
  { name: 'mail-log', path: '/logs', width: 1440, height: 900 },
  { name: 'postfix-log', path: '/postfix-log', width: 1440, height: 900 },
  { name: 'domains', path: '/settings/domains', width: 1440, height: 900 },
  { name: 'security', path: '/settings/security', width: 1440, height: 900 },
  { name: 'blocklists', path: '/settings/blocklists', width: 1440, height: 900 },
  { name: 'access-lists', path: '/settings/access-lists', width: 1440, height: 900 },
  { name: 'scoring', path: '/settings/scoring', width: 1440, height: 900 },
  { name: 'dkim', path: '/settings/dkim', width: 1440, height: 900 },
  { name: 'ai-test', path: '/settings/ai-test', width: 1440, height: 900 },
  { name: 'sender-domains', path: '/settings/sender-domains', width: 1440, height: 900 },
  { name: 'outgoing-auth', path: '/users', width: 1440, height: 900 },
  { name: 'federation', path: '/settings/federation', width: 1440, height: 900 },
  { name: 'settings', path: '/settings', width: 1440, height: 900 },
];

fs.mkdirSync(OUT, { recursive: true });

// Login page (no auth needed)
console.log('Taking screenshot: login');
execSync(`chromium --headless --no-sandbox --disable-gpu --screenshot="${OUT}/login.png" --window-size=1280,800 "${BASE}/login" 2>/dev/null`);

// For authenticated pages, we need to bypass auth or use a direct approach
// Since NextAuth middleware redirects to /login, we screenshot what's accessible
for (const page of pages) {
  console.log(`Taking screenshot: ${page.name}`);
  try {
    execSync(
      `chromium --headless --no-sandbox --disable-gpu --screenshot="${OUT}/${page.name}.png" --window-size=${page.width},${page.height} "${BASE}${page.path}" 2>/dev/null`,
      { timeout: 15000 }
    );
  } catch (e) {
    console.log(`  Failed: ${page.name}`);
  }
}

console.log('Done! Screenshots in', OUT);
