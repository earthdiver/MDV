import {createImageNormalizer} from './animated-images.mjs';
import {restoreAuthoredIssueReferences} from './service-context.mjs';
import { installArticleWidthNormalization, waitForServiceDiagrams, isolateArticle, captureVisual, compareVisual } from './visual-probe.mjs';
import {captureHover,compareHover,hoverPolicy} from './hover-probe.mjs';
// Read-only public-page observations. No login, publication, or external writes.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
const runFile=promisify(execFile);
import { gemoji } from 'gemoji';
const emojiLookup = Object.fromEntries(gemoji.flatMap(e=>e.names.map(name=>[name,e.emoji])));
import { features, hasPendingQiitaMath } from './service-features.mjs';
import { chromium } from '@playwright/test';
import { startPreview } from './preview.mjs';
import { repositoryRoot } from './client.mjs';
import { hash } from '../../scripts/compatibility/corpus.mjs';
import { summarize, reportHtml } from '../../scripts/compatibility/compare.mjs';
const { values } = parseArgs({ options: {
  'qiita-card-snapshots':{type:'boolean',default:false}, 'qiita-image-snapshots':{type:'boolean',default:false}, 'exclude-service-issue-links':{type:'boolean',default:false}, visual: {type:'boolean',default:false}, refresh: { type:'boolean', default:false }, sources: { type:'string' },
  sample: { type:'string' }, mode: {type:'string'}, out: {type:'string'}, 'server-pages':{type:'string'}, offset:{type:'string',default:'0'}, consecutive:{type:'string'}, seed: { type:'string', default:'mdv' },
} });
const refresh = values.refresh;
const bundle = JSON.parse(await readFile(resolve(repositoryRoot,'src/Mdv.App/Renderer/bundle-manifest.json'),'utf8'));
if (bundle.edition !== 'dual') throw new Error('Both engines are required: run npm run build first');
const out = resolve(repositoryRoot, values.out || 'artifacts/compatibility/service-probes');
await mkdir(out, { recursive: true });
const manifest = resolve(out, 'selection.json');
let sources;
let selectionSeed = values.seed, selectionOffset = Number(values.offset);
if (refresh) {
  sources = JSON.parse(await readFile(resolve(values.sources || 'tests/compatibility/service-sources.json'), 'utf8'));
  for (const source of sources) {
    if (!['qiita','github'].includes(source.mode) || !source.id?.match(/^[a-z0-9-]+$/)) throw new Error('Invalid source');
    for (const url of [source.url, source.markdownUrl]) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !['qiita.com','github.com','raw.githubusercontent.com'].includes(parsed.hostname)) throw new Error('Invalid source URL');
    }
    source.selector = source.mode === 'qiita' ? '.mdContent-inner' : 'article.markdown-body';
  }
  if (new Set(sources.map(s=>s.id)).size !== sources.length) throw new Error('Duplicate source ID');
  if (values.mode) sources = sources.filter(s=>s.mode===values.mode);
  sources.sort((a,b)=>hash(values.seed + a.id).localeCompare(hash(values.seed + b.id)));
  const offset = Number(values.offset);
  if (!Number.isInteger(offset) || offset < 0) throw new Error('Invalid offset');
  sources = sources.slice(offset);
  if (values.sample) {
    const count = Number(values.sample);
    if (!Number.isInteger(count) || count < 1 || count > sources.length) throw new Error('Invalid sample size');
    sources.sort((a,b)=>hash(values.seed + a.id).localeCompare(hash(values.seed + b.id)));
    sources = sources.slice(0,count);
  }
  await writeFile(manifest,JSON.stringify({seed:selectionSeed,offset:selectionOffset,sources},null,2)+'\n');
} else {
  if (values.sources || values.sample) throw new Error('Selection options require --refresh; replay uses selection.json');
  const saved = JSON.parse(await readFile(manifest,'utf8'));
  ({ sources } = saved);
  selectionSeed = saved.seed;
  selectionOffset = saved.offset ?? Number(values.offset);
}
const browser = await chromium.launch({ headless: true, args:['--disable-lcd-text'] });
let preview, activeSource,activeSavedImages={};
const results = [], observations = [], documents = [];
const target = values.consecutive ? Number(values.consecutive) : null;
if (target !== null && (!Number.isInteger(target) || target < 1)) throw new Error('Invalid consecutive target');
let streak = 0;
try {
  preview = await startPreview({app:true});
  const local = await browser.newContext({viewport:{width:1080,height:900},locale:'ja-JP',colorScheme:'light'});
  const control=values.visual?await local.newPage():null;
  if(control)await control.goto(preview.origin+'/app/');
  const animated=values.visual?createImageNormalizer(control):null;
  await local.route('**/*',async route=>{
    const url=route.request().url();
    if(url.startsWith(preview.origin+'/')) {
      if(values.visual && url===preview.origin+'/app/') {const response=await route.fetch();const headers=response.headers();delete headers['content-security-policy'];return route.fulfill({response,headers});}
      return route.continue();
    }
    if(values.visual && new URL(url).hostname==='document.mdv.invalid' && activeSource) {
      if(/^\/qiita-(?:card-)?image\//.test(new URL(url).pathname)) {
        const saved=activeSavedImages[new URL(url).pathname.split('/').pop()];
        if(!saved)return route.fulfill({status:404,body:''});
        return animated.serve(route,url,{status:200,headers:{'content-type':saved.contentType},body:Buffer.from(saved.base64,'base64')});
      }
      const path=new URL(url).pathname;const raw=decodeURIComponent(path.slice(path.indexOf('/',1)+1));
      const target=new URL(raw,activeSource.markdownUrl);if(target.protocol!=='https:')return route.abort();
      try{return await animated.serve(route,target.href);}catch{return route.abort();}
    }
    if(values.visual && route.request().resourceType()==='image' && url.startsWith('https:'))return animated.serve(route);
    return route.abort();
  });
  let page = await local.newPage(); await page.goto(preview.origin+'/app/'); await page.waitForFunction(()=>window.mdv);
  for (const source of sources) {
    activeSource=source;
    activeSavedImages={};let savedQiitaImages={},imageManifest=null,savedQiitaCards={},cardManifest=null;
    const resultStart = results.length;
    const file = resolve(out, `${source.id}-capture.json`);
    let capture;
    if (refresh) {
      const context = await browser.newContext({ viewport: { width:1080,height:900 }, locale:'ja-JP', colorScheme:'light' });
      const blocked = [];
      await context.route('**/*', route => {
        const host = new URL(route.request().url()).hostname;
        if(values.visual && route.request().resourceType()==='image' && route.request().url().startsWith('https:'))return animated.serve(route);
        if(values.visual && route.request().resourceType()==='font' && route.request().url().startsWith('https:'))return route.continue();
        if (['qiita.com','cdn.qiita.com','cdnjs.cloudflare.com','github.com','viewscreen.githubusercontent.com','github.githubassets.com','raw.githubusercontent.com'].includes(host)) return route.continue();
        blocked.push(host); return route.abort();
      });
      const live = await context.newPage();
      if(values.visual)await installArticleWidthNormalization(live,source.selector);
      let serverPage;
      if (values['server-pages']) {
        serverPage = JSON.parse(await readFile(resolve(values['server-pages'],source.id+'.json'),'utf8'));
        if(serverPage.url!==source.url || hash(serverPage.html)!==serverPage.hash) throw new Error('Server page source/hash mismatch');
        await live.route(source.url,route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:serverPage.html}),{times:1});
      }
      let response;
      for (let attempt=0; attempt<3; attempt++) {
        response = await live.goto(source.url, {waitUntil:'domcontentloaded'});
        if (response.ok() || ![429,500,502,503,504].includes(response.status())) break;
        console.log(`retry ${attempt+1}: ${source.id} HTTP ${response.status()}`);
        await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
      }
      let transport = serverPage ? 'saved-server-response' : 'browser-navigation';
      if (!response.ok()) {
        // Some public hosts reject Chromium navigation but serve the same URL to
        // fetch. Preserve the URL/origin and load the unmodified server response.
        let fetched;
        for (let attempt=0; attempt<6; attempt++) {
          fetched = await fetch(source.url+(source.mode==='github' && attempt%2?'?plain=0':''),{signal:AbortSignal.timeout(30000)});
          if (fetched.ok) break;
          await new Promise(resolve=>setTimeout(resolve,2000));
        }
        if (!fetched.ok) throw new Error(`${source.url}: HTTP ${response.status()} / fetch ${fetched.status}`);
        const html = await fetched.text();
        await live.route(source.url,route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html}),{times:1});
        await live.goto(source.url,{waitUntil:'domcontentloaded'});
        transport = 'fetch-document';
      }
      await live.locator(source.selector).waitFor(); await live.evaluate(()=>document.fonts.ready);
      // A dollar sign can be a price. Wait for the service's actual math
      // runtime rather than requiring a rendered equation for any '$' text.
      await live.waitForLoadState('load');
      const pendingMath = source.mode === 'qiita' && await live.locator(source.selector).evaluate(hasPendingQiitaMath);
      if (pendingMath || await live.evaluate(()=>!!document.querySelector('script[src*="mathjax" i]')))
        await live.waitForFunction(()=>!!window.MathJax?.startup?.document);
      if (pendingMath) await live.locator(source.selector+' mjx-container').first().waitFor({state:'attached'});
      await live.evaluate(async()=>{await window.MathJax?.startup?.promise; await document.fonts.ready;});
      if(values.visual)await waitForServiceDiagrams(live,source.selector);
      await live.mouse.move(0,0);
      const mdResponse = await context.request.get(source.markdownUrl);
      if (!mdResponse.ok()) throw new Error(`Markdown HTTP ${mdResponse.status()}`);
      const downloaded = await mdResponse.text();
      const markdown = source.mode === 'qiita' ? downloaded.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '') : downloaded;
      const body = live.locator(source.selector);
      const serviceHtmlHash=hash(await body.innerHTML());
      const serviceAdjustments=source.mode==='github'&&values['exclude-service-issue-links']?await restoreAuthoredIssueReferences(live,source.selector,markdown,source.url):[];
      const html = await body.innerHTML();
      const typography = await body.evaluate(node=>{const s=getComputedStyle(node);return {fontSize:s.fontSize,lineHeight:s.lineHeight,fontFamily:s.fontFamily};});
      capture = { ...source, transport, serverPageHash:serverPage?.hash, capturedAt:serverPage?.capturedAt || new Date().toISOString(), browser:browser.version(), markdown, html, serviceHtmlHash, serviceAdjustments, excludeServiceIssueLinks:values['exclude-service-issue-links'],
        markdownHash:hash(markdown), htmlHash:hash(html), typography, features:await body.evaluate(features, emojiLookup),
        blockedHosts:[...new Set(blocked)], scope:'public article/repository HTML contracts; third-party assets blocked; not complete visual equivalence' };
      if(values.visual) {
        capture.visualResources=await isolateArticle(live,source.selector);
        capture.animatedImages=animated.describe(capture.visualResources);
        capture.animationPolicy='first-frame-and-source-sha256-v1';
        capture.boxModelPolicy='border-box-v2';
        capture.cardPolicy='metadata-and-decoded-thumbnails-v1';
        capture.fontRasterPolicy='grayscale-text-v1';
        capture.chromePolicy='outside-article-observed-v1';
        capture.visual=await captureVisual(live,source.selector,resolve(out,source.id+'-reference'));
        capture.hover=await captureHover(live,source.selector,resolve(out,source.id+'-reference-hover'));
        capture.scope='Normalized 800px article before service initialization; DOM, computed styles, whole-article and per-block rasters; mandatory normal/hover/anchor-hover captures with gutter, per hover.coverage; images/diagrams must render; site chrome/copy controls excluded; GIF frame zero plus complete source SHA-256 for visible theme images'+(values['exclude-service-issue-links']?'; user-approved exception: server issue/PR enrichment reversed to authored prose':'');
      }
      await writeFile(file,JSON.stringify(capture,null,2)+'\n');
      await body.screenshot({path:resolve(out,`${source.id}-live.png`)}); await context.close();
    } else capture = JSON.parse(await readFile(file,'utf8'));
    if (capture.url !== source.url || capture.markdownUrl !== source.markdownUrl || capture.mode !== source.mode ||
        capture.markdownHash !== hash(capture.markdown) || capture.htmlHash !== hash(capture.html)) throw new Error('Capture source/hash mismatch');
    if(!!capture.excludeServiceIssueLinks!==values['exclude-service-issue-links'])throw Error('Comparison issue-reference policy changed: refresh required');
    if(values.visual&&capture.hover?.policy!==hoverPolicy)throw Error('Missing current hover reference capture: refresh required');
    if(values.visual&&capture.fontRasterPolicy!=='grayscale-text-v1')throw Error('Font raster policy changed: refresh required');
    if(values.visual&&capture.html.includes('https://qiita.com/embed-contents/link-card')&&capture.cardPolicy!=='metadata-and-decoded-thumbnails-v1')throw Error('Card readiness policy changed: refresh required');
    const original = await preview.engines[source.mode].render(capture.markdown);
    if(values.visual&&values['qiita-image-snapshots']&&source.mode==='qiita'&&capture.visualResources.some(r=>new URL(r.src).hostname==='qiita-user-contents.imgix.net')) {
      await page.evaluate(options=>window.mdv.render(options),{engine:'original',mode:'qiita',markdown:capture.markdown,allowRemoteImages:false,original:{...original,metadata:preview.engines.qiita.metadata}});
      const sources=await page.evaluate(()=>window.mdv.getImageSources()),userAgent=await page.evaluate(()=>navigator.userAgent);
      const document=resolve(out,source.id+'-snapshot.md'),job=resolve(out,source.id+'-image-job.json'),result=resolve(out,source.id+'-images.json');
      await writeFile(document,capture.markdown);await writeFile(job,JSON.stringify({document,article:source.url,sources,userAgent}));
      console.log('Importing saved Qiita images: '+source.id);
      await runFile('dotnet',['run','--project',resolve(repositoryRoot,'tools/Mdv.QiitaImageProbe'),'-p:NuGetAudit=false','--',job,result],{cwd:repositoryRoot,timeout:900000});
      const saved=JSON.parse(await readFile(result,'utf8'));imageManifest=saved.manifest;activeSavedImages=saved.images;
      savedQiitaImages=Object.fromEntries(imageManifest.images.map(i=>[i.originalUrl,'https://document.mdv.invalid/qiita-image/'+i.hash]));
    }
    if(values.visual&&values['qiita-card-snapshots']&&source.mode==='qiita') {
      await page.evaluate(options=>window.mdv.render(options),{engine:'original',mode:'qiita',markdown:capture.markdown,allowRemoteImages:false,original:{...original,metadata:preview.engines.qiita.metadata}});
      const sources=await page.evaluate(()=>window.mdv.getCardSources()),userAgent=await page.evaluate(()=>navigator.userAgent);
      if(sources.length) {
        const document=resolve(out,source.id+'-snapshot.md'),job=resolve(out,source.id+'-card-job.json'),result=resolve(out,source.id+'-cards.json');
        await writeFile(document,capture.markdown);await writeFile(job,JSON.stringify({document,sources,userAgent}));
        console.log('Importing saved Qiita cards: '+source.id);
        await runFile('dotnet',['run','--project',resolve(repositoryRoot,'tools/Mdv.QiitaCardProbe'),'-p:NuGetAudit=false','--',job,result],{cwd:repositoryRoot,timeout:900000});
        const saved=JSON.parse(await readFile(result,'utf8'));cardManifest=saved.manifest;Object.assign(activeSavedImages,saved.images);
        savedQiitaCards=Object.fromEntries(cardManifest.cards.map(c=>[c.url,{title:c.title,origin:c.origin,image:c.image?'https://document.mdv.invalid/qiita-card-image/'+c.image.hash:null}]));
      }
    }
    for (const engine of ['original','legacy']) {
      if(values.visual){await page.close();page=await local.newPage();await page.goto(preview.origin+'/app/');await page.waitForFunction(()=>window.mdv);}
      await page.evaluate(options=>window.mdv.render(options), {engine,mode:source.mode,markdown:capture.markdown,allowRemoteImages:values.visual,resetScroll:true,
        savedQiitaImages,savedQiitaCards,original:{...original,metadata:preview.engines[source.mode].metadata}});
      await page.mouse.move(0,0);
      const prepared = await page.locator('#document').evaluate(features, emojiLookup);
      for (const key of Object.keys(prepared)) {
        const expected = capture.features[key], actual = prepared[key];
        if (expected === undefined) throw new Error('Capture feature version changed: refresh required');
        results.push({id:`${source.id}-${engine}-${key}`,mode:source.mode,engine,
          status:JSON.stringify(expected)===JSON.stringify(actual)?'match':'different',
          referenceKind:'captured-service-contract',serviceStatus:'partial',source:source.url,capturedAt:capture.capturedAt,expected,actual});
      }
      const typography = await page.locator('#document').evaluate(n=>{const s=getComputedStyle(n);return {fontSize:s.fontSize,lineHeight:s.lineHeight,fontFamily:s.fontFamily};});
      results.push({id:`${source.id}-${engine}-typography`,mode:source.mode,engine,status:JSON.stringify(typography)===JSON.stringify(capture.typography)?'match':'different',referenceKind:'captured-service-style',serviceStatus:'partial',expected:capture.typography,actual:typography});
      if(values.visual) {
        if(!capture.visual)throw Error('Missing reference visual capture; refresh required');
        if(capture.boxModelPolicy!=='border-box-v2')throw Error('Article box model policy changed: refresh required');
        const resources=await isolateArticle(page,'#document');
        const actualAnimations=animated.describe(resources);
        if(actualAnimations.length&&capture.animationPolicy!=='first-frame-and-source-sha256-v1')throw Error('GIF comparison policy changed: refresh required');
        results.push({id:`${source.id}-${engine}-animatedImages`,mode:source.mode,engine,status:JSON.stringify(capture.animatedImages||[])===JSON.stringify(actualAnimations)?'match':'different',expected:capture.animatedImages||[],actual:actualAnimations});
        const actual=await captureVisual(page,'#document',resolve(out,`${source.id}-${engine}-visual`));
        const comparison=await compareVisual(control,capture.visual,actual,resolve(out,source.id+'-reference'),resolve(out,`${source.id}-${engine}-visual`));
        await writeFile(resolve(out,`${source.id}-${engine}-visual.json`),JSON.stringify({resources,snapshot:actual,...comparison},null,2)+'\n');
        results.push({id:`${source.id}-${engine}-visual`,mode:source.mode,engine,status:comparison.status,referenceKind:'normalized-service-visual',source:source.url,images:{reference:`${source.id}-reference.png`,actual:`${source.id}-${engine}-visual.png`,difference:`${source.id}-${engine}-visual-diff.png`},...comparison});
        const hover=await captureHover(page,'#document',resolve(out,`${source.id}-${engine}-hover`));
        const hoverComparison=await compareHover(capture.hover,hover,resolve(out,source.id+'-reference-hover'),resolve(out,`${source.id}-${engine}-hover`));
        await writeFile(resolve(out,`${source.id}-${engine}-hover.json`),JSON.stringify({capture:hover,...hoverComparison},null,2)+'\n');
        results.push({id:`${source.id}-${engine}-hover`,mode:source.mode,engine,referenceKind:'service-hover-raster',source:source.url,...hoverComparison});
      }
      await page.screenshot({path:resolve(out,`${source.id}-${engine}.png`),fullPage:true});
    }
    const differences = results.slice(resultStart).filter(r=>r.status!=='match').map(r=>r.id);
    streak = differences.length ? 0 : streak + 1;
    documents.push({id:source.id,url:source.url,status:differences.length?'different':'match',differences,streak});
    console.log(`${source.id}: ${differences.length} differences; streak ${streak}/${target || '-'}`);
    observations.push({mode:source.mode,url:source.url,capturedAt:capture.capturedAt,markdownHash:capture.markdownHash,htmlHash:capture.htmlHash,
      typography:capture.typography,blockedHosts:capture.blockedHosts,scope:capture.scope,qiitaImagePolicy:values['qiita-image-snapshots']?'Optional saved service-image mode, imported and read by production Core code; unmatched sources retain normal handling.':'Authored images',imageManifest,fontRasterPolicy:capture.fontRasterPolicy,qiitaCardPolicy:values['qiita-card-snapshots']?'Optional saved service cards via production importer and verified archive; no card exclusion.':'Offline URL fallback',cardManifest,boxModelPolicy:capture.boxModelPolicy,hoverPolicy:capture.hover?.policy,hoverCoverage:capture.hover?.coverage,hoverExcluded:capture.hover?.excluded,animationPolicy:capture.animationPolicy,animatedImages:capture.animatedImages,serviceHtmlHash:capture.serviceHtmlHash,serviceAdjustments:capture.serviceAdjustments,excludeServiceIssueLinks:!!capture.excludeServiceIssueLinks});
    if (target && (differences.length || streak >= target)) break;
  }
  const report={description:values.visual?'本家本文幅800px・ライトテーマでのラスタ画像、描画CSS、DOM・操作契約の照合。全表示条件・全入力の保証ではない。':'公開実サイトの保存した抽出入力の両エンジンに対する部分的なDOM・操作契約の照合。全表示・全入力のサービス互換性とは別。',metadata:{rendererManifestHash:hash(await readFile(resolve(repositoryRoot,'src/Mdv.App/Renderer/bundle-manifest.json'),'utf8')),generatedAt:new Date().toISOString(),seed:selectionSeed,offset:selectionOffset,observations},progress:{target,streak,complete:target!==null&&streak>=target,documents},summary:summarize(results),results};
  await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n'); await writeFile(resolve(out,'index.html'),reportHtml(report));
  if (target && !report.progress.complete) process.exitCode=2;
  console.log(JSON.stringify(report.summary)); for(const r of results) console.log(`${r.status}: ${r.id}`);
} catch(error) {
  await writeFile(resolve(out,'report.json'),JSON.stringify({status:'unverified',error:String(error),source:activeSource,
    metadata:{generatedAt:new Date().toISOString(),seed:selectionSeed,offset:selectionOffset,observations},
    progress:{target,streak:0,complete:false,documents},results},null,2)+'\n');
  throw error;
} finally {await preview?.close();await browser.close();}
