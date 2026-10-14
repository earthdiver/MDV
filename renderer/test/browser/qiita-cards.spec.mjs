import {test,expect} from '@playwright/test';
import {OriginalEngine} from '../../../scripts/upstream/client.mjs';
const source='https://example.com/article',image='https://document.mdv.invalid/qiita-card-image/'+'b'.repeat(64);
const pixels=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
for(const engine of ['legacy','original'])test.describe(`${engine}: saved Qiita cards`,()=>{
  test.skip(engine==='original'&&!process.env.MDV_RUBY,'Real engine requires Ruby');
  let worker;
  test.beforeAll(async()=>{if(engine==='original')worker=await OriginalEngine.start('qiita',{desktop:true});});
  test.afterAll(()=>worker?.close());
  test('saved metadata and thumbnail render offline; disabling restores the URL fallback',async({page})=>{
    const requests=[];await page.route('https://**/*',r=>{if(r.request().url()===image)return r.fulfill({body:pixels,contentType:'image/png'});requests.push(r.request().url());return r.abort();});
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    const markdown=source+'\n\n[Ordinary link](https://example.com/other)';
    const options={engine,mode:'qiita',markdown,allowRemoteImages:false,original:worker?{...await worker.render(markdown),metadata:worker.metadata}:undefined};
    await page.evaluate(o=>window.mdv.render(o),options);
    expect(await page.evaluate(()=>window.mdv.getCardSources())).toEqual([source]);await expect(page.locator('.saved-link-card')).toHaveCount(0);
    await page.evaluate(o=>window.mdv.render(o),{...options,savedQiitaCards:{[source]:{title:'Saved title',origin:'https://example.com',image}}});
    await expect(page.locator('.saved-card-title')).toHaveText('Saved title');await expect(page.locator('.saved-card-title')).toHaveCSS('text-autospace','no-autospace');await page.waitForFunction(()=>document.querySelector('.saved-link-card img').naturalWidth===1);
    await expect(page.locator('.saved-link-card a')).toHaveCSS('text-decoration-line','none');await page.locator('.saved-link-card a').hover();await expect(page.locator('.saved-link-card a')).toHaveCSS('text-decoration-line','none');
    expect(await page.evaluate(()=>window.mdv.getCardSources())).toEqual([source]);expect(requests).toEqual([]);
    await page.evaluate(o=>window.mdv.render(o),options);await expect(page.locator('.saved-link-card')).toHaveCount(0);expect(requests).toEqual([]);
  });
  test('cards match iframe height without thumbnails and respond to article width',async({page})=>{
    await page.route(image,r=>r.fulfill({body:pixels,contentType:'image/png'}));
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    const options={engine,mode:'qiita',markdown:source,allowRemoteImages:false,original:worker?{...await worker.render(source),metadata:worker.metadata}:undefined};
    await page.evaluate(o=>window.mdv.render(o),{...options,savedQiitaCards:{[source]:{title:'Short title',origin:'https://example.com'}}});
    await expect(page.locator('.saved-card-frame')).toHaveCSS('height','80px');await expect(page.locator('.saved-card-frame')).toHaveCSS('contain','paint');
    await page.evaluate(o=>window.mdv.render(o),{...options,savedQiitaCards:{[source]:{title:'Short title',origin:'https://example.com',image}}});
    await page.locator('#document').evaluate(n=>{n.style.width='400px';n.style.padding='0';});
    await expect(page.locator('.saved-link-card img')).toHaveCSS('width','110px');
    await expect(page.locator('.saved-card-frame')).toHaveCSS('height','112px');
  });
  test('metadata is text, unsafe thumbnails are rejected, failures are visible',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    const options={engine,mode:'qiita',markdown:source,allowRemoteImages:false,original:worker?{...await worker.render(source),metadata:worker.metadata}:undefined};
    const result=await page.evaluate(o=>window.mdv.render(o),{...options,savedQiitaCards:{[source]:{title:'<img src=x onerror=alert(1)>',origin:'https://example.com',image:'https://tracker.example/pixel'}},savedCardFailure:'Archive corrupt'});
    await expect(page.locator('.saved-card-title')).toHaveText('<img src=x onerror=alert(1)>');await expect(page.locator('.saved-link-card img')).toHaveCount(0);expect(result.diagnostics).toContain('Archive corrupt');
    await page.evaluate(o=>window.mdv.render(o),{...options,savedQiitaCards:{[source]:{title:'Unsafe',origin:'javascript:alert(1)',image}}});await expect(page.locator('.saved-link-card')).toHaveCount(0);
  });
});
test('saved cards do not change GitHub rendering',async({page})=>{
  await page.goto('/');await page.waitForFunction(()=>window.mdv);
  await page.evaluate(o=>window.mdv.render(o),{mode:'github',markdown:source,savedQiitaCards:{[source]:{title:'Saved',origin:'https://example.com',image}}});
  await expect(page.locator('.saved-link-card')).toHaveCount(0);await expect(page.locator('#document')).toContainText(source);
});
