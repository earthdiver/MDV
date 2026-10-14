import {test,expect} from '@playwright/test';
import {OriginalEngine} from '../../../scripts/upstream/client.mjs';
const code='function Get-Example { Write-Output "hello"; $s.ToString() }\nGet-Example\n';
const markdown='# Example\n\n[Link](https://example.com)\n\n```PowerShell:MixedCase.ps1\n'+code+'```\n\n```text\n'+code+'```';
test.describe('Qiita language detection and shared syntax highlighting',()=>{
  test.skip(!process.env.MDV_RUBY,'Requires the real Qiita worker');
  let engine;
  test.beforeAll(async()=>{engine=await OriginalEngine.start('qiita',{desktop:true});});
  test.afterAll(()=>engine?.close());
  test('both engines color mixed-case PowerShell methods and preserve code text',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    const original={...await engine.render(markdown),metadata:engine.metadata};
    const results=[];
    for(const selected of ['legacy','original']) {
      await page.evaluate(options=>window.mdv.render(options),{engine:selected,mode:'qiita',markdown,original});
      const first=page.locator('pre code').first();
      await expect(first).toHaveText(code);
      const method=first.locator('.nf').filter({hasText:'ToString'});
      await expect(method).toHaveCSS('color','rgb(139, 223, 76)');
      await expect(page.locator('pre code').nth(1).locator('span')).toHaveCount(0);
      await expect(page.locator('.code-lang')).toHaveText('MixedCase.ps1');
      if(selected==='legacy')await expect(first).toHaveAttribute('data-mdv-highlighter','rouge');
      results.push(await first.locator('span').evaluateAll(nodes=>nodes.map(n=>[n.textContent,n.className,getComputedStyle(n).color])));
    }
    expect(results[0]).toEqual(results[1]);
  });
  test('unavailable optional highlighting retains the legacy document with a diagnostic',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    const result=await page.evaluate(markdown=>window.mdv.render({engine:'legacy',mode:'qiita',markdown,highlightFailure:'Highlight worker unavailable'}),markdown);
    await expect(page.locator('h1')).toContainText('Example');
    await expect(page.locator('pre code').first()).toHaveText(code);
    expect(result.diagnostics).toContain('Highlight worker unavailable');
  });
});
test('GitHub body links remain underlined before hover in light, dark and print',async({page})=>{
  await page.goto('/');await page.waitForFunction(()=>window.mdv);
  for(const theme of ['light','dark']) {
    await page.evaluate(theme=>window.mdv.render({mode:'github',theme,markdown:'# Heading\n\n[Link](https://example.com)'}),theme);
    await page.mouse.move(0,0);
    for(const media of ['screen','print']) {
      await page.emulateMedia({media});await expect(page.locator('#document p a')).toHaveCSS('text-decoration-line','underline');
    }
    await page.emulateMedia({media:'screen'});await page.locator('h1').hover();await expect(page.locator('.mdv-heading-link')).toHaveCSS('text-decoration-line','none');
  }
});
