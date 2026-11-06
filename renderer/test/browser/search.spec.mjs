import { test, expect } from '@playwright/test';

async function render(page, markdown, mode = 'github') {
  await page.goto('/');
  await page.waitForFunction(() => window.mdv);
  await page.evaluate(options => window.mdv.render(options), { markdown, mode, language: 'ja', requestId: 1 });
}

async function find(page, query, direction = 0, scroll = true) {
  return page.evaluate(({ query, direction, scroll }) => {
    const result = window.mdv.find(query, direction, scroll);
    return { ...result, matches: [...CSS.highlights.get('mdv-search')].map(range => range.toString()),
      current: [...CSS.highlights.get('mdv-current')].map(range => range.toString()) };
  }, { query, direction, scroll });
}

for (const mode of ['github', 'qiita']) {
  test(`${mode} search spans emphasis, links and inline code with original Unicode offsets`, async ({ page }) => {
    await render(page, 'İİ😀 これは**重要**です。\n\nSee [the docs](https://example.test) now.\n\nUse `x+y` safely.\n\n🧑**🏽‍💻**の説明', mode);
    for (const query of ['重要です', 'See the docs now.', 'Use x+y safely.', '🧑🏽‍💻の説明']) {
      expect(await find(page, query)).toMatchObject({ total: 1, index: 1, matches: [query], current: [query] });
    }
  });

  test(`${mode} search spans syntax highlighting tokens and cycles whole matches`, async ({ page }) => {
    await render(page, '```javascript\nconst answer = 42;\nconst answer = 42;\n```', mode);
    expect(await page.locator('pre span').count()).toBeGreaterThan(1);
    const query = 'const answer = 42;';
    expect(await find(page, query)).toMatchObject({ total: 2, index: 1, matches: [query, query], current: [query] });
    expect(await find(page, query, 1)).toMatchObject({ total: 2, index: 2, current: [query] });
    expect(await find(page, query, -1)).toMatchObject({ total: 2, index: 1, current: [query] });
  });
}

test('search never joins separate blocks, cells, list items or explicit line breaks', async ({ page }) => {
  const cases = [
    '<p>left</p><p>right</p>',
    '<table><tbody><tr><td>left</td><td>right</td></tr></tbody></table>',
    '<ul><li>left</li><li>right</li></ul>',
    '<h2>left</h2><p>right</p>',
    '<div>left<div></div>right</div>',
    '<div>left<p>middle</p>right</div>',
    '<details><summary>left</summary>right</details>',
    '<p>left<br>right</p>',
  ];
  for (const markdown of cases) {
    await render(page, markdown);
    expect(await find(page, 'leftright'), markdown).toMatchObject({ total: 0 });
  }
});

test('excluded UI and diagrams form boundaries instead of joining surrounding text', async ({ page }) => {
  await render(page, '# Search');
  for (const html of [
    '<p>left<button>hidden</button>right</p>',
    '<p>left<clipboard-copy>hidden</clipboard-copy>right</p>',
    '<p>left<svg><text>hidden</text></svg>right</p>',
    '<p>left<math><mtext>hidden</mtext></math>right</p>',
    '<p>left<span class="katex-mathml">hidden</span>right</p>',
  ]) {
    await page.locator('#document').evaluate((article, html) => { article.innerHTML = html; }, html);
    expect(await find(page, 'leftright'), html).toMatchObject({ total: 0 });
    expect(await find(page, 'hidden'), html).toMatchObject({ total: 0 });
  }
});

test('search reveals a cross-node match inside nested collapsed details', async ({ page }) => {
  await render(page, '<details><summary>Outer</summary><details><summary>Inner</summary><p>the <strong>hidden</strong> phrase</p></details></details>');
  await expect(page.locator('#document p')).not.toBeVisible();
  expect(await find(page, 'the hidden phrase')).toMatchObject({ total: 1, current: ['the hidden phrase'] });
  await expect(page.locator('#document p')).toBeVisible();
  expect(await page.locator('details').evaluateAll(items => items.map(item => item.open))).toEqual([true, true]);
});

test('cross-node search honors the result limit and clears all ranges', async ({ page }) => {
  await render(page, '<p>' + '<b>x</b>y '.repeat(10_010) + '</p>');
  const result = await find(page, 'xy', 0, false);
  expect(result.total).toBe(10_000);
  expect(result.matches.every(match => match === 'xy')).toBe(true);
  expect(await find(page, 'xy', -1, false)).toMatchObject({ total: 10_000, index: 10_000 });
  expect(await find(page, '')).toMatchObject({ total: 0, index: 0, matches: [], current: [] });
});

test('cross-node search preserves scroll when requested and otherwise reveals the full match', async ({ page }) => {
  await render(page, '# Top\n\n' + 'filler paragraph\n\n'.repeat(100) + 'the **last** phrase\n\n' + 'filler paragraph\n\n'.repeat(30));
  await page.evaluate(() => window.scrollTo(0, 400));
  const before = await page.evaluate(() => window.scrollY);
  expect(await find(page, 'the last phrase', 0, false)).toMatchObject({ total: 1 });
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  await find(page, 'the last phrase', 1);
  const bounds = await page.evaluate(() => {
    const rect = [...CSS.highlights.get('mdv-current')][0].getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, height: innerHeight };
  });
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.height);
});
