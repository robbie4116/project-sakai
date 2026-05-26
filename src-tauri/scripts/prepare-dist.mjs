// Stage the offline build's static content.
// - Wipes src-tauri/dist-static/
// - Copies the runtime files from the repo root
// - taniman.html is staged as index.html (Tauri's webview expects index.html)
// - Strips the Supabase CDN <script> tag from the staged index.html
import { existsSync, rmSync, cpSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const SRC_TAURI = resolve(__dirname, '..');
const DIST = join(SRC_TAURI, 'dist-static');

// taniman.html is handled separately (renamed to index.html for Tauri)
const FILES = [
  'app.js', 'data.js', 'styles.css', 'config.js',
  'supabase-sync.js', 'offline-storage.js',
  'month-view-utils.js', 'calendar.js'
];
const DIRS = ['vendor', 'fonts', 'tiles'];

// 1) Wipe dist
if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });

// 2a) Copy taniman.html → index.html (Tauri's webview serves index.html by default)
const tanimanSrc = join(REPO, 'taniman.html');
if (!existsSync(tanimanSrc)) throw new Error('Missing source file: taniman.html');
cpSync(tanimanSrc, join(DIST, 'index.html'));

// 2b) Copy remaining files
for (const f of FILES) {
  const src = join(REPO, f);
  if (!existsSync(src)) throw new Error(`Missing source file: ${f}`);
  cpSync(src, join(DIST, f));
}

// 3) Copy directories
for (const d of DIRS) {
  const src = join(REPO, d);
  if (!existsSync(src)) throw new Error(`Missing source directory: ${d}`);
  cpSync(src, join(DIST, d), { recursive: true });
}

// 4) Strip the Supabase CDN <script> tag from the staged index.html
const htmlPath = join(DIST, 'index.html');
const html = readFileSync(htmlPath, 'utf8');
const CDN_RE = /^\s*<script\s+src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/[^"]+"\s*>\s*<\/script>\s*$/gm;
const matches = html.match(CDN_RE);
if (!matches || matches.length === 0) {
  throw new Error('prepare-dist: Supabase CDN <script> regex matched zero tags in taniman.html. Verify the tag still exists at repo root or update the regex.');
}
const stripped = html.replace(CDN_RE, '');
writeFileSync(htmlPath, stripped);

// 5) Print summary
function dirSize(p) {
  let total = 0;
  for (const entry of readdirSync(p, { withFileTypes: true })) {
    const full = join(p, entry.name);
    total += entry.isDirectory() ? dirSize(full) : statSync(full).size;
  }
  return total;
}
const totalBytes = dirSize(DIST);
console.log(`prepare-dist: staged taniman.html→index.html + ${FILES.length} files + ${DIRS.length} dirs into ${DIST}`);
console.log(`prepare-dist: total size ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`prepare-dist: stripped ${matches.length} Supabase CDN <script> tag(s)`);
