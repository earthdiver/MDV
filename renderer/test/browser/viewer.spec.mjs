import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function render(page, markdown, mode = 'github', other = {}) {
  await page.goto('/');
  await page.waitForFunction(() => window.mdv);
  return page.evaluate(options => window.mdv.render(options), { markdown, mode, language: "ja", requestId: 1, ...other });
}

test('Ctrl+wheel uses host zoom shortcuts and leaves ordinary scrolling intact', async ({ page }) => {
  await page.addInitScript(() => { window.messages = []; window.chrome = { webview: { postMessage: message => window.messages.push(message), addEventListener() {} } }; });
  await render(page, '# Wheel\n\n' + 'Paragraph\n\n'.repeat(150));
  await page.mouse.move(600, 400);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await expect.poll(() => page.evaluate(() => window.messages.filter(m => m.type === 'shortcut').map(m => m.key))).toEqual(['zoomIn']);
  await page.mouse.wheel(0, 120);
  await expect.poll(() => page.evaluate(() => window.messages.filter(m => m.type === 'shortcut').map(m => m.key))).toEqual(['zoomIn', 'zoomOut']);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.keyboard.up('Control');
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.messages.filter(m => m.type === 'shortcut').length)).toBe(2);
  const canceled = await page.evaluate(() => [
    { ctrlKey: true, deltaY: -1, deltaMode: 1 },
    { ctrlKey: true, deltaY: 1, deltaMode: 2 },
    { ctrlKey: true, deltaY: 0, deltaX: 120 },
    { ctrlKey: true, altKey: true, deltaY: 120 },
    { deltaY: 120 },
  ].map(options => !document.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ...options }))));
  expect(canceled).toEqual([true, true, false, false, false]);
  expect(await page.evaluate(() => window.messages.filter(m => m.type === 'shortcut').map(m => m.key)))
    .toEqual(['zoomIn', 'zoomOut', 'zoomIn', 'zoomOut']);
});

test('both modes display the sample, math, diagrams, notes and filenames offline', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://document.mdv.invalid/**', route => route.fulfill({ path: 'samples/images/viewer.svg', contentType: 'image/svg+xml' }));
  const source = await readFile('samples/welcome.md', 'utf8');
  const github = await render(page, source);
  expect(github.diagnostics).toEqual([]);
  await expect(page.locator('.markdown-alert-note')).toBeVisible();
  await expect(page.locator('.katex')).toHaveCount(2);
  await expect(page.locator('.diagram svg:visible')).toHaveCount(1);
  await expect(page.locator('.diagram svg:visible .nodeLabel').first()).toBeVisible();
  await expect(page.locator('img')).toHaveJSProperty('naturalWidth', 880);
  const qiita = await page.evaluate(markdown => window.mdv.render({ markdown, mode: 'qiita', theme: 'dark' }), source);
  expect(qiita.diagnostics).toEqual([]);
  await expect(page.locator('.qiita-note')).toHaveCount(2);
  await expect(page.locator('figcaption').first()).toHaveText('hello.js');
  await expect(page.locator('.diagram svg:visible')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'artifacts/preview-qiita.png', fullPage: true });
});

test('hostile HTML does not execute, request images by default, or access host objects', async ({ page }) => {
  const requests = [];
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4179')) requests.push(request.url()); });
  await render(page, '<script>window.pwned=true</script>\n\n<img src="https://evil.test/tracker" onerror="window.pwned=true">\n\n<iframe src="https://evil.test"></iframe>\n\n[x](javascript:alert(1))');
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
  expect(requests).toEqual([]);
  await expect(page.locator('iframe, #document script')).toHaveCount(0);
});

test('printing uses light colors even when the viewer has a dark theme', async ({ page }) => {
  const source = '# Print\n\nBody\n\n```js\nconst n = "value";\n```\n\n> [!NOTE]\n> Note';
  const colors = () => page.evaluate(() => ['html', 'pre', '.hljs-keyword', '.hljs-string', '.markdown-alert-note'].map(selector => {
    const style = getComputedStyle(document.querySelector(selector));
    return [style.color, style.backgroundColor, style.getPropertyValue('--tone')];
  }));
  await render(page, source, 'github', { theme: 'light' });
  await page.emulateMedia({ media: 'print' });
  const light = await colors();
  await page.evaluate(markdown => window.mdv.render({ markdown, theme: 'dark' }), source);
  expect(await colors()).toEqual(light);
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await page.emulateMedia({ media: 'screen' });
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(13, 17, 23)');
});

