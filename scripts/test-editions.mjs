import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
import { OriginalEngine } from './upstream/client.mjs';
const repo=process.cwd();
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.woff':'font/woff'};
const browser=await chromium.launch();
const results=[];
try {
  for(const edition of ['dual','custom','upstream']) {
    const root=resolve(repo,`artifacts/renderer-${edition}`);
    const server=createServer(async(req,res)=>{try {const p=resolve(root,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!p.startsWith(root+sep))throw Error();res.setHeader('Content-Type',mime[extname(p)]||'application/octet-stream');res.end(await readFile(p));}catch{res.writeHead(404);res.end();}});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(r.url()+':'+r.status())});
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.mdv);
      assert.equal(await page.evaluate(()=>window.mdv.edition),edition);
      for(const mode of ['github','qiita']) {
        const markdown='# 見出し\n\n**本文** $x^2$\n\n```mermaid\nflowchart LR\nA --> B\n```\n\n:::note info\n補足\n:::';
        const engine=edition==='custom'?'legacy':'original';let worker;
        try {
          const original=engine==='original'?(worker=await OriginalEngine.start(mode,{desktop:true}),{...await worker.render(markdown),metadata:worker.metadata}):undefined;
          const result=await page.evaluate(o=>window.mdv.render(o),{mode,markdown,engine:edition==='dual'?engine:engine==='legacy'?'original':'legacy',original});
          assert.deepEqual(result.diagnostics,[]);
          assert.equal(await page.locator('h1').innerText(),'見出し');
          assert.equal(await page.locator('mjx-container').count(),1);
          assert.equal(await page.locator('.diagram-screen svg').count(),1);
          assert.equal(await page.evaluate(()=>window.mdv.find('本文').total),1);
          results.push({edition,mode,math:true,mermaid:true,search:true,unavailableEngineNormalized:edition!=='dual'});
          await mkdir(`${repo}/artifacts/verification/${edition}`,{recursive:true});
          await page.screenshot({path:`${repo}/artifacts/verification/${edition}/${mode}.png`,fullPage:true});
        } finally {worker?.close();}
      }
      assert.deepEqual(errors,[]);
    } finally {await page.close();await new Promise(r=>server.close(r));}
  }
  await writeFile(`${repo}/artifacts/verification/edition-browser.json`,JSON.stringify(results,null,2)+'\n');console.log('PASS: all 3 editions in both modes, unavailable-engine normalization, math, diagrams, search, no missing assets.');
} finally {await browser.close();}
