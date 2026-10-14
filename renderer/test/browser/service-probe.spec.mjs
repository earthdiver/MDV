import {createImageNormalizer} from '../../../scripts/upstream/animated-images.mjs';
import {restoreAuthoredIssueReferences} from '../../../scripts/upstream/service-context.mjs';
import {installArticleWidthNormalization,waitForServiceDiagrams,isolateArticle} from '../../../scripts/upstream/visual-probe.mjs';
import {test,expect} from '@playwright/test';
import {features,hasPendingQiitaMath} from '../../../scripts/upstream/service-features.mjs';

test('service probe ignores serialized table whitespace but detects visible cell changes', async ({page})=>{
  await page.setContent('<article><ol><li><p>Step</p>\n<table><tbody><tr>\n<th>Key</th>\n<td>Value</td>\n</tr></tbody></table></li></ol></article>');
  const reference=await page.locator('article').evaluate(features);
  await page.setContent('<article><ol><li><p>Step</p><table><tbody><tr><th>Key</th><td>Value</td></tr></tbody></table></li></ol></article>');
  expect(await page.locator('article').evaluate(features)).toEqual(reference);
  await page.locator('td').evaluate(n=>n.textContent='Changed');
  expect((await page.locator('article').evaluate(features)).lists).not.toEqual(reference.lists);
});

test('service probe reports added formatting and code even when the reference has none', async ({page})=>{
  await page.setContent('<article><p>Text</p></article>');
  const reference=await page.locator('article').evaluate(features);
  await page.setContent('<article><p><strong>Text</strong></p><pre>new code\n</pre></article>');
  const actual=await page.locator('article').evaluate(features);
  expect(reference.codeBlocks).toEqual([]); expect(actual.codeBlocks).toEqual(['new code']);
  expect(reference.formatting).toEqual([]); expect(actual.formatting).toEqual([{kind:'STRONG',text:'Text'}]);
});

test('service probe separates block code captions and removes service copy controls', async ({page})=>{
  await page.setContent('<article><ul><li><div>file.html</div>\n<pre>code</pre><div class="code-copy">Copied!</div></li></ul></article>');
  const reference=await page.locator('article').evaluate(features);
  await page.setContent('<article><ul><li><span>file.html</span><pre>code</pre></li></ul></article>');
  expect((await page.locator('article').evaluate(features)).lists).toEqual(reference.lists);
});

test('service probe detects lost image size declarations without comparing blocked image pixels', async ({page})=>{
  await page.setContent('<article><img style="height:22px!important;max-width:100%"><img width="30"></article>');
  const reference=await page.locator('article').evaluate(features);
  expect(reference.imageDimensions).toEqual([{width:'',height:'22px'},{width:'30px',height:''}]);
  await page.locator('img').first().evaluate(n=>n.removeAttribute('style'));
  expect((await page.locator('article').evaluate(features)).imageDimensions).not.toEqual(reference.imageDimensions);
});


test('Qiita math waiting distinguishes prices and code from actual math', async ({page})=>{
  for (const [html,expected] of [
    ['<p>A dashboard shows $0 for unpriced calls.</p>',false],
    ['<pre><code>$x$</code></pre>',false],
    ['<p>Inline $x + y$ formula</p>',true],
    ['<div data-lang="math">x</div>',true],
    [String.raw`<p>Escaped \$x\$</p>`,false],
  ]) {
    await page.setContent(`<article>${html}</article>`);
    expect(await page.locator('article').evaluate(hasPendingQiitaMath)).toBe(expected);
  }
});

test('service probe detects missing image outlines and authored font colors', async ({page})=>{
  await page.setContent('<article><font color="red">New!</font><img style="box-shadow:0 0 0 1px rgba(0,0,0,.12)"></article>');
  const reference=await page.locator('article').evaluate(features);
  expect(reference.fontColors).toEqual([{text:'New!',color:'rgb(255, 0, 0)'}]);
  expect(reference.imageFrames).toEqual([{border:'none',shadow:'rgba(0, 0, 0, 0.12) 0px 0px 0px 1px'}]);
  await page.setContent('<article>New!<img></article>');
  const actual=await page.locator('article').evaluate(features);
  expect(actual.fontColors).not.toEqual(reference.fontColors);
  expect(actual.imageFrames).not.toEqual(reference.imageFrames);
});

