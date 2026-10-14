import { test, expect } from '@playwright/test';

for (const engine of ['legacy', 'original']) for (const mode of ['github', 'qiita']) {
  test(`${engine} ${mode} switches preview controls and accessibility text between English and Japanese`, async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.mdv);
    const markdown = '# 日本語の本文\n\n```js\nconst example = 1;\n```\n\ntext[^a]\n\n[^a]: footnote';
    for (const language of ['en', 'ja', 'en']) {
      await page.evaluate(options => window.mdv.render(options), { markdown, mode, language, engine,
        original: { metadata: { mode }, html: '<h1>日本語の本文</h1><pre><code>const example = 1;</code></pre>' } });
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(page.getByRole('main')).toHaveAttribute('aria-label', language === 'ja' ? 'Markdownプレビュー' : 'Markdown preview');
      await expect(page.getByRole('button', { name: language === 'ja' ? 'コピー' : 'Copy', exact: true })).toBeVisible();
      await expect(page.locator('h1')).toContainText('日本語の本文');
      await expect(page.locator('h1 a')).toHaveAttribute('aria-label', new RegExp(language === 'ja' ? '見出しへのリンク' : 'Link to heading'));
    }
  });
}

test('preview defaults to English in a non-Japanese browser environment', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.mdv);
  await page.evaluate(() => window.mdv.render({ markdown: '# Hello', mode: 'github' }));
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('automatic preview language follows Japanese navigator language', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'language', { value: 'ja-JP' }));
  await page.goto('/');
  await page.waitForFunction(() => window.mdv);
  await page.evaluate(() => window.mdv.render({ markdown: '# Hello', mode: 'github', language: 'auto' }));
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
});