test('Mermaid printing uses light diagrams and preserves dark screen colors', async ({ page }) => {
  const source = ['sequenceDiagram\nAlice->>Bob: Hello Bob', 'flowchart LR\nA[Start] --> B[End]',
    'mindmap\n  root((Root label))\n    Child'].map(code => '```mermaid\n' + code + '\n```').join('\n\n');
  const diagrams = page.locator('.diagram svg:visible');
  const colors = () => diagrams.evaluateAll(items => items.map(svg => [...svg.querySelectorAll(
    'text, .messageLine0, .messageLine1, .actor, .label-container')].map(item => {
    const style = getComputedStyle(item);
    return [style.fill, style.stroke];
  })));
  await render(page, source, 'github', { theme: 'light' });
  await page.emulateMedia({ media: 'print' });
  await expect(diagrams).toHaveCount(3);
  const lightPrint = await colors();
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(markdown => window.mdv.render({ markdown, theme: 'dark' }), source);
  const darkScreen = await colors();
  expect(darkScreen).not.toEqual(lightPrint);
  await page.emulateMedia({ media: 'print' });
  await expect(diagrams).toHaveCount(3);
  expect(await colors()).toEqual(lightPrint);
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.emulateMedia({ media: 'screen' });
  await expect(diagrams).toHaveCount(3);
  expect(await colors()).toEqual(darkScreen);
});

test('Japanese headings, explicit HTML anchors and footnote return links work', async ({ page }) => {
  await render(page, '# 日本語\n\n[go](#日本語) and text[^one]\n\n<a id="custom"></a>\n\n[^one]: A note');
  expect(await page.evaluate(() => window.mdv.scrollToAnchor('日本語'))).toBe(true);
  expect(await page.evaluate(() => window.mdv.scrollToAnchor('custom'))).toBe(true);
  expect(await page.evaluate(() => window.mdv.scrollToAnchor('user-content-fn-one'))).toBe(true);
  expect(await page.evaluate(() => window.mdv.scrollToAnchor('user-content-fnref-one'))).toBe(true);
});

test('search finds code and text, cycles results, and clears when rerendering', async ({ page }) => {
  await render(page, '# Needle\n\nneedle\n\n```text\nneedle\n```');
  expect(await page.evaluate(() => window.mdv.find('needle'))).toMatchObject({ total: 3, index: 1 });
  expect(await page.evaluate(() => window.mdv.find('needle', 1))).toMatchObject({ index: 2 });
  expect(await page.evaluate(() => window.mdv.find('needle', -1))).toMatchObject({ index: 1 });
  expect(await page.evaluate(() => window.mdv.find(''))).toMatchObject({ total: 0 });
});

test('search reveals matches inside every enclosing collapsed details element', async ({ page }) => {
  await render(page, '<details><summary>Outer</summary><details><summary>Inner</summary><p>needle</p></details></details>');
  await expect(page.locator('#document p')).not.toBeVisible();
  expect(await page.evaluate(() => window.mdv.find('needle'))).toMatchObject({ total: 1, index: 1 });
  await expect(page.locator('#document p')).toBeVisible();
  expect(await page.locator('details').evaluateAll(items => items.map(item => item.open))).toEqual([true, true]);
});

test('copying pre blocks preserves source without including button labels', async ({ page }) => {
  await page.addInitScript(() => { window.messages = []; window.chrome = { webview: { postMessage: message => window.messages.push(message), addEventListener() {} } }; });
  const cases = [
    { markdown: '<pre>echo hello</pre>', expected: 'echo hello' },
    { markdown: '```yaml\n[one, two]\n```', expected: '[one, two]\n' },
    { markdown: '```yaml\ninvalid: [\n```', expected: 'invalid: [\n' },
    { markdown: '```text\necho hello\n```', expected: 'echo hello\n' },
  ];
  for (const { markdown, expected } of cases) {
    await render(page, markdown);
    const button = page.getByRole('button', { name: 'コピー', exact: true });
    await button.click();
    await page.getByRole('button', { name: 'コピーしました', exact: true }).click();
    expect(await page.evaluate(() => window.messages.filter(message => message.type === 'copy').map(message => message.text)))
      .toEqual([expected, expected]);
  }
});

test('invalid Mermaid falls back to its source with diagnostics', async ({ page }) => {
  const result = await render(page, '```mermaid\nnot-a-valid-diagram !@!@\n```');
  expect(result.diagnostics).toHaveLength(1);
  await expect(page.locator('pre.diagram-error')).toBeVisible();
});

