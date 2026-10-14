import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {isolateArticle,captureVisual,compareVisual} from '../../../scripts/upstream/visual-probe.mjs';
import {captureHover,compareHover} from '../../../scripts/upstream/hover-probe.mjs';

const fixture=`<style>
body{background:white}article{font:17px Arial}h2{position:relative}
.anchor{position:absolute;left:-33px;top:0;padding:8px;opacity:0;color:#666}
h2:hover .anchor{opacity:1}.fa-link{font:18px Arial;position:relative;z-index:0}
.fa-link::before{content:'*'}.fa-link:hover::after{content:'';position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:34px;height:34px;background:#edeeee;border-radius:50%;z-index:-1}
p a:hover{color:red}summary:hover{background:#eee}
</style><article><h2 id="title"><a class="anchor" href="#title"><i class="fa-link"></i></a>Heading</h2><p><a href="https://example.com">Link</a></p><details><summary>Details</summary>Closed content</details></article>`;

test('hover comparison catches defects invisible in a static raster, including the left gutter and icon pseudo-element',async({browser})=>{
  test.setTimeout(60000);
  const dir=await mkdtemp(join(tmpdir(),'mdv-hover-')),a=await browser.newPage({viewport:{width:1080,height:900}}),b=await browser.newPage({viewport:{width:1080,height:900}});
  try {
    for(const page of [a,b]){await page.setContent(fixture);await isolateArticle(page,'article');}
    const expected=await captureHover(a,'article',join(dir,'reference'));
    expect(expected.targets.map(n=>n.kind)).toEqual(['H2','A','SUMMARY']);
    expect(expected.states).toHaveLength(7);
    const same=await captureHover(b,'article',join(dir,'same'));
    expect((await compareHover(expected,same,join(dir,'reference'),join(dir,'same'))).status).toBe('match');
    await b.addStyleTag({content:'.fa-link{font-size:28px}'});
    const staticA=await captureVisual(a,'article',join(dir,'static-a')),staticB=await captureVisual(b,'article',join(dir,'static-b'));
    expect((await compareVisual(null,staticA,staticB,join(dir,'static-a'),join(dir,'static-b'))).status).toBe('match');
    const badSize=await captureHover(b,'article',join(dir,'bad-size'));
    const sizeDiff=await compareHover(expected,badSize,join(dir,'reference'),join(dir,'bad-size'));
    expect(sizeDiff.status).toBe('different');
    expect(sizeDiff.differences.some(n=>n.state==='hover'&&n.raster.changedPixels>0)).toBe(true);
    await b.addStyleTag({content:'.fa-link{font-size:18px}.fa-link:hover::after{background:transparent}'});
    const badRing=await captureHover(b,'article',join(dir,'bad-ring'));
    const ringDiff=await compareHover(expected,badRing,join(dir,'reference'),join(dir,'bad-ring'));
    expect(ringDiff.differences.map(n=>n.state)).toEqual(['anchor-hover']);
    expect(ringDiff.differences[0].expected.icon.after.css.backgroundColor).not.toBe(ringDiff.differences[0].actual.icon.after.css.backgroundColor);
    await b.addStyleTag({content:'.fa-link:hover::after{background:#edeeee}p a:hover{color:blue}'});
    const badLink=await captureHover(b,'article',join(dir,'bad-link'));
    expect((await compareHover(expected,badLink,join(dir,'reference'),join(dir,'bad-link'))).differences.some(n=>n.target.kind==='A'&&n.state==='hover')).toBe(true);
    await b.addStyleTag({content:'p a:hover{color:red}.anchor{display:none}'});
    const missing=await captureHover(b,'article',join(dir,'missing'));
    expect((await compareHover(expected,missing,join(dir,'reference'),join(dir,'missing'))).differences.some(n=>n.actualExercised===false)).toBe(true);
    await expect(compareHover({},same,'unused','unused')).rejects.toThrow('refresh required');
    expect(await b.locator('article').evaluate(n=>n.style.left)).toBe('0px');
  } finally {await a.close();await b.close();await rm(dir,{recursive:true,force:true});}
});

test('hover capture exercises GitHub sibling anchors and images taller than the viewport',async({page})=>{
  const dir=await mkdtemp(join(tmpdir(),'mdv-hover-scroll-'));
  try {
    await page.setContent(`<style>.markdown-heading{position:relative}.anchor{position:absolute;left:-28px;top:0;visibility:hidden}.markdown-heading:hover .anchor{visibility:visible}img:hover{outline:2px solid red}</style><article><img alt="Tall image" width="100" height="1400" src="data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="1400"/>').toString('base64')}"><div class="markdown-heading"><h1>Bottom heading</h1><a class="anchor" href="#x"><svg width="16" height="16"><rect width="16" height="16"/></svg></a></div></article>`);
    await isolateArticle(page,'article');
    const actual=await captureHover(page,'article',join(dir,'capture'));
    expect(actual.targets.map(n=>n.kind)).toEqual(['IMG','H1']);
    expect(actual.states.every(n=>n.exercised)).toBe(true);
    expect(actual.states.find(n=>n.state==='anchor-hover').measurement.icon.visible).toBe(true);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('standalone heading SVG comparison still rejects changed paths, hover paint and hit areas',async({browser})=>{
  const dir=await mkdtemp(join(tmpdir(),'mdv-hover-svg-'));
  const pages=await Promise.all([0,1].map(()=>browser.newPage({viewport:{width:1080,height:900}})));
  try {
    for(const p of pages){await p.setContent('<style>body{background:white}h2{position:relative}.anchor{position:absolute;left:-28px;top:0;opacity:0}h2:hover .anchor{opacity:1}svg{fill:#222}</style><article><h2>Heading<a class="anchor" href="#x"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 1H15V15Z"/></svg></a></h2></article>');await isolateArticle(p,'article');}
    const [a,b]=pages,expected=await captureHover(a,'article',join(dir,'reference'));
    expect(expected.states.filter(s=>s.normalizedSvg)).toHaveLength(2);
    const compare=async name=>compareHover(expected,await captureHover(b,'article',join(dir,name)),join(dir,'reference'),join(dir,name));
    expect((await compare('same')).status).toBe('match');
    await b.locator('path').evaluate(n=>n.setAttribute('d','M1 1V15H15Z'));
    expect((await compare('path')).differences.some(d=>d.raster.changedPixels>0)).toBe(true);
    await b.locator('path').evaluate(n=>n.setAttribute('d','M1 1H15V15Z'));
    const style=await b.addStyleTag({content:'h2:hover svg{fill:red}'});
    expect((await compare('paint')).differences.some(d=>d.raster.changedPixels>0)).toBe(true);
    await style.evaluate(n=>n.remove());
    await b.addStyleTag({content:'.anchor{padding-right:3px}'});
    expect((await compare('hit-area')).differences.some(d=>!d.geometryMatch)).toBe(true);
    expect(await b.locator('svg').getAttribute('style')||'').toBe('');
  } finally {await Promise.all(pages.map(p=>p.close()));await rm(dir,{recursive:true,force:true});}
});
