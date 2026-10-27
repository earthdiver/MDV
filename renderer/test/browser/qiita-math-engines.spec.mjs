import {test, expect} from '@playwright/test';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {OriginalEngine} from '../../../scripts/upstream/client.mjs';
import {mathSnapshot} from '../../../scripts/compatibility/browser-compare.mjs';
import {comparePng} from '../../../scripts/compatibility/png-compare.mjs';

const catalog = JSON.parse(await readFile('tests/compatibility/browser-cases.json', 'utf8'));
// Reuse only the boundary inputs, never GitHub's expected recognition rules.
// Qiita has its own Markdown implementation and MathJax scope.
const boundaries = JSON.parse(await readFile('tests/compatibility/github-math-api.json', 'utf8')).cases;
const live = JSON.parse(await readFile('tests/compatibility/qiita-live-math.json', 'utf8'));
const cases = [
  ...live.cases,
  ...catalog.cases.filter(item => item.kind === 'math' && item.modes.includes('qiita')),
  ...boundaries.map(({id, markdown}) => ({id, markdown})),
  {id:'note', markdown:':::note info\n$x^2$\n:::'},
  {id:'table', markdown:'| Value |\n| --- |\n| $x_1$ |'},
  {id:'math-caption', markdown:'```math:ignored\n' + String.raw`\frac{1}{2}` + '\n```'},
  {id:'bare-environment', markdown:String.raw`Plain \begin{align} x&=1 \end{align}`},
  {id:'ams-tag', markdown:'```math\n' + String.raw`\begin{align} x&=1 \tag{A} \\ y&=2 \tag{B}\end{align}` + '\n```'},
];
const output = 'artifacts/qiita-math-engines';

test.describe('Qiita math agrees between custom and upstream engines', () => {
  test.skip(!process.env.MDV_RUBY, 'Set MDV_RUBY to run the upstream Markdown engine');
  let worker;
  test.beforeAll(async () => {
    worker = await OriginalEngine.start('qiita', {desktop:true});
    await mkdir(output, {recursive:true});
  });
  test.afterAll(() => worker?.close());

  for (const fixture of cases) for (const variant of catalog.variants) {
    test(`${fixture.id}: ${variant.id}`, async ({context}) => {
      const original = {...await worker.render(fixture.markdown), metadata:worker.metadata};
      const captures = {};
      for (const engine of ['legacy', 'original']) {
        const page = await context.newPage();
        try {
          await page.goto('/'); await page.waitForFunction(() => window.mdv);
          await page.emulateMedia({media:variant.media, reducedMotion:'reduce'});
          const result = await page.evaluate(options => window.mdv.render(options), {
            engine, mode:'qiita', markdown:fixture.markdown, original, theme:variant.theme,
          });
          await page.evaluate(() => document.fonts.ready);
          const math = page.locator('#document mjx-container[jax="CHTML"]');
          if (fixture.mathml) {
            await expect(math).toHaveCount(1);
            expect(await math.locator('mjx-assistive-mml').innerHTML()).toBe(fixture.mathml);
            expect(await math.getAttribute('display') === 'true').toBe(fixture.display);
          }
          const formulas = [];
          for (const target of await math.all()) formulas.push({
            dom:await target.evaluate(mathSnapshot),
            png:await target.screenshot({animations:'disabled'}),
          });
          captures[engine] = {diagnostics:result.diagnostics, formulas};
          await expect(page.locator('a mjx-container, h1 mjx-container, pre mjx-container, code mjx-container')).toHaveCount(0);
          // MathJax loads only the font faces needed by the current expression.
          // Requiring an unused face (e.g. MJXTEX for italic-only math) is invalid.
          expect(await page.evaluate(() => [...document.fonts].filter(font => font.status === 'error').map(font => font.family))).toEqual([]);
        } finally {await page.close();}
      }
      const {legacy, original:upstream} = captures;
      expect(legacy.diagnostics).toEqual(upstream.diagnostics);
      expect(legacy.formulas.length).toBe(upstream.formulas.length);
      for (const [index, expected] of upstream.formulas.entries()) {
        const actual = legacy.formulas[index];
        // CHTML font rasterization varies across fresh pages even with the
        // same engine (observed: two pixels, one channel differing by 16).
        // Allow that color noise only; DOM and image dimensions stay exact.
        const difference = comparePng(expected.png, actual.png, 16);
        const base = `${output}/${fixture.id}-${variant.id}-${index}`;
        if (difference.changedPixels) {
          await writeFile(base+'-custom.png', actual.png);
          await writeFile(base+'-upstream.png', expected.png);
          await writeFile(base+'-diff.png', difference.diff);
        }
        expect(actual.dom).toBe(expected.dom);
        expect(difference.sameSize).toBe(true);
        expect(difference.changedPixels).toBe(0);
      }
    });
  }
});