test('Mermaid mindmap labels are centered inside their nodes', async ({ page }) => {
  for (const root of ['((Root label))', '(Root label)', '[Root label]', '((First line<br/>Second line))', '((日本語のルート))']) {
    const result = await render(page, '```mermaid\nmindmap\n  root' + root + '\n    child(Child label)\n    Plain child\n```');
    expect(result.diagnostics).toEqual([]);
    const nodes = await page.locator('.diagram svg:visible .mindmap-node').evaluateAll(nodes => nodes.map(node => {
      const shape = node.querySelector('circle, rect, path, polygon').getBoundingClientRect();
      const label = node.querySelector('.label, .mindmap-node-label').getBoundingClientRect();
      return { text: node.textContent, offset: label.x + label.width / 2 - shape.x - shape.width / 2,
        left: label.left - shape.left, right: shape.right - label.right };
    }));
    expect(nodes).toHaveLength(3);
    for (const node of nodes) {
      expect(Math.abs(node.offset), node.text).toBeLessThan(1);
      expect(node.left, node.text).toBeGreaterThanOrEqual(-1);
      expect(node.right, node.text).toBeGreaterThanOrEqual(-1);
    }
  }
});

test('search preserves Unicode offsets and treats punctuation as literal text', async ({ page }) => {
  await render(page, 'İİ needle (x+y) 日本語');
  expect(await page.evaluate(() => window.mdv.find('needle'))).toMatchObject({ total: 1 });
  expect(await page.evaluate(() => [...CSS.highlights.get('mdv-current')][0].toString())).toBe('needle');
  expect(await page.evaluate(() => window.mdv.find('(x+y)'))).toMatchObject({ total: 1 });
  expect(await page.evaluate(() => window.mdv.find('日本語'))).toMatchObject({ total: 1 });
});

test('relative images are mapped to the host, remote images require opt-in', async ({ page }) => {
  await page.route('https://document.mdv.invalid/**', route => route.fulfill({ path: 'samples/images/viewer.svg', contentType: 'image/svg+xml' }));
  await page.route('https://example.com/**', route => route.fulfill({ path: 'samples/images/viewer.svg', contentType: 'image/svg+xml' }));
  await render(page, '![local](images/viewer.svg)\n\n![remote](https://example.com/picture.png)');
  await expect(page.locator('img').first()).toHaveAttribute('src', 'https://document.mdv.invalid/image/images%2Fviewer.svg');
  await expect(page.locator('img').nth(1)).not.toHaveAttribute('src');
  await page.evaluate(() => window.mdv.render({ markdown: '![remote](https://example.com/picture.png)', mode: 'github', allowRemoteImages: true }));
  await expect(page.locator('img')).toHaveAttribute('src', 'https://example.com/picture.png');
});

test('HTTP images use the native image route only after opt-in on the HTTPS app origin', async ({ page }) => {
  await page.route('https://app.mdv.invalid/**', async route => {
    const response = await page.request.get('http://127.0.0.1:4179' + new URL(route.request().url()).pathname);
    await route.fulfill({ response });
  });
  const requested = [];
  page.on('request', request => { if (!request.url().startsWith('https://app.mdv.invalid/')) requested.push(request.url()); });
  await page.route('https://document.mdv.invalid/remote-image/**', route => route.fulfill({ path: 'samples/images/viewer.svg', contentType: 'image/svg+xml' }));
  await page.goto('https://app.mdv.invalid/');
  await page.waitForFunction(() => window.mdv);
  const urls = ['http://images.test/a.svg?x=1&name=a%20b', 'http://images.test/theme.svg'];
  const markdown = `![HTTP](${urls[0]})\n\n<picture><source srcset="${urls[1]}"><img src="${urls[0]}"></picture>`;
  await page.evaluate(markdown => window.mdv.render({ markdown }), markdown);
  await expect(page.locator('img')).toHaveCount(2);
  expect(requested).toEqual([]);
  await page.evaluate(markdown => window.mdv.render({ markdown, allowRemoteImages: true }), markdown);
  for (const img of await page.locator('img').all()) await expect(img).toHaveJSProperty('naturalWidth', 880);
  const mapped = urls.map(url => 'https://document.mdv.invalid/remote-image/' + encodeURIComponent(url));
  expect([...new Set(requested)].sort()).toEqual(mapped.sort());
  await expect(page.locator('img').first()).toHaveAttribute('src', mapped.find(url => url.includes('a.svg')));
  requested.length = 0;
  await page.evaluate(markdown => window.mdv.render({ markdown, allowRemoteImages: false }), markdown);
  for (const img of await page.locator('img').all()) await expect(img).not.toHaveAttribute('src');
  expect(requested).toEqual([]);
});

