import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { startPreview } from './preview.mjs';
import { repositoryRoot } from './client.mjs';

const preview = await startPreview();
const out = resolve(repositoryRoot, 'artifacts/compatibility/original-engines/preview');
await mkdir(out, { recursive: true });
let browser;
const results = [];
const behavior = [];
const qiitaPresentation = JSON.parse(await readFile(resolve(repositoryRoot, 'tests/compatibility/qiita-presentation.json')));
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const requests = [], pageErrors = [];
  await context.route('**/*', route => {
    if (route.request().url().startsWith(preview.origin + '/')) return route.continue();
    requests.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.goto(preview.origin);
  await page.waitForFunction(() => window.upstreamPreview);
  // Exercise the visible UI and the Ruby/API path, not only a injected HTML fixture.
  for (const mode of ['github', 'qiita']) {
    await page.locator('#mode').selectOption(mode);
    await page.locator('#source').fill('# 原実装\n\n```mermaid\nflowchart LR\n A --> B\n```\n\n$x^2$');
    await page.locator('#render').click();
    await page.waitForFunction(() => !document.querySelector('#render').disabled);
    assert.match(await page.locator('#status').textContent(), new RegExp(`${mode} — 図 1、数式 1、表示エラー 0`));
    assert.deepEqual(await page.locator('#preview .diagram-screen .nodeLabel').allTextContents(), ['A', 'B']);
    for (const label of await page.locator('#preview .diagram-screen .nodeLabel').all()) {
      const bounds = await label.boundingBox();
      assert.ok(bounds?.width > 0 && bounds?.height > 0, 'diagram labels must remain visible after sanitization');
    }
    await page.screenshot({ path: resolve(out, `${mode}-preview.png`), fullPage: true });
  }
  // All diagram and math inputs from step 1 must reach browser rendering via the
  // original service output. Pending service-only features are still unverified.
  const catalog = JSON.parse(await readFile(resolve(repositoryRoot, 'tests/compatibility/browser-cases.json'), 'utf8'));
  for (const test of catalog.cases.filter(test => ['mermaid', 'math'].includes(test.kind))) {
    for (const mode of test.modes) {
      const id = `${test.id}-${mode}`;
      try {
        const response = await preview.engines[mode].render(test.markdown);
        const summary = await page.evaluate(result => window.upstreamPreview.display(result), { ...response, metadata: preview.engines[mode].metadata });
        if (test.expectError) {
          assert.equal(summary.diagrams, 0);
          assert.ok(summary.diagnostics.some(message => message.startsWith('mermaid:')));
          assert.match(await page.locator('#preview .render-error').textContent(), /.+/);
        } else {
          assert.deepEqual(summary.diagnostics, []);
          assert.ok(test.kind === 'mermaid' ? summary.diagrams === 1 : summary.math >= 1);
        }
        results.push({ id, status: 'pass', ...summary, serviceStatus: 'unverified' });
      } catch (error) { results.push({ id, status: 'error', error: String(error) }); }
    }
  }
  const show = async (mode, markdown, options = {}) => {
    const response = await preview.engines[mode].render(markdown);
    return page.evaluate(({ result, options }) => window.upstreamPreview.display(result, options),
      { result: { ...response, metadata: preview.engines[mode].metadata }, options });
  };
  // Real original output: Rouge tokens, note roles, alignment and color swatches
  // must survive the display adapter, including dark-screen -> light-print.
  const document = '# 日本語\n\n[Deep](#deep)\n\n<a name="source"></a>\n\n<details><summary>Hidden</summary><a name="deep"></a>Deep body</details>\n\n' +
    '## Second\n\nFootnote[^x]\n\n[^x]: Note\n\n' +
    ['info', 'warn', 'alert'].map(tone => `:::note ${tone}\n${tone}\n:::\n`).join('\n') +
    '\n```ruby:sample.rb\nputs 1\n```\n\n| L | R |\n|:--|--:|\n| a | b |\n\n`#ff0000` :rocket:';
  for (const variant of catalog.variants) {
    await page.emulateMedia({ media: variant.media });
    const summary = await show('qiita', document, { theme: variant.theme, captureStages: true });
    assert.deepEqual(summary.outline.map(heading => heading.text), ['日本語', 'Second']);
    assert.equal(summary.stages.original.includes('class="code-frame"'), true);
    assert.equal(summary.stages.sanitized.includes('class="mi"'), true);
    assert.equal(await page.locator('#preview .code-lang').textContent(), 'sample.rb');
    assert.equal(await page.locator('#preview .highlight pre code').textContent(), 'puts 1\n');
    const color = await page.locator('#preview .highlight .mi').evaluate(node => getComputedStyle(node).color);
    assert.equal(color, qiitaPresentation.palette.mi.color);
    const tones = await page.locator('#preview .note').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));
    assert.equal(new Set(tones).size, 3);
    if (variant.media === 'print' || variant.theme !== 'dark')
      assert.deepEqual(tones, ['info','warn','alert'].map(tone => qiitaPresentation.light[`.note.${tone}`].css.backgroundColor));
    assert.equal(await page.locator('#preview th').last().evaluate(node => getComputedStyle(node).textAlign), 'right');
    const swatch = page.locator('#preview .inline-code-color');
    assert.equal(await swatch.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(255, 0, 0)');
    assert.ok((await swatch.boundingBox()).width > 0);
    assert.equal(await page.locator('#preview .emoji').textContent(), '🚀');
    assert.ok(summary.changes.some(change => change.kind === 'emoji-resource-fallback'));
    assert.equal(await page.locator('#source').count(), 1, 'input IDs cannot clobber UI IDs');
    assert.equal(await page.locator('#preview a[href^="#"]').evaluateAll(links => links.every(link =>
      document.getElementById(link.getAttribute('href').slice(1)))), true);
    await page.locator('#preview a').filter({ hasText: 'Deep' }).click();
    assert.equal(await page.locator('#preview details').evaluate(node => node.open), true);
    await page.locator('#preview .footnote-ref a').click();
    await page.locator('#preview .footnote-backref').click();
    await page.screenshot({ path: resolve(out, `qiita-styles-${variant.id}.png`), fullPage: true });
    behavior.push({ id: `qiita-content-${variant.id}`, status: 'pass', serviceStatus: 'unverified' });
  }
  await page.emulateMedia({ media: 'screen' });
  for (const mode of ['github', 'qiita']) {
    const mathSource = '```math\nx=1\\label{eq:test}\\tag{A}\n```';
    const first = await show(mode, mathSource);
    const second = await show(mode, mathSource);
    assert.deepEqual(first.diagnostics, []); assert.deepEqual(second.diagnostics, []);
    assert.equal(first.math, second.math);
    behavior.push({ id: `math-document-reset-${mode}`, status: 'pass' });
    const styled = '```mermaid\n---\nconfig:\n  theme: dark\n---\nflowchart LR\n A --> B\n```';
    await show(mode, styled, { theme: 'dark' });
    const screen = await page.locator('#preview .diagram-screen .node rect').first().evaluate(node => getComputedStyle(node).fill);
    await page.emulateMedia({ media: 'print' });
    const print = await page.locator('#preview .diagram-print .node rect').first().evaluate(node => getComputedStyle(node).fill);
    assert.notEqual(screen, print, 'authored themes must not force dark diagrams in print');
    assert.equal(await page.locator('#preview .diagram svg:visible').count(), 1);
    await page.emulateMedia({ media: 'screen' });
    behavior.push({ id: `mermaid-print-${mode}`, status: 'pass' });
  }
  await show('github', '# Repeat\n\n## Repeat\n\n[Jump](#repeat-1)');
  assert.equal(await page.locator('#preview .heading-permalink').count(), 2);
  await page.locator('#preview a').filter({ hasText: 'Jump' }).click();
  assert.equal(await page.locator('#preview .heading-permalink').evaluateAll(links => links.every(link =>
    document.getElementById(link.getAttribute('href').slice(1)))), true);
  behavior.push({ id: 'github-heading-permalinks', status: 'pass' });
  const hostile = '<script>window.prototypeInjected=true</script><img src="https://example.com/leak" onerror="window.prototypeInjected=true">';
  for (const mode of ['github', 'qiita']) {
    const response = await preview.engines[mode].render(hostile);
    await page.evaluate(result => window.upstreamPreview.display(result), { ...response, metadata: preview.engines[mode].metadata });
    assert.equal(await page.evaluate(() => window.prototypeInjected), undefined);
    assert.equal(await page.locator('#preview script, #preview [onerror], #preview img[src]').count(), 0);
  }
  assert.deepEqual(requests, [], 'preview must remain offline after local setup');
  assert.deepEqual(pageErrors, []);
  const unauthenticated = await fetch(preview.origin + '/render', { method: 'POST', body: '{}' });
  assert.equal(unauthenticated.status, 403);
  await writeFile(resolve(out, 'report.json'), JSON.stringify({ browser: browser.version(), platform: process.platform,
    scope: 'Prototype rendering and content behavior, including dark/print; not service visual equivalence or Windows WebView2 checks',
    results, behavior, pageErrors, externalRequests: requests }, null, 2) + '\n');
  const failures = results.filter(result => result.status === 'error');
  if (failures.length) { console.error(failures); process.exitCode = 1; }
  console.log(`Original preview: ${results.length - failures.length}/${results.length} checks passed`);
} finally { await browser?.close(); await preview.close(); }
