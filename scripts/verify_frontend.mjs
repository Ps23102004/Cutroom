#!/usr/bin/env node
/** Independent browser evidence runner. Requires an already-running dev server. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const out = join(root, 'docs/evidence/frontend-independent');
const url = process.env.CUTROOM_URL || 'http://127.0.0.1:5173';
mkdirSync(out, { recursive: true });
const run = (args) => execFileSync('playwright-cli', ['-s=cutroom-l5', ...args], { cwd: root, encoding: 'utf8', timeout: 30000 });
const results = { url, started_at: new Date().toISOString(), captures: [], checks: [] };
const decode = (value) => { const first = JSON.parse(String(value).trim()); return typeof first === 'string' ? JSON.parse(first) : first; };
try {
  run(['open', url]);
  const snapshot = run(['--raw', 'snapshot']);
  writeFileSync(join(out, 'home.snapshot.txt'), snapshot);
  const nav = ['Home', 'Projects', 'Studio', 'AI Briefs', 'Review', 'Versions', 'Deliver', 'Settings'];
  const actualNav = decode(run(['--raw', 'eval', "JSON.stringify([...document.querySelectorAll('nav[aria-label=Primary] > button')].map(x => x.innerText.trim().replace(/\\s+Scope$/, '')))" ]));
  results.checks.push({ name: 'canonical_navigation', pass: JSON.stringify(actualNav) === JSON.stringify(nav), expected: nav, actual: actualNav });
  const routeLabels = ['Home', 'Projects', 'Studio', 'AI Briefs', 'Review', 'Versions', 'Deliver', 'Settings'];
  for (const [width, height] of [[1440, 900], [1728, 1117]]) {
    run(['resize', String(width), String(height)]);
    const geometry = decode(run(['--raw', 'eval', "JSON.stringify({sidebar:document.querySelector('aside')?.getBoundingClientRect().width, topbar:document.querySelector('header')?.getBoundingClientRect().height})"]));
    results.checks.push({ name: `shell_geometry_${width}x${height}`, pass: geometry.sidebar === 216 && geometry.topbar === 56, ...geometry, expected: { sidebar: 216, topbar: 56 } });
    for (const label of routeLabels) {
      const clickCount = Number(run(['--raw', 'eval', `(()=>{const xs=[...document.querySelectorAll('nav[aria-label="Primary"] > button')].filter(x=>x.innerText.trim().replace(/\\s+Scope$/,'')===${JSON.stringify(label)}); if(xs.length!==1) throw Error('expected one nav target for ${label}, got '+xs.length); xs[0].click(); return xs.length;})()`]).trim());
      if (clickCount !== 1) throw Error(`nav target count for ${label}`);
      run(['screenshot', '--filename', join(out, `${label.toLowerCase().replace(/ /g, '-')}-${width}x${height}.png`), '--hires']);
      results.captures.push({ route: label, viewport: `${width}x${height}`, path: join(out, `${label.toLowerCase().replace(/ /g, '-')}-${width}x${height}.png`), label: 'empty native-unavailable shell' });
    }
  }
  const parsed = decode(run(['--raw', 'eval', "JSON.stringify({body:document.body.innerText, actionable:[...document.querySelectorAll('button,a,input,select,textarea')].length})"]));
  results.checks.push({ name: 'native_unavailable_state', pass: /browser preview|native.*unavailable|Tauri.*inactive/i.test(parsed.body), native_state_visible: /browser preview|native.*unavailable|Tauri.*inactive/i.test(parsed.body) });
  run(['press', 'Tab']);
  const focus = decode(run(['--raw', 'eval', "JSON.stringify({tag:document.activeElement?.tagName, text:document.activeElement?.innerText || document.activeElement?.getAttribute('aria-label') || document.activeElement?.getAttribute('title'), visible:!!(document.activeElement && document.activeElement.getClientRects().length)})"]));
  results.checks.push({ name: 'keyboard_tab', pass: focus.visible && ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(focus.tag), focus });
  run(['--raw', 'eval', "(()=>{[...document.querySelectorAll('nav[aria-label=Primary] > button')].find(x=>x.innerText.trim().replace(/\\s+Scope$/,'')==='Home').click(); return 'home'})()"]);
  const before = decode(run(['--raw', 'eval', "JSON.stringify({count:document.body.innerText.match(/(\\d+) project(?:s)? found/)?.[1] ?? null, empty:document.body.innerText.includes('No projects created yet')})"]));
  const chooser = decode(run(['--raw', 'eval', "JSON.stringify((()=>{const xs=[...document.querySelectorAll('button')].filter(x=>x.innerText.trim()==='New Project'); if(xs.length!==1) throw Error('expected one New Project button'); xs[0].click(); return {count:xs.length};})())"]));
  if (chooser.count !== 1) throw Error('chooser target count');
  run(['--raw', 'eval', "(()=>{[...document.querySelectorAll('input')].find(x => x.getAttribute('placeholder')?.includes('Episode')).focus(); return 'focused'})()"]);
  run(['type', 'Rejected browser project']);
  const submit = decode(run(['--raw', 'eval', "JSON.stringify((()=>{const xs=[...document.querySelectorAll('button')].filter(x=>x.innerText.trim()==='Create Project'); if(xs.length!==1 || xs[0].disabled) throw Error('submit action unavailable'); xs[0].click(); return {count:xs.length,disabled:xs[0].disabled};})())"]));
  const after = decode(run(['--raw', 'eval', "JSON.stringify({count:document.body.innerText.match(/(\\d+) project(?:s)? found/)?.[1] ?? null, empty:document.body.innerText.includes('No projects created yet'), body:document.body.innerText})"]));
  const modal = run(['--raw', 'eval', "document.body.innerText.includes('Create New Project')"]).trim() === 'true';
  const visibleError = /NATIVE_UNAVAILABLE|native.*unavailable|Tauri.*inactive|cannot create|failed to create/i.test(after.body);
  results.checks.push({ name: 'browser_create_rejection_unchanged_list', pass: modal && visibleError && before.count === after.count && before.empty === after.empty, modal_still_open: modal, submit, visible_error: visibleError, projects_before: before, projects_after: { count: after.count, empty: after.empty } });
  run(['run-code', "async page => await page.emulateMedia({ reducedMotion: 'reduce' })"]);
  const liveReduced = decode(run(['--raw', 'eval', "JSON.stringify({canvases:document.querySelectorAll('canvas').length,staticFallback:[...document.images].some(x=>(x.alt||'').toLowerCase().includes('fallback')||x.src.includes('fallback'))})"]));
  results.checks.push({ name: 'reduced_motion_live_switch', pass: liveReduced.canvases === 0 && liveReduced.staticFallback, ...liveReduced });
  run(['reload']);
  const reduced = decode(run(['--raw', 'eval', "JSON.stringify({canvases:document.querySelectorAll('canvas').length,staticFallback:[...document.images].some(x=>(x.alt||'').toLowerCase().includes('fallback')||x.src.includes('fallback')),nav:document.querySelectorAll('nav[aria-label=Primary] > button').length})"]));
  results.checks.push({ name: 'reduced_motion_fallback', pass: reduced.canvases === 0 && reduced.staticFallback && reduced.nav === 8, ...reduced });
  run(['--raw', 'eval', "(()=>{[...document.querySelectorAll('nav[aria-label=Primary] > button')].find(x=>x.innerText.trim().replace(/\\s+Scope$/,'')==='Home').click(); return 'home'})()"]);
  const fixture = decode(run(['--raw', 'eval', "JSON.stringify((()=>{const xs=[...document.querySelectorAll('button')].filter(x=>x.innerText.includes('Explore with Sample Fixtures')); if(xs.length!==1) throw Error('fixture control missing'); xs[0].click(); return {count:xs.length};})())"]));
  if (fixture.count !== 1) throw Error('fixture target count');
  run(['--raw', 'eval', "(()=>{[...document.querySelectorAll('nav[aria-label=Primary] > button')].find(x=>x.innerText.trim().replace(/\\s+Scope$/,'')==='Studio').click(); return 'studio'})()"]);
  run(['resize', '1440', '900']); run(['screenshot', '--filename', join(out, 'studio-fixture-1440x900.png'), '--hires']);
  results.captures.push({ route: 'Studio', viewport: '1440x900', path: join(out, 'studio-fixture-1440x900.png'), label: 'explicit development fixture [FIXTURE]' });
} catch (error) {
  results.status = 'blocked';
  results.error = String(error.message || error);
}
try { run(['close']); } catch {}
results.status ||= results.checks.every((check) => check.pass) ? 'passed' : 'failed';
writeFileSync(join(out, 'report.json'), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify({ status: results.status, checks: results.checks.length, captures: results.captures.length, report: join(out, 'report.json') }, null, 2));
if (results.status !== 'passed') process.exitCode = 1;