const longDocument = '# Start\n\n' + 'Opening paragraph.\n\n'.repeat(35) + '\n## 日本語の見出し\n\n' + 'Reading paragraph.\n\n'.repeat(65);

test('collapsed headings do not shift reading position when hidden content changes', async ({ page }) => {
  const source = '# Top\n\n' + 'line\n\n'.repeat(30)
    + '<details><summary>Collapsed</summary>\n\n## Hidden\n\nhello\n\n</details>\n\n'
    + 'line\n\n'.repeat(50);
  await render(page, source);
  const saved = await page.evaluate(() => { window.scrollTo(0, 1500); return window.mdv.captureView(); });
  expect(saved.anchor).toBe('mdv-heading-top');
  const changed = source.replace('## Hidden', 'hidden content\n\n'.repeat(50) + '## Hidden');
  await page.evaluate(({ markdown, view }) => window.mdv.render({ markdown, view }), { markdown: changed, view: saved });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(saved.y, 0);
  await expect(page.locator('details')).not.toHaveAttribute('open', '');
});

test('search scrolls to each matching text inside long code and paragraphs', async ({ page }) => {
  const sources = [
    '# Code\n\n```text\nneedle FIRST\n' + 'line filler\n'.repeat(150) + 'needle LAST\n```',
    'needle FIRST ' + 'filler text '.repeat(2500) + 'needle LAST',
    '```text\nneedle FIRST ' + 'filler '.repeat(500) + 'needle LAST\n```',
  ];
  for (const source of sources) {
    await render(page, source);
    for (const direction of [0, 1, -1]) {
      expect(await page.evaluate(direction => window.mdv.find('needle', direction), direction)).toMatchObject({ total: 2 });
      const bounds = await page.evaluate(() => {
        const rect = [...CSS.highlights.get('mdv-current')][0].getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: innerHeight, width: innerWidth };
      });
      expect(bounds.top).toBeGreaterThanOrEqual(0);
      expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(bounds.width);
    }
  }
});

test('picture sources resolve locally and blocked remote sources use the fallback', async ({ page }) => {
  const requests = [];
  page.on('request', request => { if (request.url().startsWith('https://')) requests.push(request.url()); });
  await page.route('https://document.mdv.invalid/**', route => route.fulfill({ path: 'samples/images/viewer.svg', contentType: 'image/svg+xml' }));
  const source = '<picture><source srcset="images/theme.svg 1x, images/large.svg 2x"><img src="images/fallback.svg"></picture>';
  await render(page, source);
  await expect(page.locator('img')).toHaveJSProperty('naturalWidth', 880);
  await expect(page.locator('img')).toHaveJSProperty('currentSrc', 'https://document.mdv.invalid/image/images%2Ftheme.svg');
  await expect(page.locator('source')).toHaveAttribute('srcset', 'https://document.mdv.invalid/image/images%2Ftheme.svg 1x, https://document.mdv.invalid/image/images%2Flarge.svg 2x');
  requests.length = 0;
  await render(page, '<picture><source srcset="https://example.com/tracker.svg"><img src="images/fallback.svg"></picture>');
  await expect(page.locator('img')).toHaveJSProperty('naturalWidth', 880);
  await expect(page.locator('img')).toHaveJSProperty('currentSrc', 'https://document.mdv.invalid/image/images%2Ffallback.svg');
  expect(requests.every(url => url.startsWith('https://document.mdv.invalid/'))).toBe(true);
  await page.route('https://example.com/**', route => route.fulfill({ path: 'samples/images/viewer.svg', contentType: 'image/svg+xml' }));
  await render(page, '<picture><source srcset="https://example.com/theme.svg"><img src="images/fallback.svg"></picture>', 'github', { allowRemoteImages: true });
  await expect(page.locator('img')).toHaveJSProperty('currentSrc', 'https://example.com/theme.svg');
  await expect(page.locator('img')).toHaveJSProperty('naturalWidth', 880);
});

