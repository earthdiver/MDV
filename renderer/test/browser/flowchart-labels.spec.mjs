import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {OriginalEngine} from '../../../scripts/upstream/client.mjs';
const markdown='```mermaid\n'+await readFile('renderer/test/fixtures/learning-plan.mmd','utf8')+'\n```';
for(const mode of ['github','qiita'])test(`${mode}: styled flowchart labels match upstream on screen and print`,async({page})=>{
 test.skip(!process.env.MDV_RUBY,'Real engine requires Ruby');
 const original=await OriginalEngine.start(mode,{desktop:true});
 try {
  await page.goto('/');await page.waitForFunction(()=>window.mdv);
  const rendered={...await original.render(markdown),metadata:original.metadata};
  for(const theme of ['light','dark']){
   const captures=[];
   for(const engine of ['original','legacy']){
    const result=await page.evaluate(o=>window.mdv.render(o),{mode,theme,engine,markdown,original:rendered});
    expect(result.diagnostics).toEqual([]);
    const variants=[];
    for(const media of ['screen','print']){
     await page.emulateMedia({media});
     variants.push(await page.locator('.diagram svg:visible .nodeLabel').evaluateAll(nodes=>nodes.map(n=>{
      const s=getComputedStyle(n),r=n.getBoundingClientRect();
      return {text:n.textContent,color:s.color,weight:s.fontWeight,style:s.fontStyle,font:s.fontFamily,width:r.width,height:r.height};
     })));
    }
    captures.push(variants);
   }
   expect(captures[1][0]).toHaveLength(21);
   expect(captures[1]).toEqual(captures[0]);
   expect(captures[1][0][0]).toMatchObject({text:'AIスキル学習プラン',color:'rgb(11, 15, 16)',weight:'700'});
   expect(captures[1][0].some(n=>n.style==='italic')).toBe(true);
  }
 }finally{original.close();}
});

for(const mode of ['github','qiita'])test(`${mode}: label measurement survives zoom and article typography`,async({page})=>{
 await page.goto('/');await page.waitForFunction(()=>window.mdv);
 for(const zoom of [1,.9,1.1,1.25]){
  await page.evaluate(z=>document.body.style.zoom=z,zoom);
  const result=await page.evaluate(o=>window.mdv.render(o),{mode,markdown});
  expect(result.diagnostics).toEqual([]);
  const labels=await page.locator('.diagram-screen .node').evaluateAll(nodes=>nodes.map(n=>{
   const fo=n.querySelector('foreignObject'),div=fo?.firstElementChild;
   return {text:n.textContent,width:Number(fo?.getAttribute('width')),height:Number(fo?.getAttribute('height')),
    labelWidth:div?parseFloat(getComputedStyle(div).width):0,auto:div?getComputedStyle(div).textAutospace:'',display:getComputedStyle(n).display};
  }));
  const short=labels.find(n=>n.text==='平日: 60分');
  expect(short.auto).toBe('no-autospace');
  expect(Math.abs(short.width-short.labelWidth)).toBeLessThan(.05);
  expect(short.display).toBe('inline');
  if(mode==='github')expect(labels.find(n=>n.text==='成果物: ポートフォリオ1件').height).toBeGreaterThanOrEqual(48);
 }
});
