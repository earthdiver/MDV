import {comparePng} from './png-compare.mjs';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, extname } from 'node:path';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { corpusRoot, hash, inside, readJson, verifySources } from './corpus.mjs';
import { compareHtml, reportHtml, summarize } from './compare.mjs';
import { diagramSnapshot, mathSnapshot, alignMathCapture, verifyBrowserComparator } from './browser-compare.mjs';

const args = process.argv.slice(2);
let filter, kind;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--case' && args[i + 1]) filter = args[++i];
  else if (args[i] === '--kind' && args[i + 1]) kind = args[++i];
  else if (!['--strict', '--check'].includes(args[i])) throw new Error(`Unknown option: ${args[i]}`);
}
if (kind && !['math', 'mermaid', 'pending'].includes(kind)) throw new Error('Unknown comparison kind');
await verifySources();
const profiles = await readJson(resolve(corpusRoot, 'profiles.json'));
const config = profiles.browserReference;
const catalog = await readJson(resolve(corpusRoot, 'browser-cases.json'));
const cases = catalog.cases.filter(test => (!filter || test.id === filter) && (!kind || test.kind === kind));
if (!cases.length) throw new Error('No matching browser cases');
for (const [name, version] of [['mermaid', config.mermaid], ['mathjax', config.mathjax]]) {
  const installed = await readJson(resolve(`node_modules/${name}/package.json`));
  if (installed.version !== version) throw new Error(`Reference version mismatch: ${name} ${installed.version} != ${version}`);
}
execFileSync(process.execPath, ['scripts/build-renderer.mjs'], { stdio: 'inherit' });
const out = resolve('artifacts/compatibility/browser' + (filter ? `-${filter}` : kind ? `-${kind}` : ''));
const referenceRoot = resolve(out, 'reference');
await mkdir(referenceRoot, { recursive: true });
await build({ entryPoints: ['scripts/compatibility/reference.mjs'], bundle: true, format: 'esm', splitting: true,
  outdir: referenceRoot, entryNames: 'reference', target: 'es2022', logLevel: 'silent' });
