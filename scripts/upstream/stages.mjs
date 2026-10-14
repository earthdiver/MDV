import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { startPreview } from './preview.mjs';
import { repositoryRoot } from './client.mjs';
import { hash, verifySources } from '../../scripts/compatibility/corpus.mjs';
import { compareHtml, summarize, reportHtml } from '../../scripts/compatibility/compare.mjs';
import { diagramSnapshot, pixelDifference, verifyBrowserComparator } from '../../scripts/compatibility/browser-compare.mjs';

const args = process.argv.slice(2); let filter;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--case' && args[i + 1]) filter = args[++i];
  else if (args[i] !== '--strict') throw new Error(`Unknown option: ${args[i]}`);
}
const sources = await verifySources();
const catalog = JSON.parse(await readFile(resolve(repositoryRoot, 'tests/compatibility/browser-cases.json')));
const profiles = JSON.parse(await readFile(resolve(repositoryRoot, 'tests/compatibility/profiles.json')));
const config = profiles.browserReference;
const typography = JSON.parse(await readFile(resolve(repositoryRoot, 'tests/compatibility/service-typography.json')));
for (const name of ['mermaid', 'mathjax']) {
  const installed = JSON.parse(await readFile(resolve(repositoryRoot, `node_modules/${name}/package.json`)));
  if (installed.version !== config[name]) throw new Error(`Reference version mismatch: ${name}`);
}
const cases = catalog.cases.filter(test => !filter || test.id === filter);
if (!cases.length) throw new Error('No matching cases');
const out = resolve(repositoryRoot, `artifacts/compatibility/stages${filter ? `-${filter}` : ''}`);
await mkdir(out, { recursive: true });
const preview = await startPreview({ reference: true });
let browser;
const results = [];
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: config.viewport, deviceScaleFactor: config.deviceScaleFactor, locale: 'ja-JP', timezoneId: 'UTC' });
  const blocked = [];
  await context.route('**/*', route => {
    if (route.request().url().startsWith(preview.origin + '/')) return route.continue();
    blocked.push(route.request().url()); return route.abort();
  });
  const control = await context.newPage(); await verifyBrowserComparator(control); await control.close();
  for (const test of cases) for (const mode of test.modes) {
    const original = await preview.engines[mode].render(test.markdown);
    for (const variant of catalog.variants) {
      const id = `${test.id}-${mode}-${variant.id}`;
      const result = { id, mode, variant, markdown: test.markdown, serviceStatus: 'unverified',
        referenceKind: test.kind === 'pending' ? 'missing-service-capture' : 'upstream-library', stages: {} };
      const actual = await context.newPage(), reference = await context.newPage();
      const errors = [], requestStart = blocked.length;
      actual.on('pageerror', error => errors.push(String(error)));
      try {
        await actual.goto(preview.origin); await actual.waitForFunction(() => window.upstreamPreview);
        // Isolate the document while preserving the same display pipeline and CSS.
        await actual.addStyleTag({ content: 'body{margin:0}body>header,main>section{display:none}main{display:block}#preview{width:960px;max-width:100%;margin:0}' });
        await actual.emulateMedia({ media: variant.media, reducedMotion: 'reduce' });
        const display = await actual.evaluate(({ result, options }) => window.upstreamPreview.display(result, options), {
          result: { ...original, metadata: preview.engines[mode].metadata }, options: { theme: variant.theme, captureStages: true },
        });
        for (const [name, html] of Object.entries(display.stages)) {
          const file = `${id}-${name}.html.txt`; await writeFile(resolve(out, file), html);
          result.stages[name] = { sha256: hash(html), file };
        }
        result.stages.sanitized.comparison = compareHtml(display.stages.original, display.stages.sanitized);
        result.changes = display.changes; result.outline = display.outline; result.diagnostics = display.diagnostics;
        result.comparisonContext = test.kind === 'math' ? { ...typography[mode], wrapper: test.display ? 'div' : 'p', serviceVerified: 'declared-style-only' } : null;
        result.presentation = await actual.locator('#preview').evaluate(node => {
          const style = getComputedStyle(node);
          return Object.fromEntries(['fontFamily', 'fontSize', 'lineHeight', 'color', 'backgroundColor', 'width'].map(key => [key, style[key]]));
        });
        if (test.kind === 'pending') {
          await actual.locator('#preview').screenshot({ path: resolve(out, `${id}-actual.png`) });
          result.images = { actual: `${id}-actual.png` }; result.status = 'unverified'; result.reason = test.reason;
        } else {
          await reference.goto(preview.origin + '/reference.html'); await reference.waitForFunction(() => window.compatReference);
          const width = await actual.locator('#preview').evaluate(node => node.clientWidth);
          await reference.locator('#reference').evaluate((node, value) => { node.style.width = `${value}px`; }, width);
          const expected = await reference.evaluate(options => window.compatReference(options), {
            kind: test.kind, code: test.code, display: test.display, options: config.mermaidOptions,
            mathContext: test.kind === 'math' ? typography[mode] : undefined,
            theme: variant.media === 'print' ? 'light' : variant.theme,
          });
          const target = actual.locator(test.kind === 'mermaid' ? '#preview .diagram svg:visible' : '#preview mjx-container:visible');
          const hasActual = await target.count() === 1 && !display.diagnostics.length;
          if (!expected.rendered && !test.expectError) throw new Error(`Reference failed: ${expected.error}`);
          if (expected.rendered && test.expectError) throw new Error('Invalid input unexpectedly rendered in reference');
          if (!expected.rendered || !hasActual) {
            result.status = !expected.rendered && !hasActual && display.diagnostics.length ? 'match' : 'different';
            result.comparison = 'render/error behavior only'; result.firstDifferenceStage = result.status === 'match' ? null : 'graphics-render';
          } else {
            const expectedTarget = reference.locator(test.kind === 'mermaid' ? '#reference > svg' : '#reference mjx-container');
            const expectedHtml = await expectedTarget.evaluate(diagramSnapshot);
            const actualHtml = await target.evaluate(diagramSnapshot);
            result.dom = compareHtml(expectedHtml, actualHtml);
            await writeFile(resolve(out, `${id}-reference.html.txt`), expectedHtml);
            if (test.kind === 'mermaid') {
              const graphic = display.graphics.find(graphic => graphic.variant === (variant.media === 'print' ? 'print' : 'screen'));
              await actual.evaluate(svg => {
                const holder = document.createElement('div'); holder.id = 'stage-raw'; holder.hidden = true; holder.innerHTML = svg; document.body.append(holder);
              }, graphic.raw);
              const raw = await actual.locator('#stage-raw > svg').evaluate(diagramSnapshot);
              await actual.locator('#stage-raw').evaluate(node => node.remove());
              await writeFile(resolve(out, `${id}-graphic-raw.html.txt`), graphic.raw);
              result.stages.graphics = { reference: compareHtml(expectedHtml, raw), sanitization: compareHtml(raw, actualHtml) };
            }
            const expectedPng = await expectedTarget.screenshot({ path: resolve(out, `${id}-expected.png`), animations: 'disabled' });
            const actualPng = await target.screenshot({ path: resolve(out, `${id}-actual.png`), animations: 'disabled' });
            const difference = await reference.evaluate(pixelDifference, { expected: `data:image/png;base64,${expectedPng.toString('base64')}`,
              actual: `data:image/png;base64,${actualPng.toString('base64')}`, tolerance: config.pixelChannelTolerance });
            await writeFile(resolve(out, `${id}-diff.png`), Buffer.from(difference.diff.split(',')[1], 'base64')); delete difference.diff;
            result.pixels = { ...difference, status: difference.sameSize && difference.ratio <= config.maxDiffPixelRatio ? 'match' : 'different' };
            result.status = result.dom.status === 'match' && result.pixels.status === 'match' ? 'match' : 'different';
            result.firstDifferenceStage = result.stages.graphics?.reference.status === 'different' ? 'graphics-render' :
              result.stages.graphics?.sanitization.status === 'different' ? 'svg-sanitize' :
              result.dom.status === 'different' ? 'math-render' : result.pixels.status === 'different' ? 'presentation' : null;
            result.images = { expected: `${id}-expected.png`, actual: `${id}-actual.png`, diff: `${id}-diff.png` };
          }
        }
        if (errors.length || blocked.length !== requestStart) throw new Error(JSON.stringify({ errors, requests: blocked.slice(requestStart) }));
      } catch (error) { result.status = 'error'; result.error = String(error); }
      finally { await actual.close(); await reference.close(); }
      results.push(result); console.log(`${result.status}: ${id}`);
    }
  }
  const metadata = { generatedAt: new Date().toISOString(), browser: browser.version(), platform: process.platform,
    viewport: config.viewport, deviceScaleFactor: config.deviceScaleFactor, profiles, sources, typography,
    catalogHash: hash(JSON.stringify(catalog)), packageLockHash: hash(await readFile(resolve(repositoryRoot, 'package-lock.json'))),
    engines: Object.fromEntries(Object.entries(preview.engines).map(([mode, engine]) => [mode, engine.metadata])),
    stylesheetHashes: Object.fromEntries(await Promise.all(['qiita.css', 'qiita-host.css', 'github/primer.css', 'github-host.css', 'qiita/font-awesome/css/font-awesome.min.css'].map(async name => [name,
      hash(await readFile(resolve(repositoryRoot, 'artifacts/original-engines/preview', name)))]))),
    firstDifferenceStages: Object.fromEntries(['graphics-render', 'svg-sanitize', 'math-render', 'presentation'].map(stage =>
      [stage, results.filter(result => result.firstDifferenceStage === stage).length])),
    note: 'Reference graphics are independent library output. Selected article declarations are measured separately; full service CSS/assets/captures remain unverified. HTML stage deltas are observations, not automatically compatibility failures.' };
  const report = { schemaVersion: 1, description: '原実装HTMLから表示までの段階別比較。図・数式は独立ライブラリとの構造・画像比較。実サイトとの完全一致は未検証。',
    metadata, summary: summarize(results), results };
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(resolve(out, 'index.html'), reportHtml(report));
  console.log(JSON.stringify(report.summary)); console.log(`Report: ${out}/index.html`);
  if (report.summary.error || (args.includes('--strict') && results.some(result => result.status !== 'match' || result.serviceStatus !== 'verified'))) process.exitCode = 1;
} finally { await browser?.close(); await preview.close(); }
