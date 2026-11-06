import { test, expect } from '@playwright/test';

for (const engine of ['legacy', 'original']) for (const mode of ['github', 'qiita']) {
  test(`${engine}/${mode}: link hover reports destinations and clears them on leave and render`, async ({ page }) => {
    await page.addInitScript(() => {
      window.messages = [];
      window.chrome = { webview: { postMessage: message => window.messages.push(message), addEventListener() {} } };
    });
    await page.goto('/');
    await page.waitForFunction(() => window.mdv);
    const html = '<p><a href="https://example.com/path?q=1&amp;lang=ja"><strong>External</strong> <em>link</em></a></p>' +
      '<p><a href="docs/guide.md#intro">Relative</a></p><p><a href="#intro">Fragment</a></p>' +
      '<p><a href="mailto:reader@example.com">Mail</a></p><p>Plain text</p>';
    const options = { engine, mode, markdown: html, original: { html, metadata: { mode } }, requestId: 11 };
    await page.evaluate(options => window.mdv.render(options), options);
    const lastHover = () => page.evaluate(() => window.messages.filter(message => message.type === 'hoverLink').at(-1));

    await page.locator('a strong').hover();
    await expect.poll(lastHover).toEqual({ type: 'hoverLink', href: 'https://example.com/path?q=1&lang=ja', requestId: 11 });
    const count = await page.evaluate(() => window.messages.length);
    await page.locator('a em').hover();
    expect(await page.evaluate(() => window.messages.length)).toBe(count);
    for (const [name, href] of [['Relative', 'docs/guide.md#intro'], ['Fragment', '#intro'], ['Mail', 'mailto:reader@example.com']]) {
      await page.getByRole('link', { name, exact: true }).hover();
      await expect.poll(lastHover).toEqual({ type: 'hoverLink', href, requestId: 11 });
    }
    await page.getByText('Plain text', { exact: true }).hover();
    await expect.poll(lastHover).toEqual({ type: 'hoverLink', href: '', requestId: 11 });
    await page.getByRole('link', { name: 'Relative', exact: true }).hover();
    await page.mouse.move(0, 0);
    await expect.poll(lastHover).toEqual({ type: 'hoverLink', href: '', requestId: 11 });

    await page.locator('a strong').hover();
    await page.evaluate(options => window.mdv.render(options), { ...options, requestId: 12 });
    await expect.poll(lastHover).toEqual({ type: 'hoverLink', href: 'https://example.com/path?q=1&lang=ja', requestId: 12 });
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect.poll(lastHover).toEqual({ type: 'hoverLink', href: '', requestId: 12 });
    await page.getByRole('link', { name: 'Relative', exact: true }).hover();
    await page.evaluate(options => window.mdv.render(options), {
      ...options, markdown: '', original: { html: '', metadata: { mode } }, requestId: 13,
    });
    await expect.poll(lastHover).toMatchObject({ type: 'hoverLink', href: '' });
    expect(await page.evaluate(() => window.messages.some(message => message.type === 'openLink'))).toBe(false);
  });
}
