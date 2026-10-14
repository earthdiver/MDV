import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const linkSvg = await readFile('node_modules/@primer/octicons/build/svg/link-16.svg', 'utf8');
async function render(page, markdown) {
  await page.goto('/'); await page.waitForFunction(() => window.mdv);
  await page.evaluate(markdown => window.mdv.render({mode:'github',markdown}), markdown);
}
test('official heading icon, Primer typography and theme tokens are used without the old styles', async ({page}) => {
  await render(page, '# Heading\n\n```js\nconst n = 1;\n```\n\n> [!NOTE]\n> Note');
  const icon = page.locator('h1 .octicon-link');
  expect(await icon.locator('path').getAttribute('d')).toBe(linkSvg.match(/d="([^"]+)"/)[1]);
  const anchor=page.locator('h1 .anchor');
  await expect(anchor).toHaveCSS('opacity','0');
  await page.locator('h1').hover(); await expect(anchor).toHaveCSS('opacity','1');await expect(icon).toHaveCSS('visibility','visible');
  await page.mouse.move(0,0); await anchor.focus(); await expect(anchor).toHaveCSS('opacity','1');await expect(icon).toHaveCSS('visibility','visible');
  await expect(page.locator('.markdown-alert-title .octicon-info')).toHaveCount(1);
  expect(await page.evaluate(() => ['github-primer','github-host'].map(id => document.getElementById(id).disabled))).toEqual([false,false]);
  await page.evaluate(() => document.documentElement.style.setProperty('--prettylights-syntax-keyword','#010203'));
  await expect(page.locator('.hljs-keyword')).toHaveCSS('color','rgb(1, 2, 3)');
});
test('official copy component works with click, Enter and Space in the browser', async ({page}) => {
  await page.addInitScript(() => {window.copies=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>window.copies.push(text)}});});
  await render(page, '```js\n  const n = "<&>";\n```');
  const button = page.locator('clipboard-copy');
  await page.locator('pre').hover(); await button.click(); await button.focus(); await button.press('Enter'); await button.press('Space');
  await expect.poll(() => page.evaluate(() => window.copies)).toEqual(Array(3).fill('  const n = "<&>";\n'));
  await expect(button.locator('.octicon-check')).toHaveCount(1);
});
test('native copy bridge preserves Unicode spaces and never copies icon or feedback text', async ({page}) => {
  await page.addInitScript(() => {window.messages=[];window.chrome={webview:{postMessage:m=>window.messages.push(m),addEventListener:()=>{}}};});
  await render(page, '```text\na\u3000b\u00a0c\u200bd\n```');
  const button = page.locator('clipboard-copy'); await button.focus(); await button.press('Enter'); await button.press('Space');
  expect(await page.evaluate(() => window.messages.filter(m=>m.type==='copy').map(m=>m.text))).toEqual(Array(2).fill('a\u3000b\u00a0c\u200bd\n'));
});
test('diff additions and deletions use the official theme colors', async ({page}) => {
  await render(page, '```diff\n-old\n+new\n```');
  await expect(page.locator('.hljs-deletion')).toHaveCSS('color','rgb(130, 7, 30)');
  await expect(page.locator('.hljs-deletion')).toHaveCSS('background-color','rgb(255, 235, 233)');
  await expect(page.locator('.hljs-addition')).toHaveCSS('color','rgb(17, 99, 41)');
  await expect(page.locator('.hljs-addition')).toHaveCSS('background-color','rgb(218, 251, 225)');
});
