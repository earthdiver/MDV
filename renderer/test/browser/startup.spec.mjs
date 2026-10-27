import { test, expect } from '@playwright/test';

for (const engine of ['legacy','original']) for (const mode of ['github','qiita']) {
  test(`${engine} ${mode}: MathJax stays unloaded until equations appear`, async ({page}) => {
    const mathRequests=[];
    page.on('request',r=>{if(r.url().includes('/mathjax/'))mathRequests.push(r.url());});
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    const render=async(markdown,html)=>page.evaluate(options=>window.mdv.render(options),{
      engine,mode,markdown,original:{html,metadata:{mode}},theme:'light',
    });
    await render('# Plain\n\nNo equations.','<h1>Plain</h1><p>No equations.</p>');
    expect(mathRequests).toEqual([]);
    expect(await page.evaluate(()=>!!window.MathJax)).toBe(false);
    await render('&#36;x+1&#36;','<p>&#36;x+1&#36;</p>');
    await expect(page.locator('mjx-container')).toHaveCount(1);
    expect(mathRequests.length).toBeGreaterThan(0);
    await render('Plain again','<p>Plain again</p>');
    await expect(page.locator('mjx-container')).toHaveCount(0);
    await render('```math\nx+1\n```',mode==='qiita'?'<div class="code-frame" data-lang="math"><pre><code>x+1</code></pre></div>':'<pre lang="math"><code>x+1</code></pre>');
    await expect(page.locator('mjx-container')).toHaveCount(1);
    await expect(page.locator('[data-mjx-error],.math-error')).toHaveCount(0);
  });
}
