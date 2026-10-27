import {test, expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {OriginalEngine} from '../../../scripts/upstream/client.mjs';

// Captured independently from GitHub's Markdown API, not from either engine.
// The API identifies math spans; glyph/layout parity is tested separately.
const capture = JSON.parse(await readFile('tests/compatibility/github-math-api.json', 'utf8'));
let worker;
test.beforeAll(async () => {
  if (process.env.MDV_RUBY) worker = await OriginalEngine.start('github', {desktop:true});
});
test.afterAll(() => worker?.close());

for (const engine of ['legacy', 'original']) for (const fixture of capture.cases) {
  test(`${engine}: GitHub API recognition: ${fixture.id}`, async ({page}) => {
    test.skip(engine === 'original' && !process.env.MDV_RUBY, 'Set MDV_RUBY to run the upstream engine');
    await page.goto('/');
    await page.waitForFunction(() => window.mdv);
    const expected = await page.evaluate(html => {
      const template = document.createElement('template'); template.innerHTML = html;
      return [...template.content.querySelectorAll('math-renderer')].map(node => node.classList.contains('js-display-math'));
    }, fixture.html);
    const original = engine === 'original' ? {...await worker.render(fixture.markdown), metadata:worker.metadata} : undefined;
    const result = await page.evaluate(options => window.mdv.render(options), {engine, mode:'github', markdown:fixture.markdown, original});
    expect(result.diagnostics).toEqual([]);
    const math = page.locator('#document mjx-container[jax="SVG"]');
    await expect(math).toHaveCount(expected.length);
    expect(await math.evaluateAll(nodes => nodes.map(node => node.getAttribute('display') === 'true'))).toEqual(expected);
    await expect(page.locator('a mjx-container, pre mjx-container, code mjx-container')).toHaveCount(0);
    if (fixture.id === 'emphasis') await expect(page.locator('#document em')).toHaveText('b');
    if (fixture.id === 'html-bold') await expect(page.locator('#document b')).toHaveText('c');
    if (fixture.id === 'html-span') await expect(page.locator('#document p > span')).toHaveText('b');
    if (fixture.id === 'hard-break') await expect(page.locator('#document br')).toHaveCount(1);
  });
}
