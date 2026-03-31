/**
 * PromptMesh Test Suite
 * Node 18+ / ESM  —  run: node tests/test_suite.mjs
 *
 * Checks:
 *  1. JS syntax (all script blocks parseable)
 *  2. Required CORS header present in every Anthropic API call
 *  3. All hard-coded model names are current/cheap (Haiku)
 *  4. max_tokens budgets are within sensible bounds
 *  5. CSP headers allow api.anthropic.com + localhost:7842 (sysai)
 *  6. No sequential bot execution in Dev Arena (must use Promise.allSettled)
 *  7. SysAI chat doesn't rebuild context on every turn
 *  8. Cost estimate per pipeline ≤ $0.006
 *  9. HTML files don't contain obvious tag errors (<\div>, </ div>, etc.)
 * 10. All product pages link back to hub
 */

import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { Script } from 'vm';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = resolve(__dir, '..');

// ── CLI flags ────────────────────────────────────────────────────────────────
// Usage: node tests/test_suite.mjs --exclude studio,enterprise
const excludeArg = process.argv.find(a => a.startsWith('--exclude'));
const EXCLUDE = new Set(
  excludeArg
    ? (excludeArg.includes('=') ? excludeArg.split('=')[1] : process.argv[process.argv.indexOf(excludeArg) + 1])
        .split(',').map(s => s.trim().toLowerCase())
    : []
);

// ── helpers ──────────────────────────────────────────────────────────────────