test('ordinary external links containing fn are not footnote targets',async({page})=>{
  await page.setContent('<article><a href="https://example.com/defnamed">Plugin</a><a href="#footnotes-plugin">Section</a></article>');
  expect((await page.locator('article').evaluate(features)).footnoteTargets).toEqual([]);
});


test('service probe excludes hidden diagram fallback code, preserving visible code',async({page})=>{
  await page.setContent('<article><pre>visible</pre><div style="display:none"><pre lang="mermaid">hidden diagram source</pre></div></article>');
  expect((await page.locator('article').evaluate(features)).codeBlocks).toEqual(['visible']);
});

test('service probe rejects a Mermaid loading frame and waits for its actual SVG',async({page})=>{
  await page.route('https://viewscreen.githubusercontent.com/**',r=>r.fulfill({contentType:'text/html',body:'<p>Loading</p>'}));
  await page.setContent('<article><iframe class="render-viewer" src="https://viewscreen.githubusercontent.com/markdown/mermaid"></iframe></article>');
  await expect(waitForServiceDiagrams(page,'article',200)).rejects.toThrow();
  await page.frameLocator('iframe').locator('body').evaluate(n=>n.innerHTML='<svg id="diagram" width="100" height="50"><g><rect width="50" height="20"/></g></svg>');
  await waitForServiceDiagrams(page,'article',1000);
});


test('issue exception reverses only verified server enrichment, preserving explicit links',async({page})=>{
  await page.setContent('<article><a class="issue-link js-issue-link" href="https://github.com/owner/repo/issues/7">#7</a> <a href="https://github.com/owner/repo/issues/7">#7</a><code>owner/repo#7</code></article>');
  const changes=await restoreAuthoredIssueReferences(page,'article','owner/repo#7 [#7](https://github.com/owner/repo/issues/7) `owner/repo#7`','https://github.com/owner/repo/blob/main/README.md');
  expect(changes).toHaveLength(1);expect(changes[0].after).toBe('owner/repo#7');
  await expect(page.locator('article a')).toHaveCount(1);await expect(page.locator('article code')).toHaveText('owner/repo#7');
});

test('issue exception refuses references absent from authored prose',async({page})=>{
  await page.setContent('<article><a class="issue-link js-issue-link" href="https://github.com/owner/repo/issues/7">#7</a></article>');
  await expect(restoreAuthoredIssueReferences(page,'article','`owner/repo#7`','https://github.com/owner/repo/blob/main/README.md')).rejects.toThrow('Cannot reconstruct');
});


test('article width normalization precedes service script measurements',async({page})=>{
  await installArticleWidthNormalization(page,'article');
  await page.route('https://example.test/article',r=>r.fulfill({contentType:'text/html',body:'<style>html{box-sizing:border-box}*{box-sizing:inherit}article{width:400px;padding:20px}</style><article><table><tr><td>text</td></tr></table></article><script>document.querySelector("article").dataset.measuredWidth=document.querySelector("article").getBoundingClientRect().width</script>'}));
  await page.goto('https://example.test/article');
  await expect(page.locator('article')).toHaveAttribute('data-measured-width','800');
  await expect(page.locator('td')).toHaveCSS('box-sizing','border-box');
  await isolateArticle(page,'article');
  await expect(page.locator('td')).toHaveCSS('box-sizing','border-box');
});