test('picture candidates preserve data URL commas and fall back from invalid descriptors', async ({ page }) => {
  const image = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  await render(page, `<picture><source srcset="${image} 1x, images/large.gif 2x"><img src="images/fallback.svg"></picture>`);
  await expect(page.locator('img')).toHaveJSProperty('currentSrc', image);
  await expect(page.locator('img')).toHaveJSProperty('naturalWidth', 1);
  await page.route('https://document.mdv.invalid/**', route => route.fulfill({ path: 'samples/images/viewer.svg', contentType: 'image/svg+xml' }));
  await render(page, '<picture><source srcset="images/theme.svg invalid"><img src="images/fallback.svg"></picture>');
  await expect(page.locator('source')).toHaveCount(0);
  await expect(page.locator('img')).toHaveJSProperty('currentSrc', 'https://document.mdv.invalid/image/images%2Ffallback.svg');
  await expect(page.locator('img')).toHaveJSProperty('naturalWidth', 880);
});

test('HTML heading links work with explicit IDs and generated anchors', async ({ page }) => {
  for (const mode of ['github', 'qiita']) {
    await render(page, '[jump](#custom)\n\n' + 'text\n\n'.repeat(40) + '<h2 id="custom">Title</h2>\n\n' + 'after\n\n'.repeat(40), mode);
    await page.getByRole('link', { name: 'jump', exact: true }).click();
    await expect.poll(() => page.locator('h2').evaluate(item => Math.abs(item.getBoundingClientRect().top))).toBeLessThan(50);
    expect(await page.evaluate(() => window.mdv.scrollToAnchor('title'))).toBe(true);
    expect(await page.evaluate(() => window.mdv.scrollToAnchor(window.mdv.outline[0].id))).toBe(true);
  }
});

test('HTML anchors and headings with formerly colliding IDs remain independently reachable', async ({ page }) => {
  const source = '[Heading](#target) [HTML anchor](#heading-target)\n\n<a id="heading-target"></a>\n\n'
    + 'text\n\n'.repeat(60) + '## Target\n\n' + 'after\n\n'.repeat(40);
  for (const mode of ['github', 'qiita']) {
    await render(page, source, mode);
    const ids = await page.locator('#document [id]').evaluateAll(items => items.map(item => item.id));
    expect(new Set(ids).size).toBe(ids.length);
    await page.evaluate(() => window.mdv.scrollToAnchor(window.mdv.outline[0].id));
    await expect.poll(() => page.locator('h2').evaluate(item => item.getBoundingClientRect().top)).toBeCloseTo(28, 0);
    await page.getByRole('link', { name: 'Heading', exact: true }).click();
    await expect.poll(() => page.locator('h2').evaluate(item => item.getBoundingClientRect().top)).toBeCloseTo(28, 0);
    await page.getByRole('link', { name: 'HTML anchor', exact: true }).click();
    await expect.poll(() => page.locator('#document a[id]').evaluate(item => item.getBoundingClientRect().top)).toBeCloseTo(28, 0);
  }
});

test('reading position survives navigation, diagram rendering and content inserted above its heading', async ({ page }) => {
  const source = '```mermaid\nflowchart LR\n A --> B\n```\n\n' + longDocument;
  await render(page, source);
  const saved = await page.evaluate(() => {
    window.mdv.scrollToAnchor('日本語の見出し'); window.scrollBy(0, 180);
    return window.mdv.captureView();
  });
  expect(saved.y).toBeGreaterThan(500);
  await page.evaluate(() => window.mdv.render({ markdown: '# Other', resetScroll: true }));
  await page.evaluate(({ source, saved }) => window.mdv.render({ markdown: source, resetScroll: true, view: saved }), { source, saved });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(saved.y, 0);
  await page.evaluate(({ source, saved }) => window.mdv.render({ markdown: 'New material.\n\n'.repeat(10) + source, view: saved }), { source, saved });
  await expect.poll(() => page.evaluate(() => window.mdv.captureView().offset)).toBeCloseTo(saved.offset, 0);
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(saved.y + 100);
});

test('restoration preserves open details and does not undo a reader scroll or a search', async ({ page }) => {
  const source = '# Top\n\n<details><summary>Expand</summary>\n\n' + 'Inside details.\n\n'.repeat(60) + '\n</details>\n\n' + longDocument;
  await render(page, source);
  await page.locator('summary').click();
  const saved = await page.evaluate(() => { window.scrollTo(0, 900); return window.mdv.captureView(); });
  expect(saved.openDetails).toEqual([0]);
  await page.evaluate(({ source, saved }) => window.mdv.render({ markdown: source, view: saved }), { source, saved });
  await expect(page.locator('details')).toHaveAttribute('open', '');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(saved.y, 0);
  await page.mouse.move(700, 400); await page.mouse.wheel(0, 350);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(saved.y + 200);
  const moved = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => document.querySelector('#document').style.paddingBottom = '500px');
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(moved, 0);
  await page.evaluate(() => window.mdv.find('Opening'));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(moved);
});

