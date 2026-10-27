import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { OriginalEngine } from '../../../scripts/upstream/client.mjs';
import { mathSnapshot } from '../../../scripts/compatibility/browser-compare.mjs';
import { comparePng } from '../../../scripts/compatibility/png-compare.mjs';

const catalog = JSON.parse(await readFile('tests/compatibility/browser-cases.json', 'utf8'));
const cases = catalog.cases.filter(item => item.kind === 'math' && item.modes.includes('github'));
cases.push(
  {id:'math-escaped-parentheses', markdown:String.raw`$\(1\)$`, display:false},
  {id:'math-escaped-backslashes', markdown:String.raw`$\\{1\\}$`, display:false},
  {id:'math-code-escapes', markdown:'$`' + String.raw`\{1\}` + '`$', display:false},
  {id:'math-display-escapes', markdown:'$$\n' + String.raw`\(1\)` + '\n$$', display:true},
  {id:'math-same-line-display', markdown:String.raw`$$\(1\)$$`, display:true},
  {id:'math-numeric-references', markdown:'$&#40;1&#x29;$', display:false},
  {id:'math-named-references', markdown:'$&lt;x&gt;$', display:false},
  {id:'math-display-references', markdown:'$$\n&#40;1&#41;\n$$', display:true},
  {id:'math-multiple-backticks', markdown:'$``' + String.raw`\{1\}` + '``$', display:false},
  {id:'math-code-padding', markdown:'$` ' + String.raw`\{1\}` + ' `$', display:false},
  {id:'math-code-newline', markdown:'$`x +\ny`$', display:false},
  {id:'math-code-literal-reference', markdown:'$`' + String.raw`\text{\&amp;}` + '`$', display:false},
);
const output = 'artifacts/github-math-engines';

test.describe('GitHub math agrees between custom and upstream engines', () => {
  test.skip(!process.env.MDV_RUBY, 'Set MDV_RUBY to execute the real upstream Markdown engine');
  let worker;
  test.beforeAll(async () => {
    worker = await OriginalEngine.start('github', { desktop:true });
    await mkdir(output, { recursive:true });
  });
  test.afterAll(() => worker?.close());

  for (const fixture of cases) for (const variant of catalog.variants) {
    test(`${fixture.id}: ${variant.id}`, async ({ context }) => {
      const original = { ...await worker.render(fixture.markdown), metadata:worker.metadata };
      const captures = {};
      for (const engine of ['legacy', 'original']) {
        // Separate fresh pages also exercise first-load MathJax stylesheet setup.
        const page = await context.newPage();
        try {
          await page.goto('/');
          await page.waitForFunction(() => window.mdv);
          await page.emulateMedia({media:variant.media, reducedMotion:'reduce'});
          const result = await page.evaluate(options => window.mdv.render(options), {
            engine, mode:'github', markdown:fixture.markdown, original, theme:variant.theme,
          });
          expect(result.diagnostics).toEqual([]);
          const target = page.locator('#document mjx-container[jax="SVG"]');
          await expect(target).toHaveCount(1);
          if (fixture.display) await expect(target).toHaveAttribute('display', 'true');
          if (!fixture.display) await expect(target).not.toHaveAttribute('display', 'true');
          await expect(page.locator('.math-error, [data-mjx-error]')).toHaveCount(0);
          captures[engine] = {
            dom:await target.evaluate(mathSnapshot),
            bounds:await target.boundingBox(),
            png:await target.screenshot({path:`${output}/${fixture.id}-${variant.id}-${engine}.png`, animations:'disabled'}),
          };
        } finally { await page.close(); }
      }
      const {legacy, original:upstream} = captures;
      // No tolerance, font overrides or pixel-position alignment: these are
      // the actual app's two rendering paths under the same browser settings.
      const difference = comparePng(upstream.png, legacy.png, 0);
      await writeFile(`${output}/${fixture.id}-${variant.id}-diff.png`, difference.diff);
      delete difference.diff;
      const report = {case:fixture.id, variant, customBounds:legacy.bounds, upstreamBounds:upstream.bounds,
        domMatch:legacy.dom === upstream.dom, pixels:difference};
      await writeFile(`${output}/${fixture.id}-${variant.id}.json`, JSON.stringify(report,null,2)+'\n');
      expect(legacy.dom).toBe(upstream.dom);
      expect(difference.sameSize).toBe(true);
      expect(difference.changedPixels).toBe(0);
    });
  }
});