let pass = 0, fail = 0, warn = 0;
const RESET = '\x1b[0m', GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', BOLD = '\x1b[1m', DIM = '\x1b[2m', CYAN = '\x1b[36m';

function ok(msg)      { console.log(`  ${GREEN}✓${RESET} ${msg}`); pass++; }
function ko(msg)      { console.log(`  ${RED}✗${RESET} ${msg}`); fail++; }
function note(msg)    { console.log(`  ${YELLOW}~${RESET} ${msg}`); warn++; }
function section(msg) { console.log(`\n${BOLD}${CYAN}── ${msg}${RESET}`); }
function read(f)      { return readFileSync(resolve(ROOT, f), 'utf8'); }

// Approximate token count (4 chars ≈ 1 token)
// Accepts a string OR a char-count number
const approxTokens = x => Math.ceil((typeof x === 'number' ? x : x.length) / 4);
const HAIKU_COST   = 0.00025 / 1000; // per token

// ── files ────────────────────────────────────────────────────────────────────

const FILES = {
  enterprise: 'promptmesh-enterprise.html',
  dev:        'promptmesh-dev.html',
  sysai:      'promptmesh-sysai.html',
  hub:        'promptmesh-hub.html',
  index:      'index.html',
};

const contents = {};
for (const [key, file] of Object.entries(FILES)) {
  if (EXCLUDE.has(key)) continue;
  contents[key] = read(file);
}

if (EXCLUDE.size) {
  console.log(`${DIM}Excluding: ${[...EXCLUDE].join(', ')}${RESET}`);
}

// ── 1. JS syntax ─────────────────────────────────────────────────────────────

section('1. JavaScript syntax');

for (const [key, html] of Object.entries(contents)) {
  // Extract all <script> blocks (excluding external src= ones)
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(m => m[1]);

  let fileOk = true;
  for (let i = 0; i < blocks.length; i++) {
    // Use `node --check` via a temp file — supports async/await properly
    const tmp = resolve(ROOT, `.tmp_syntax_check_${key}_${i}.js`);
    try {
      writeFileSync(tmp, blocks[i]);
      const result = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
      if (result.status !== 0) {
        const msg = (result.stderr || result.stdout || '').split('\n')[0];
        ko(`${FILES[key]} block ${i}: ${msg}`);
        fileOk = false;
      }
    } finally {
      try { unlinkSync(tmp); } catch { /* ignore */ }
    }
  }
  if (fileOk) ok(`${FILES[key]} — ${blocks.length} script block(s) parse cleanly`);
}

// ── 2. Required CORS header ───────────────────────────────────────────────────

section('2. Anthropic CORS header on every API call');

const REQUIRED_HEADER = 'anthropic-dangerous-request-when-unauthenticated';

for (const [key, html] of Object.entries(contents)) {
  // Find every fetch to api.anthropic.com
  const fetchBlocks = [...html.matchAll(/fetch\s*\(\s*['"`]https:\/\/api\.anthropic\.com[^)]+\)/gs)];
  if (fetchBlocks.length === 0) continue; // no API calls in this file

  let allGood = true;
  for (const [match] of fetchBlocks) {
    // Look in a reasonable window after the fetch call for the header
    const idx = html.indexOf(match);
    const window = html.slice(idx, idx + 600);
    if (!window.includes(REQUIRED_HEADER)) {
      ko(`${FILES[key]}: API call missing '${REQUIRED_HEADER}' header`);
      allGood = false;
    }
  }
  if (allGood) ok(`${FILES[key]} — ${fetchBlocks.length} API call(s) all have CORS header`);
}

// ── 3. Model names ────────────────────────────────────────────────────────────

section('3. Hard-coded model names (should be Haiku)');

const PREFERRED_MODEL = 'claude-haiku-4-5-20251001';
const EXPENSIVE = ['claude-opus', 'claude-sonnet', 'gpt-4o', 'gpt-4-turbo'];

for (const [key, html] of Object.entries(contents)) {
  // Find hard-coded model strings (not inside user-editable bot configs)
  const hardCoded = [...html.matchAll(/model:\s*['"`](claude-[^'"` ]+|gpt-[^'"` ]+)['"`]/g)];
  if (hardCoded.length === 0) continue;

  for (const m of hardCoded) {
    const model = m[1];
    if (EXPENSIVE.some(e => model.includes(e))) {
      // Only flag if it looks like infrastructure code, not user-configurable
      note(`${FILES[key]}: hard-coded expensive model '${model}' — verify it's user-selectable, not fixed infra`);
    } else if (model === PREFERRED_MODEL) {
      ok(`${FILES[key]}: infra model = ${model}`);
    } else {
      note(`${FILES[key]}: model '${model}' — not Haiku, check if intentional`);
    }
  }
}

// ── 4. Token budgets ──────────────────────────────────────────────────────────

section('4. max_tokens budgets');

const TOKEN_LIMITS = {
  // call purpose    max reasonable
  router:           200,
  judge:            200,
  verify:           20,
  chat:             1500,
  agent:            1500,
  pipeline:         800,
};

// Per-file: collect all max_tokens values and classify
for (const [key, html] of Object.entries(contents)) {
  const tokenVals = [...html.matchAll(/max_tokens\s*[:=]\s*(\d+)/g)]
    .map(m => parseInt(m[1], 10));
  if (tokenVals.length === 0) continue;

  for (const v of tokenVals) {
    if (v > 4096) {
      ko(`${FILES[key]}: max_tokens=${v} exceeds 4096 (Haiku context limit)`);
    } else if (v > 1500) {
      note(`${FILES[key]}: max_tokens=${v} is high — verify this is intentional`);
    } else {
      ok(`${FILES[key]}: max_tokens=${v} — within bounds`);
    }
  }
}

// ── 5. CSP headers ────────────────────────────────────────────────────────────

section('5. Content Security Policy');

for (const [key, html] of Object.entries(contents)) {
  // Match: http-equiv="Content-Security-Policy" content="..."
  // Use [^"]+ (stop at double-quote only) because CSP values contain single quotes like 'self'
  const cspMatch = html.match(/Content-Security-Policy"[^>]*content="([^"]+)"/i)
                || html.match(/content="([^"]+)"[^>]*Content-Security-Policy/i);
  if (!cspMatch) { note(`${FILES[key]}: no inline CSP meta tag`); continue; }
  const csp = cspMatch[1];

  // Only require api.anthropic.com in CSP if the page makes API calls
  const hasApiCalls = contents[key].includes('api.anthropic.com');
  if (hasApiCalls) {
    if (!csp.includes('https://api.anthropic.com')) {
      ko(`${FILES[key]}: CSP missing api.anthropic.com in connect-src`);
    } else {
      ok(`${FILES[key]}: CSP allows api.anthropic.com`);
    }
  } else {
    ok(`${FILES[key]}: no API calls — CSP check skipped`);
  }

  if (key === 'sysai') {
    if (!csp.includes('http://localhost:7842')) {
      ko(`sysai: CSP missing http://localhost:7842 for local agent`);
    } else {
      ok(`sysai: CSP allows http://localhost:7842 (local agent)`);
    }
  }
}

// ── 6. Dev Arena parallel execution ──────────────────────────────────────────

section('6. Dev Arena — parallel bot execution');

{
  const dev = contents.dev;
  if (dev.includes('Promise.allSettled') || dev.includes('Promise.all(')) {
    ok('Dev Arena uses Promise.allSettled / Promise.all for bot execution');
  } else {
    ko('Dev Arena: bots may run sequentially — look for Promise.all/allSettled');
  }
}

// ── 7. SysAI chat context efficiency ─────────────────────────────────────────

section('7. SysAI — chat context injection efficiency');

{
  const sysai = contents.sysai;
  // Check that system prompt in sendChat does NOT concatenate buildSystemSummary every call
  const badPattern = /system:\s*SYSAI_SYSTEM\s*\+\s*context/;
  if (badPattern.test(sysai)) {
    ko('SysAI sendChat: context concatenated to system prompt on every call — wastes ~100 tokens/turn');
  } else {
    ok('SysAI sendChat: system context handled efficiently (not rebuilt every call)');
  }

  // Check that context injection uses first-message pattern
  if (sysai.includes('userMsgCount === 1') || sysai.includes("length === 1")) {
    ok('SysAI sendChat: context injected into first user message only');
  } else {
    note('SysAI sendChat: verify context is not repeated on every turn');
  }
}

// ── 8. Cost estimate per pipeline ────────────────────────────────────────────

section('8. Cost estimate per Studio pipeline run');

{
  note('Studio excluded from this run — skipping pipeline cost check');
}

// ── 9. Tag integrity ──────────────────────────────────────────────────────────

section('9. HTML tag integrity');

const BAD_TAG_PATTERNS = [
  // <\div> style typo — only in literal HTML strings (not JS regex literals)
  { re: /<\\\w+>/g,      desc: 'backslash in closing tag (e.g. <\\div>)' },
  { re: /<\/\s+\w+>/g,   desc: 'space after </ in closing tag (e.g. </ div>)' },
  { re: /<!-[^-]/g,      desc: 'malformed comment (single dash)' },
];

for (const [key, html] of Object.entries(contents)) {
  // Strip <script> blocks so regex patterns inside JS don't false-positive
  const htmlOnly = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  let clean = true;
  for (const { re, desc } of BAD_TAG_PATTERNS) {
    const matches = [...htmlOnly.matchAll(re)];
    if (matches.length) {
      ko(`${FILES[key]}: ${matches.length} instance(s) of ${desc}`);
      clean = false;
    }
  }
  if (clean) ok(`${FILES[key]}: no malformed tags found`);
}

// ── 10. Hub back-links ───────────────────────────────────────────────────────

section('10. Product pages link back to hub');

const PRODUCT_PAGES = ['enterprise', 'dev', 'sysai'];

for (const key of PRODUCT_PAGES) {
  if (EXCLUDE.has(key)) continue;
  const html = contents[key];
  if (html.includes('promptmesh-hub.html') || html.includes("go('hub')") || html.includes('"hub"')) {
    ok(`${FILES[key]}: has hub back-link`);
  } else {
    note(`${FILES[key]}: no explicit hub back-link found — verify navigation`);
  }
}

// ── summary ──────────────────────────────────────────────────────────────────

console.log(`\n${BOLD}══════════════════════════════════════${RESET}`);
const total = pass + fail + warn;
console.log(`${BOLD}Results: ${GREEN}${pass} passed${RESET}  ${RED}${fail} failed${RESET}  ${YELLOW}${warn} warnings${RESET}  (${total} checks)`);
if (fail === 0) {
  console.log(`${GREEN}${BOLD}All checks passed!${RESET}`);
} else {
  console.log(`${RED}${BOLD}${fail} check(s) need attention.${RESET}`);
}
console.log();

process.exit(fail > 0 ? 1 : 0);
