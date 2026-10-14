import { test, expect } from '@playwright/test';

async function start(page, markdown, options = {}) {
  await page.goto('/');
  await page.waitForFunction(() => window.mdv);
  return render(page, markdown, options);
}
const render = (page, markdown, options = {}) => page.evaluate(options => window.mdv.render(options), { markdown, resetScroll: true, ...options });
const fence = code => '```mermaid\n' + code + '\n```';

test('all mindmap shapes retain their labels in classic and hand-drawn layouts', async ({ page }) => {
  test.setTimeout(60000);
  await start(page, '');
  for (const look of ['classic', 'handDrawn']) {
    for (const theme of ['light', 'dark']) {
      const result = await render(page, fence(`---\nconfig:\n  look: ${look}\n---\nmindmap\nroot((Root label))\n  A[Square label]\n  B(Rounded label)\n  C((Circle label))\n  D))Bang label((\n  E)Cloud label(\n  F{{Hexagon label}}\n  Plain child`), { theme });
      expect(result.diagnostics).toEqual([]);
      for (const media of ['screen', 'print']) {
        await page.emulateMedia({ media });
        const nodes = await page.locator('.diagram svg:visible .mindmap-node').evaluateAll(nodes => nodes.map(node => {
          const shape = node.querySelector(':scope > .label-container, :scope > rect, :scope > polygon, :scope > path, :scope > g');
          const label = node.querySelector(':scope > .label');
          const a = shape.getBoundingClientRect(), b = label.getBoundingClientRect();
          return { text: label.textContent, left: b.left - a.left, right: a.right - b.right };
        }));
        expect(nodes).toHaveLength(8);
        for (const node of nodes) {
          expect(node.left, `${look}/${theme}/${media}: ${node.text}`).toBeGreaterThanOrEqual(-2);
          expect(node.right, `${look}/${theme}/${media}: ${node.text}`).toBeGreaterThanOrEqual(-2);
        }
      }
    }
  }
});

test('journey section labels contrast with their backgrounds on screen and print', async ({ page }) => {
  await start(page, '');
  for (const theme of ['light', 'dark']) {
    const result = await render(page, fence('journey\ntitle Reading\nsection Review\nOpen: 5: Reader\nsection Export\nSave: 4: Reader'), { theme });
    expect(result.diagnostics).toEqual([]);
    for (const media of ['screen', 'print']) {
      await page.emulateMedia({ media });
      const labels = await page.locator('.diagram svg:visible text.journey-section').evaluateAll(items => items.map(item => ({
        text: item.textContent, fill: getComputedStyle(item).fill,
        background: getComputedStyle(item.closest('g').querySelector('rect')).fill,
        width: item.getBoundingClientRect().width,
      })));
      expect(labels.map(label => label.text)).toEqual(['Review', 'Export']);
      for (const label of labels) {
        expect(label.width).toBeGreaterThan(0);
        expect(label.fill).not.toBe(label.background);
      }
    }
  }
});

test('sequence math remains visible while foreign HTML and active content stay excluded', async ({ page }) => {
  const requests = [];
  page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:4179')) requests.push(r.url()); });
  const result = await start(page, fence('sequenceDiagram\nA->>B: $$x^2$$\nB-->>A: Plain'), { theme: 'dark' });
  expect(result.diagnostics).toEqual([]);
  for (const media of ['screen', 'print']) {
    await page.emulateMedia({ media });
    const math = page.locator('.diagram svg:visible foreignObject math');
    await expect(math).toHaveCount(1);
    await expect(math).toBeVisible();
    await expect(math.locator('mi')).toHaveText('x');
    await expect(math.locator('mn')).toHaveText('2');
    expect((await math.boundingBox()).width).toBeGreaterThan(0);
  }
  await expect(page.locator('.diagram foreignObject div, .diagram script, .diagram a, .diagram image')).toHaveCount(0);
  expect(requests).toEqual([]);
});

test('authored Mermaid themes cannot override the light print variant', async ({ page }) => {
  await start(page, '');
  const code = 'sequenceDiagram\nA->>B: Message';
  await render(page, fence(code));
  await page.emulateMedia({ media: 'print' });
  const lightFill = await page.locator('.diagram svg:visible .messageText').evaluate(t => getComputedStyle(t).fill);
  for (const theme of ['light', 'dark']) {
    for (const config of ['%%{init: {"theme":"dark"}}%%\n', '---\nconfig:\n  theme: dark\n  themeVariables:\n    signalTextColor: "#eeeeee"\n---\n']) {
      await render(page, fence(config + code), { theme });
      await page.emulateMedia({ media: 'screen' });
      const screenFill = await page.locator('.diagram svg:visible .messageText').evaluate(t => getComputedStyle(t).fill);
      expect(screenFill).not.toBe(lightFill);
      await page.emulateMedia({ media: 'print' });
      expect(await page.locator('.diagram svg:visible .messageText').evaluate(t => getComputedStyle(t).fill)).toBe(lightFill);
    }
  }
});

