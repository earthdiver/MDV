import { test, expect } from '@playwright/test';
import { mathSnapshot, alignMathCapture } from '../../../scripts/compatibility/browser-compare.mjs';
import { comparePng } from '../../../scripts/compatibility/png-compare.mjs';

for (const mode of ['github', 'qiita']) test(`${mode}: math comparator detects glyph, color, size and accessibility changes`, async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.mdv);
  async function render() {
    await page.evaluate(mode => window.mdv.render({engine:'legacy', mode, markdown:'$x^2+y_1$'}), mode);
    const target = page.locator('#document mjx-container');
    await target.evaluate(alignMathCapture);
    return target;
  }
  let target = await render();
  const original = await target.evaluate(mathSnapshot);
  const originalImage = await target.screenshot();
  await target.evaluate(node => {
    node.setAttribute('ctxtmenu_counter', '999');
    node.classList.add('CtxtMenu_Attached_999');
  });
  expect(await target.evaluate(mathSnapshot)).toBe(original);
  expect(comparePng(originalImage, await target.screenshot(), 0).changedPixels).toBe(0);
  await target.locator('mjx-assistive-mml mi').first().evaluate(node => node.textContent = 'z');
  expect(await target.evaluate(mathSnapshot)).not.toBe(original);
  for (const mutation of ['glyph', 'color', 'size', 'assistive']) {
    target = await render();
    const before = await target.screenshot();
    const dom = await target.evaluate(mathSnapshot);
    await target.evaluate((node, mutation) => {
      if (mutation === 'glyph') {
        const path = node.querySelector('svg path');
        if (path) path.setAttribute('d', 'M0 0 L500 500 L500 0 Z');
        else node.querySelector('mjx-c').className = 'mjx-c31';
      } else if (mutation === 'color') node.style.color = 'red';
      else if (mutation === 'size') node.style.fontSize = '200%';
      else node.querySelector('mjx-assistive-mml').style.cssText = 'position:static !important; width:auto !important; height:auto !important; clip:auto !important; padding:0 !important; overflow:visible !important;';
    }, mutation);
    expect(await target.evaluate(mathSnapshot), mutation).not.toBe(dom);
    const diff = comparePng(before, await target.screenshot(), 16);
    expect(!diff.sameSize || diff.ratio > 0.01, mutation).toBe(true);
  }
});
