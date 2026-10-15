import {test,expect} from '@playwright/test';
import {OriginalEngine} from '../../../scripts/upstream/client.mjs';

const source='https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/1/image.png';
const saved='https://document.mdv.invalid/qiita-image/'+'a'.repeat(64);
const pixels=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
for(const engine of ['legacy','original'])test.describe(`${engine}: saved Qiita images`,()=>{
  test.skip(engine==='original'&&!process.env.MDV_RUBY,'Real engine requires Ruby');
  let original;
  test.beforeAll(async()=>{if(engine==='original')original=await OriginalEngine.start('qiita',{desktop:true});});
  test.afterAll(()=>original?.close());
  test('explicit snapshots render offline and toggling restores the authored source',async({page})=>{
    const remote=[];
    await page.route('https://**/*',r=>{
      if(r.request().url()===saved)return r.fulfill({body:pixels,contentType:'image/png'});
      remote.push(r.request().url());return r.abort();
    });
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    const markdown=`![Saved](${source})\n\n![Unmatched](https://example.com/other.png)`;
    const options={engine,mode:'qiita',markdown,allowRemoteImages:false,original:original?{...await original.render(markdown),metadata:original.metadata}:undefined};
    await page.evaluate(o=>window.mdv.render(o),options);
    expect(await page.evaluate(()=>window.mdv.getImageSources())).toEqual([source,'https://example.com/other.png']);
    await expect(page.locator('img.blocked-image')).toHaveCount(2);
    await page.evaluate(o=>window.mdv.render(o),{...options,savedQiitaImages:{[source]:saved}});
    await expect(page.locator('img').first()).toHaveAttribute('src',saved);
    await page.waitForFunction(()=>document.querySelector('#document img').naturalWidth===1);
    await expect(page.locator('img.blocked-image')).toHaveCount(1);
    expect(remote).toEqual([]);
    await page.evaluate(o=>window.mdv.render(o),options);
    await expect(page.locator('img.blocked-image')).toHaveCount(2);
    expect(await page.evaluate(()=>window.mdv.getImageSources())).toEqual([source,'https://example.com/other.png']);
    await page.evaluate(o=>window.mdv.render(o),{...options,allowRemoteImages:true});
    await expect(page.locator('img').first()).toHaveAttribute('src',source);
    await expect.poll(()=>remote.includes(source)).toBe(true);
  });
  test('saved fallback images take precedence over picture sources without contacting those hosts',async({page})=>{
    const remote=[];
    await page.route('https://**/*',r=>{
      if(r.request().url()===saved)return r.fulfill({body:pixels,contentType:'image/png'});
      remote.push(r.request().url());return r.abort();
    });
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    const markdown=`<picture><source srcset="https://example.com/other.png"><img src="${source}"></picture>`;
    await page.evaluate(o=>window.mdv.render(o),{engine,mode:'qiita',markdown,allowRemoteImages:true,savedQiitaImages:{[source]:saved},original:original?{...await original.render(markdown),metadata:original.metadata}:undefined});
    await expect(page.locator('picture source')).toHaveCount(0);
    await page.waitForFunction(()=>document.querySelector('#document img').naturalWidth===1);
    expect(remote).toEqual([]);
  });
  test('CDN selection preserves signatures, dimensions and original sources and can be disabled',async({page})=>{
    const cdn='https://qiita-user-contents.imgix.net/'+encodeURIComponent(source)+'?w=1400&s=published-signature';
    const requests=[];
    await page.route('https://**/*',r=>{
      requests.push(r.request().url());
      return r.request().url()===cdn?r.fulfill({body:pixels,contentType:'image/png'}):r.abort();
    });
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    const markdown=`<picture><source srcset="https://example.com/other.png"><img src="${source}" width="80"></picture>\n\n![Other](https://example.com/unmatched.png)`;
    const options={engine,mode:'qiita',markdown,allowRemoteImages:false,original:original?{...await original.render(markdown),metadata:original.metadata}:undefined};
    await page.evaluate(o=>window.mdv.render(o),{...options,qiitaCdnImages:{[source]:cdn},savedQiitaImages:{[source]:saved}});
    await expect(page.locator('img').first()).toHaveAttribute('src',cdn);
    await expect(page.locator('img').first()).toHaveAttribute('width','80');
    await page.waitForFunction(()=>document.querySelector('#document img').naturalWidth===1);
    await expect(page.locator('picture source')).toHaveCount(0);
    await expect(page.locator('img.blocked-image')).toHaveCount(1);
    expect(requests).toEqual([cdn]);
    expect(await page.evaluate(()=>window.mdv.getImageSources())).toContain(source);
    await page.evaluate(o=>window.mdv.render(o),options);
    await expect(page.locator('img.blocked-image')).toHaveCount(2);
    for(const replacement of ['https://example.com/tracker.png',cdn.replace('image.png','wrong.png'),cdn.replace('imgix.net/','imgix.net.evil.test/')]) {
      await page.evaluate(o=>window.mdv.render(o),{...options,qiitaCdnImages:{[source]:replacement}});
      await expect(page.locator('img.blocked-image')).toHaveCount(2);
    }
  });
  test('untrusted replacement URLs are rejected and archive errors remain visible',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    const markdown=`![Image](${source})`;
    const options={engine,mode:'qiita',markdown,allowRemoteImages:false,original:original?{...await original.render(markdown),metadata:original.metadata}:undefined};
    for(const replacement of ['https://example.com/tracker.png','javascript:alert(1)','https://document.mdv.invalid/image/secret.png']) {
      await page.evaluate(o=>window.mdv.render(o),{...options,savedQiitaImages:{[source]:replacement}});
      await expect(page.locator('img.blocked-image')).toHaveCount(1);
    }
    const result=await page.evaluate(o=>window.mdv.render(o),{...options,savedQiitaImages:null,savedImageFailure:'Saved image archive is corrupt'});
    expect(result.diagnostics).toContain('Saved image archive is corrupt');
  });
});

test('saved Qiita images do not affect GitHub mode',async({page})=>{
  await page.goto('/');await page.waitForFunction(()=>window.mdv);
  await page.evaluate(o=>window.mdv.render(o),{engine:'legacy',mode:'github',markdown:`![Image](${source})`,allowRemoteImages:false,savedQiitaImages:{[source]:saved},qiitaCdnImages:{[source]:'https://qiita-user-contents.imgix.net/'+encodeURIComponent(source)}});
  await expect(page.locator('img.blocked-image')).toHaveCount(1);
});