test('Mermaid math support still excludes authored HTML, links and security overrides', async ({ page }) => {
  const requests = [];
  await page.route('https://evil.test/**', route => { requests.push(route.request().url()); return route.fulfill({ body: '' }); });
  const source = fence('sequenceDiagram\nA->>B: $$x^2$$\nB-->>A: $$\\href{https://evil.test/math}{x}$$') + '\n\n'
    + fence('%%{init: {"securityLevel":"loose", "htmlLabels":true, "flowchart":{"htmlLabels":true}}}%%\nflowchart LR\nA["<b>Safe</b><img src=\'https://evil.test/tracker\' onerror=\'window.pwned=true\'>"] --> B[Plain]\nclick B href "https://evil.test/link"');
  await start(page, source);
  await expect(page.locator('.diagram-screen math').first()).toBeVisible();
  await expect(page.locator('.diagram a, .diagram image, .diagram img, .diagram script, .diagram [onerror], .diagram foreignObject div')).toHaveCount(0);
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
  expect(requests).toEqual([]);
});

test('nested scroll positions survive navigation and theme changes without moving another block', async ({ page }) => {
  const code = '```text\n' + 'Long code '.repeat(300) + '\n```';
  const table = '| ' + Array.from({ length: 25 }, (_, i) => i ? 'Column' + i : '`Key`').join(' | ') + ' |\n| ' + '--- | '.repeat(25) + '\n| ' + 'Value | '.repeat(25);
  const source = code + '\n\n' + table;
  await start(page, source);
  await page.mouse.click(10, 10);
  const saved = await page.evaluate(() => {
    document.querySelector('pre').scrollLeft = 500;
    document.querySelector('table').scrollLeft = 350;
    return window.mdv.captureView();
  });
  await render(page, '# Other');
  await render(page, '```text\nInserted\n```\n\n| `Key` | New |\n| --- | --- |\n| row | value |\n\n' + source, { theme: 'dark', view: saved });
  await expect(page.locator('pre').first()).toHaveJSProperty('scrollLeft', 0);
  await expect(page.locator('pre').nth(1)).toHaveJSProperty('scrollLeft', 500);
  await expect(page.locator('table').first()).toHaveJSProperty('scrollLeft', 0);
  await expect(page.locator('table').nth(1)).toHaveJSProperty('scrollLeft', 350);
});

test('details retain identity across insertion, reordering and body edits', async ({ page }) => {
  const detail = (name, body = 'Body', open = false) => `<details${open ? ' open' : ''}><summary>${name}</summary>${body}</details>`;
  await start(page, detail('A') + '\n\n' + detail('B'));
  await page.getByText('B', { exact: true }).click();
  const saved = await page.evaluate(() => window.mdv.captureView());
  await render(page, detail('New', 'New content', true) + '\n\n' + detail('B', 'Updated content') + '\n\n' + detail('A'), { view: saved });
  expect(await page.locator('details').evaluateAll(items => items.map(item => [item.querySelector('summary').textContent, item.open])))
    .toEqual([['New', true], ['B', true], ['A', false]]);
});

test('Qiita numbered and duplicate headings are independently reachable', async ({ page }) => {
  const source = ['Example', 'Example-1', 'Example'].map(title => '# ' + title + '\n\n' + 'Paragraph\n\n'.repeat(30)).join('\n\n');
  await start(page, source, { mode: 'qiita' });
  const outline = await page.evaluate(() => window.mdv.outline);
  expect(new Set(outline.map(h => h.id)).size).toBe(3);
  for (const [i, heading] of outline.entries()) {
    await page.evaluate(anchor => window.mdv.scrollToAnchor(anchor), heading.anchor);
    await expect.poll(() => page.locator('h1').nth(i).evaluate(h => h.getBoundingClientRect().top)).toBeCloseTo(28, 0);
  }
});

test('image proxies trim HTML whitespace and preserve SVG fragments outside the encoded path', async ({ page }) => {
  const requests = [];
  await page.route('https://document.mdv.invalid/**', route => {
    requests.push(route.request().url());
    return route.fulfill({ body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><view id="blue" viewBox="0 0 100 100"/><rect width="100" height="100" fill="blue"/></svg>', contentType: 'image/svg+xml' });
  });
  await start(page, '<img src=" images/test.svg#blue ">\n\n![Remote](http://images.test/test.svg#blue)', { allowRemoteImages: true });
  const images = page.locator('#document img');
  await expect(images.nth(0)).toHaveAttribute('src', 'https://document.mdv.invalid/image/images%2Ftest.svg#blue');
  await expect(images.nth(1)).toHaveAttribute('src', 'https://document.mdv.invalid/remote-image/http%3A%2F%2Fimages.test%2Ftest.svg#blue');
  for (const image of await images.all()) await expect(image).toHaveJSProperty('naturalWidth', 100);
  expect(requests).toHaveLength(2);
  expect(requests.every(url => !url.includes('%23') && !url.includes('%20'))).toBe(true);
});