test('new documents preserve default-open details and history preserves a reader collapse', async ({ page }) => {
  const source = '# Top\n\n<details open><summary>Expanded by author</summary>\n\nContent.\n\n</details>';
  await render(page, source, 'github', { resetScroll: true });
  await expect(page.locator('details')).toHaveAttribute('open', '');
  expect(await page.evaluate(() => window.mdv.captureView().openDetails)).toEqual([0]);
  await page.locator('summary').click();
  const saved = await page.evaluate(() => window.mdv.captureView());
  await page.evaluate(() => window.mdv.render({ markdown: '# Other', resetScroll: true }));
  await page.evaluate(({ source, saved }) => window.mdv.render({ markdown: source, view: saved }), { source, saved });
  await expect(page.locator('details')).not.toHaveAttribute('open', '');
});

test('late image layout keeps the saved heading at the same viewport position', async ({ page }) => {
  await render(page, longDocument);
  const saved = await page.evaluate(() => { window.mdv.scrollToAnchor('日本語の見出し'); window.scrollBy(0, 130); return window.mdv.captureView(); });
  await page.evaluate(({ source, saved }) => window.mdv.render({ markdown: source, view: saved }), { source: longDocument, saved });
  await page.evaluate(() => {
    const image = document.createElement('img'); image.alt = 'Late image';
    image.style.cssText = 'display:block; width:200px; height:400px';
    document.querySelector('#document').prepend(image);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(saved.y + 390);
  await expect.poll(() => page.evaluate(() => -document.getElementById(window.mdv.captureView().anchor).getBoundingClientRect().top)).toBeCloseTo(saved.offset, 0);
});

test('Alt arrows are forwarded to native navigation and a restored search does not move the viewport', async ({ page }) => {
  await page.addInitScript(() => { window.messages = []; window.chrome = { webview: { postMessage: message => window.messages.push(message), addEventListener() {} } }; });
  await render(page, longDocument);
  await page.keyboard.press('Alt+ArrowLeft'); await page.keyboard.press('Alt+ArrowRight');
  expect(await page.evaluate(() => window.messages.filter(message => message.type === 'shortcut').map(message => message.key))).toEqual(['back', 'forward']);
  const y = await page.evaluate(() => { window.scrollTo(0, 1000); window.mdv.find('Reading', 0, false); return window.scrollY; });
  expect(y).toBeCloseTo(1000, 0);
});

test('ordinary links navigate in place; Ctrl and middle clicks request another tab', async ({ page }) => {
  await page.addInitScript(() => { window.messages = []; window.chrome = { webview: { postMessage: message => window.messages.push(message), addEventListener() {} } }; });
  await render(page, '# Top\n\n[Other](next.md#section)\n\n[Here](#top)');
  await page.getByRole('link', { name: 'Other' }).click();
  await page.getByRole('link', { name: 'Other' }).click({ modifiers: ['Control'] });
  await page.getByRole('link', { name: 'Other' }).click({ button: 'middle' });
  await page.getByRole('link', { name: 'Here' }).click();
  expect(await page.evaluate(() => window.messages.filter(message => message.type === 'openLink'))).toEqual([
    { type: 'openLink', href: 'next.md#section', newTab: false, requestId: 1 },
    { type: 'openLink', href: 'next.md#section', newTab: true, requestId: 1 },
    { type: 'openLink', href: 'next.md#section', newTab: true, requestId: 1 },
  ]);
});

test('tab shortcuts reach the native host while the preview has focus', async ({ page }) => {
  await page.addInitScript(() => { window.messages = []; window.chrome = { webview: { postMessage: message => window.messages.push(message), addEventListener() {} } }; });
  await render(page, '# Keyboard');
  for (const key of ['Control+t', 'Control+Tab', 'Control+Shift+Tab', 'Control+w']) await page.keyboard.press(key);
  expect(await page.evaluate(() => window.messages.filter(message => message.type === 'shortcut').map(message => message.key)))
    .toEqual(['newTab', 'nextTab', 'previousTab', 'closeTab']);
});
