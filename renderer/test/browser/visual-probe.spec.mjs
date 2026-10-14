import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {isolateArticle,captureVisual,compareVisual} from '../../../scripts/upstream/visual-probe.mjs';

test('visual comparison ignores outside chrome but detects a thin image frame and text color', async({browser})=>{
  const folder=await mkdtemp(join(tmpdir(),'mdv-visual-'));
  const reference=await browser.newPage(),actual=await browser.newPage(),control=await browser.newPage();
  const article='<article><p>Text <font color="red">New!</font></p><p><img style="width:100px;height:40px;box-shadow:0 0 0 1px rgba(0,0,0,.12)" src="data:image/svg+xml,%3Csvg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"40\"/%3E"></p></article>';
  // Use a valid image URL independent of network and the app resource policy.
  const html=article.replace(/src="[\s\S]*?">/,`src="data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"/>').toString('base64')}">`);
  try{
    await reference.setContent('<header style="position:fixed;background:red">Site header</header><main style="padding:40px">'+html+'</main>');
    await actual.setContent(html);
    await isolateArticle(reference,'article');await isolateArticle(actual,'article');
    const a=await captureVisual(reference,'article',join(folder,'reference'));
    const b=await captureVisual(actual,'article',join(folder,'actual'));
    expect((await compareVisual(control,a,b,join(folder,'reference'),join(folder,'actual'))).status).toBe('match');
    await actual.locator('img').evaluate(n=>n.style.boxShadow='none');
    const c=await captureVisual(actual,'article',join(folder,'changed'));
    const diff=await compareVisual(control,a,c,join(folder,'reference'),join(folder,'changed'));
    expect(diff.raster.changedPixels).toBeGreaterThan(0);expect(diff.styles.some(n=>n.css?.boxShadow)).toBe(true);
    await actual.locator('font').evaluate(n=>n.color='black');
    const d=await captureVisual(actual,'article',join(folder,'color'));
    expect((await compareVisual(control,a,d,join(folder,'reference'),join(folder,'color'))).styles.some(n=>n.css?.color)).toBe(true);
  }finally{await Promise.all([reference.close(),actual.close(),control.close()]);await rm(folder,{recursive:true,force:true});}
});

test('missing images remain unverified rather than passing visual comparison',async({page})=>{
  await page.setContent('<article><img src="data:image/png;base64,broken"></article>');
  await expect(isolateArticle(page,'article')).rejects.toThrow('Unverified image resources');
});
