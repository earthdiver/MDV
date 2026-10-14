import {test,expect} from '@playwright/test';
import {OriginalEngine} from '../../../scripts/upstream/client.mjs';
const saved='https://document.mdv.invalid/github-image/'+'a'.repeat(64);
const pixels=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
for(const engine of ['legacy','original'])test.describe(`${engine}: GitHub saved images and colors`,()=>{
  test.skip(engine==='original'&&!process.env.MDV_RUBY,'Real engine requires Ruby');
  let original;
  test.beforeAll(async()=>{if(engine==='original')original=await OriginalEngine.start('github',{desktop:true});});
  test.afterAll(()=>original?.close());
  test('relative paths display offline, retain authored sources and restore on toggle',async({page})=>{
    const remote=[];
    await page.route('https://**/*',r=>{
      if(r.request().url()===saved)return r.fulfill({body:pixels,contentType:'image/png'});
      remote.push(r.request().url());return r.abort();
    });
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    const markdown='![Parent](../images/a.png)\n\n![Root](/images/b.png)';
    const options={engine,mode:'github',markdown,allowRemoteImages:false,original:original?{...await original.render(markdown),metadata:original.metadata}:undefined};
    await page.evaluate(o=>window.mdv.render(o),{...options,savedGithubImages:{'../images/a.png':saved,'/images/b.png':saved}});
    await page.waitForFunction(()=>[...document.querySelectorAll('#document img')].every(i=>i.naturalWidth===1));
    expect(await page.evaluate(()=>window.mdv.getImageSources())).toEqual(['../images/a.png','/images/b.png']);
    expect(remote).toEqual([]);
    await page.evaluate(o=>window.mdv.render(o),options);
    await expect(page.locator('#document img').first()).not.toHaveAttribute('src',saved);
    await page.evaluate(o=>window.mdv.render(o),{...options,savedGithubImages:{'../images/a.png':'https://evil.test/a.png'}});
    expect(remote.some(url=>url.includes('evil.test'))).toBe(false);
  });
  test('HTML text colors are stripped in both engines as on GitHub',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    const markdown='<font color="red">Red</font> <span style="color: blue; position:fixed" onclick="alert(1)">Blue</span>';
    await page.evaluate(o=>window.mdv.render(o),{engine,mode:'github',markdown,original:original?{...await original.render(markdown),metadata:original.metadata}:undefined});
    await expect(page.locator('#document font')).toHaveCount(0);
    await expect(page.locator('#document span').filter({hasText:'Blue'})).not.toHaveAttribute('style', /color/);
    await expect(page.locator('#document [onclick]')).toHaveCount(0);
  });
});
for(const mode of ['github','qiita'])test(`${mode}: mindmap layout matches the upstream display`,async({page})=>{
  test.skip(!process.env.MDV_RUBY,'Real engine requires Ruby');
  const original=await OriginalEngine.start(mode,{desktop:true});
  try {
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    const markdown='```mermaid\nmindmap\n  root((Root label))\n    A[Square label]\n    B(Rounded label)\n    日本語\n```';
    const rendered={...await original.render(markdown),metadata:original.metadata};
    for(const theme of ['light','dark']) {
      const captures=[];
      for(const engine of ['original','legacy']) {
        const result=await page.evaluate(o=>window.mdv.render(o),{mode,theme,engine,markdown,original:rendered});
        expect(result.diagnostics).toEqual([]);
        captures.push(await page.locator('.diagram-screen .mindmap-node').evaluateAll(nodes=>nodes.map(n=>{
          const r=n.getBoundingClientRect();return {text:n.textContent,width:r.width,height:r.height};
        })));
      }
      expect(captures[1]).toHaveLength(4);
      for(let i=0;i<4;i++) {
        expect(captures[1][i].text).toBe(captures[0][i].text);
        expect(captures[1][i].width).toBeCloseTo(captures[0][i].width,0);
        expect(captures[1][i].height).toBeCloseTo(captures[0][i].height,0);
      }
    }
  } finally {original.close();}
});