await writeFile(resolve(referenceRoot, 'index.html'), `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;font:16px Arial,sans-serif}#reference{width:960px}svg{max-width:100%}</style>
<script>window.MathJax={startup:{typeset:false},loader:{load:['output/chtml']},svg:{fontCache:'none'},chtml:{fontURL:'/mathjax/output/chtml/fonts/woff-v2'}};</script>
<script defer src="/mathjax/tex-svg-full.js"></script><script type="module" src="/reference/reference.js"></script>
</head><body><div id="reference"></div></body></html>`);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    let root, relative;
    if (pathname.startsWith('/reference/')) { root = referenceRoot; relative = pathname.slice(11) || 'index.html'; }
    else if (pathname.startsWith('/mathjax/')) { root = resolve('node_modules/mathjax/es5'); relative = pathname.slice(9); }
    else { root = resolve('src/Mdv.App/Renderer'); relative = pathname.slice(1) || 'index.html'; }
    const path = inside(root, relative);
    const data = await readFile(path);
    response.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' }); response.end(data);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const results = [];
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: config.viewport, deviceScaleFactor: config.deviceScaleFactor, locale: 'ja-JP', timezoneId: 'UTC' });
  const control = await context.newPage();
  await verifyBrowserComparator(control);
  await control.close();
  const externalRequests = [];
  const virtualAssetRequests = [];
  await context.route('**/*', route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue();
    if (new URL(route.request().url()).origin === 'https://document.mdv.invalid') {
      virtualAssetRequests.push(route.request().url());
      // The host is absent in Chromium. Model an unavailable local resource,
      // without sending the app's private virtual URL to the network.
      return route.fulfill({ status: 404, body: '' });
    }
    externalRequests.push(route.request().url()); return route.abort();
  });
  for (const test of cases) for (const mode of test.modes) for (const variant of catalog.variants) {
    const id = `${test.id}-${mode}-${variant.id}`;
    const result = { id, caseId: test.id, mode, variant, referenceKind: test.kind === 'pending' ? 'missing-service-capture' : 'upstream-library',
      serviceStatus: 'unverified', source: test.source, markdown: test.markdown };
    const actual = await context.newPage(), reference = await context.newPage();
    actual.setDefaultTimeout(15000); reference.setDefaultTimeout(15000);
    const pageErrors = [];
    actual.on('pageerror', error => pageErrors.push(String(error)));
    const requestStart = externalRequests.length;
    const virtualStart = virtualAssetRequests.length;
    try {
      await actual.goto(origin);
      await actual.waitForFunction(() => window.mdv);
      await actual.emulateMedia({ media: variant.media, reducedMotion: 'reduce' });
      const rendered = await actual.evaluate(options => window.mdv.render(options), { markdown: test.markdown, mode, theme: variant.theme, requestId: 1 });
      result.diagnostics = rendered.diagnostics;
      await actual.evaluate(() => document.fonts.ready);
      if (test.kind === 'pending') {
        result.status = 'unverified'; result.reason = test.reason;
        await actual.locator('#document').screenshot({ path: resolve(out, `${id}-actual.png`), animations: 'disabled' });
        result.images = { actual: `${id}-actual.png` };
        result.actualHtml = await actual.locator('#document').innerHTML();
      } else {
        await reference.goto(origin + '/reference/');
        await reference.waitForFunction(() => window.compatReference && window.MathJax?.startup?.promise);
        const width = await actual.locator('#document').evaluate(node => {
          const style = getComputedStyle(node); return node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        });
        await reference.locator('#reference').evaluate((node, width) => { node.style.width = `${width}px`; }, width);
        const selector = test.kind === 'mermaid' ? '.diagram svg:visible' : '#document mjx-container:visible';
        const targets = actual.locator(selector);
        let mathContext;
        if (test.kind === 'math') {
          mathContext = await actual.locator('#document').evaluate(node => {
            const s = getComputedStyle(node);
            let background = 'rgb(255, 255, 255)';
            for (let parent = node; parent; parent = parent.parentElement) {
              const value = getComputedStyle(parent).backgroundColor;
              if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') { background = value; break; }
            }
            return {fontSize:s.fontSize, fontFamily:s.fontFamily, lineHeight:s.lineHeight, color:s.color, background};
          });
          result.mathContext = mathContext;
          await reference.emulateMedia({ media: variant.media, reducedMotion: 'reduce' });
        }
        const expected = await reference.evaluate(options => window.compatReference(options), {
          kind: test.kind, code: test.code, display: test.display, options: config.mermaidOptions, mode, mathContext,
          theme: variant.media === 'print' ? 'light' : variant.theme,
        });
        result.actualRenderCount = await targets.count();
        const target = targets.first();
        const hasActual = await target.count() > 0 && await actual.locator('.math-error, .diagram-error, [data-mjx-error]').count() === 0;
        if (!expected.rendered && !test.expectError) throw new Error(`Reference failed for a valid fixture: ${expected.error}`);
        if (expected.rendered && test.expectError) throw new Error('Invalid reference fixture unexpectedly rendered');
        if (!expected.rendered || !hasActual) {
          result.status = !expected.rendered && !hasActual && rendered.diagnostics.length ? 'match' : 'different';
          result.comparison = 'render/error behavior only'; result.referenceError = expected.error;
          result.actualRendered = hasActual; result.expectedRendered = expected.rendered;
        } else {
          const expectedTarget = reference.locator(test.kind === 'mermaid' ? '#reference > svg' : '#reference mjx-container');
          const expectedHtml = test.kind === 'mermaid' ? await expectedTarget.evaluate(diagramSnapshot) : await expectedTarget.evaluate(mathSnapshot);
          const actualHtml = test.kind === 'mermaid' ? await target.evaluate(diagramSnapshot) : await target.evaluate(mathSnapshot);
          result.dom = compareHtml(expectedHtml, actualHtml);
          await writeFile(resolve(out, `${id}-expected.html.txt`), expectedHtml);
          await writeFile(resolve(out, `${id}-actual.html.txt`), actualHtml);
          if (test.kind === 'math') {
            await target.evaluate(alignMathCapture);
            await expectedTarget.evaluate(alignMathCapture);
          }
          const expectedPng = await expectedTarget.screenshot({ path: resolve(out, `${id}-expected.png`), animations: 'disabled' });
          const actualPng = await target.screenshot({ path: resolve(out, `${id}-actual.png`), animations: 'disabled' });
          const difference = comparePng(expectedPng, actualPng, config.pixelChannelTolerance);
          await writeFile(resolve(out, `${id}-diff.png`), difference.diff);
          delete difference.diff;
          result.pixels = { ...difference, status: difference.sameSize && difference.ratio <= config.maxDiffPixelRatio ? 'match' : 'different' };
          result.status = result.actualRenderCount === 1 && result.dom.status === 'match' && result.pixels.status === 'match' ? 'match' : 'different';
          result.images = { expected: `${id}-expected.png`, actual: `${id}-actual.png`, diff: `${id}-diff.png` };
          result.comparison = test.kind === 'mermaid' ? 'Diagram SVG + pixels (generated ID alpha-renaming)' : 'MathJax DOM + pixels (matched host typography, output mode, paint gutters and pixel phase)';
          result.containerWidth = width;
        }
      }
      result.externalRequests = externalRequests.slice(requestStart);
      result.virtualAssetRequests = virtualAssetRequests.slice(virtualStart);
      if (pageErrors.length || result.externalRequests.length) throw new Error(JSON.stringify({ pageErrors, externalRequests: result.externalRequests }));
    } catch (error) { result.status = 'error'; result.error = String(error); }
    finally { await actual.close(); await reference.close(); }
    results.push(result);
    console.log(`${result.status}: ${id}`);
  }
  const report = { schemaVersion: 1, description: '図・数式の独立ライブラリ描画とのDOM/画像比較、および実サイト基準が未取得の項目。実サイト互換性は全件未検証。',
    metadata: { generatedAt: new Date().toISOString(), platform: process.platform, arch: process.arch, browser: browser.version(),
      node: process.version, packageLockHash: hash(await readFile('package-lock.json')), profiles, filteredCase: filter ?? null, filteredKind: kind ?? null,
      serviceVerification: 'unverified', expectedImageOrigin: 'independent upstream libraries, NOT MDV or service screenshots' },
    summary: summarize(results), results };
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(resolve(out, 'index.html'), reportHtml(report));
  console.log(JSON.stringify(report.summary)); console.log(`Report: ${out}/index.html`);
  if (report.summary.error || (args.includes('--check') && results.some(result => result.status !== 'match')) || (args.includes('--strict') && results.some(result => result.status !== 'match' || result.serviceStatus !== 'verified'))) process.exitCode = 1;
} finally { await browser?.close(); await new Promise(accept => server.close(accept)); }