test('GIF comparison fixes frame zero but detects a changed later frame',async({page})=>{
  await page.goto('/');
  const normalizer=createImageNormalizer(page),outputs=[];
  const prefix='47494638396101000100800000000000ffffff21f904000a0000002c000000000100010000020244010021f904000a0000002c0000000001000100000202';
  for(const [name,frame]of [['a','44'],['b','4c']]){
    const body=Buffer.from(prefix+frame+'01003b','hex');
    await normalizer.serve({request:()=>({url:()=>`https://example.test/${name}.gif`}),fetch:async()=>({body:async()=>body,headers:()=>({'content-type':'image/gif'}),status:()=>200}),fulfill:async value=>outputs.push(value)});
  }
  expect(outputs[0].contentType).toBe('image/png');
  expect(outputs[0].body.equals(outputs[1].body)).toBe(true);
  const records=normalizer.describe(['a','b'].map(name=>({src:`https://example.test/${name}.gif`})));
  expect(records.map(r=>r.frames)).toEqual([2,2]);expect(records[0].sha256).not.toBe(records[1].sha256);
  const savedUrl='https://document.mdv.invalid/qiita-image/saved';
  await normalizer.serve({request:()=>({url:()=>savedUrl}),fetch:()=>{throw Error('Saved bytes must not fetch the reference image');},fulfill:async value=>outputs.push(value)},savedUrl,
    {status:200,headers:{'content-type':'image/gif'},body:Buffer.from(prefix+'4c01003b','hex')});
  expect(outputs[2].body.equals(outputs[0].body)).toBe(true);
  expect(normalizer.describe([{src:savedUrl}])[0].sha256).toBe(records[1].sha256);
});

test('service image contracts exclude inactive theme variants',async({page})=>{
  await page.setContent('<article><img width="22" height="22"><a style="display:none"><img width="44" height="44"></a></article>');
  const observed=await page.locator('article').evaluate(features);
  expect(observed.imageFrames).toHaveLength(1);expect(observed.imageDimensions).toEqual([{width:'22px',height:'22px'}]);
});

test('image response cache survives disposal of the fetching browser context',async({page})=>{
  const normalizer=createImageNormalizer(page),outputs=[],body=Buffer.from('static image bytes');let disposed=false,fetches=0;
  const route={request:()=>({url:()=>'https://example.test/image.png'}),fetch:async()=>{fetches++;if(disposed)throw Error('Disposed context');return {body:async()=>body,headers:()=>({'content-type':'image/png','content-encoding':'gzip','content-length':'123'}),status:()=>200};},fulfill:async value=>outputs.push(value)};
  await normalizer.serve(route);disposed=true;await normalizer.serve(route);
  expect(fetches).toBe(1);expect(outputs[1].body.equals(body)).toBe(true);expect(outputs[1].response).toBeUndefined();expect(outputs[1].headers['content-encoding']).toBeUndefined();
});

test('service cards wait for delayed thumbnails and reject broken ones',async({page})=>{
  const {waitForServiceCards}=await import('../../../scripts/upstream/visual-probe.mjs');
  const frame='https://qiita.com/embed-contents/link-card',image='https://example.com/card.png';
  const pixels=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
  let release;const gate=new Promise(r=>release=r);
  await page.route(frame,r=>r.fulfill({contentType:'text/html',body:`<a><div>Card</div><img src="${image}"></a>`}));
  await page.route(image,async r=>{await gate;return r.fulfill({contentType:'image/png',body:pixels});});
  await page.setContent(`<article><iframe src="${frame}"></iframe></article>`,{waitUntil:'domcontentloaded'});
  let ready=false;const waiting=waitForServiceCards(page,'article').then(()=>ready=true);
  await page.waitForTimeout(100);expect(ready).toBe(false);release();await waiting;expect(ready).toBe(true);
  await page.route(image,r=>r.fulfill({contentType:'image/png',body:'not an image'}));
  await page.setContent(`<article><iframe src="${frame}"></iframe></article>`);
  await expect(waitForServiceCards(page,'article')).rejects.toThrow();
});

test('article isolation suppresses late site chrome without hiding authored additions',async({page})=>{
  await page.setContent('<main><article><p>Original</p></article></main>');
  await isolateArticle(page,'article');
  await page.evaluate(()=>{
    const promo=document.createElement('aside');promo.id='late-promo';promo.textContent='Promotion';document.body.append(promo);
    const authored=document.createElement('p');authored.id='authored-late';authored.textContent='Article update';document.querySelector('article').append(authored);
  });
  await expect(page.locator('#late-promo')).toBeHidden();await expect(page.locator('#authored-late')).toBeVisible();
  await page.locator('#late-promo').evaluate(n=>n.style.setProperty('display','block','important'));
  await expect(page.locator('#late-promo')).toBeHidden();
});
