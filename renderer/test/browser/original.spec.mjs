import { test, expect } from '@playwright/test';
import { OriginalEngine } from '../../../scripts/upstream/client.mjs';

test.describe('original engine in application renderer', () => {
  test.skip(!process.env.MDV_RUBY, 'Set MDV_RUBY after upstream:setup to test the real workers');
  let engines;
  test.beforeAll(async () => { engines = {}; for (const mode of ['github', 'qiita']) engines[mode] = await OriginalEngine.start(mode, { desktop: true }); });
  test.afterAll(() => { for (const engine of Object.values(engines || {})) engine.close(); });
  async function render(page, mode, markdown, extra = {}) {
    const original = { ...await engines[mode].render(markdown), metadata: engines[mode].metadata };
    return page.evaluate(options => window.mdv.render(options), { engine: 'original', mode, original, requestId: 1, ...extra });
  }
  for (const mode of ['github', 'qiita']) test(`${mode}: diagrams, math, navigation, search, images, print and fallback`, async ({ page }) => {
    const external = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://document.mdv.invalid/image/**', route => route.fulfill({ path:'samples/images/viewer.svg', contentType:'image/svg+xml' }));
    await page.route('https://outside.invalid/**', route => { external.push(route.request().url()); return route.abort(); });
    await page.goto('/'); await page.waitForFunction(()=>window.mdv);
    const source = '# 日本語\n\n[Jump](#deep)\n\n<details><summary>Hidden</summary><a name="deep"></a>Needle</details>\n\n' +
      '<script>window.pwned=true</script>\n\n![local](images/viewer.svg)\n\n![remote](https://outside.invalid/a.png)\n\n```mermaid\nflowchart LR\n A[Label] --> B[End]\n```\n\n$x^2$\n\n```ruby:sample.rb\nputs 1\n```';
    const result = await render(page, mode, source, {theme:'dark'});
    expect(result.diagnostics).toEqual([]); expect(result.outline[0].text).toBe('日本語');
    await expect(page.locator('#document')).toHaveClass(new RegExp('original-body'));
    await expect(page.locator('.diagram-screen .nodeLabel').first()).toHaveText('Label');
    await expect(page.locator('mjx-container')).toHaveCount(1);
    await expect(page.locator('img').first()).toHaveJSProperty('naturalWidth',880);
    expect(external).toEqual([]);
    expect(await page.evaluate(() => window.pwned)).toBeUndefined();
    await page.locator('a').filter({hasText:'Jump'}).click();
    await expect(page.locator('details')).toHaveAttribute('open','');
    expect(await page.evaluate(()=>window.mdv.find('Needle').total)).toBe(1);
    expect(await page.evaluate(()=>window.mdv.scrollToAnchor('日本語'))).toBe(true);
    const view = await page.evaluate(()=>window.mdv.captureView());
    await render(page, mode, source, {theme:'light',view,requestId:2});
    await expect(page.locator('details')).toHaveAttribute('open','');
    await page.emulateMedia({media:'print'});
    await expect(page.locator('.diagram-print')).toBeVisible(); await expect(page.locator('.diagram-screen')).toBeHidden();
    await expect(page.locator('.copy-code').first()).toBeHidden();
    await page.emulateMedia({media:'screen'});
    await page.evaluate(()=>window.mdv.render({engine:'legacy',mode:'github',markdown:'# Legacy\n\n**Back**',requestId:3}));
    await expect(page.locator('#document')).not.toHaveClass(/original-body/);
    await expect(page.locator('strong')).toHaveText('Back');
    await expect(page.locator('#original-styles')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
  test('Qiita reload preserves the reading anchor when sanitization removes an earlier ID', async ({page}) => {
    await page.goto('/'); await page.waitForFunction(() => window.mdv);
    const paragraphs = 'Paragraph for scrolling.\n\n'.repeat(70);
    const body = `\n\n${paragraphs}## Reading position\n\n${paragraphs}`;
    // "after" is a DOM property: DOMPurify removes that ID, while "reloaded" survives.
    await render(page, 'qiita', '# After' + body);
    await expect(page.locator('h1 a')).toHaveCount(1);
    await page.evaluate(() => { window.mdv.scrollToAnchor('reading-position'); window.scrollBy(0,150); });
    const before = await page.evaluate(() => ({y:scrollY,view:window.mdv.captureView()}));
    expect(before.view.anchor).toBeTruthy();
    await render(page, 'qiita', '# Reloaded' + body, {view:before.view,requestId:2});
    expect(Math.abs(await page.evaluate(() => scrollY) - before.y)).toBeLessThan(3);
    expect(await page.evaluate(() => window.mdv.scrollToAnchor('reading-position'))).toBe(true);
  });
  test('host reports conversion failure and can recover with the legacy engine', async ({page})=>{
    await page.addInitScript(()=>{window.messages=[];window.chrome={webview:{postMessage:m=>window.messages.push(m),addEventListener:(_,fn)=>{window.deliver=fn;}}};});
    await page.goto('/');await page.waitForFunction(()=>window.deliver);
    await page.evaluate(()=>window.deliver({data:{type:'render',requestId:4,failure:'Runtime missing'}}));
    await expect(page.locator('#document')).toContainText('Runtime missing');
    expect(await page.evaluate(()=>window.messages.at(-1).type)).toBe('error');
    await page.evaluate(()=>window.deliver({data:{type:'render',requestId:5,engine:'legacy',mode:'github',markdown:'# Recovered'}}));
    await expect(page.locator('h1')).toHaveText('Recovered');
  });
});
