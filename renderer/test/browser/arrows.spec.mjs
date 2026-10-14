import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const source=await readFile('renderer/test/fixtures/learning-plan.mmd','utf8');

for(const mode of ['github','qiita']) test(`${mode}: authored root class does not fill flowchart arrows`,async({page})=>{
 await page.goto('/');await page.waitForFunction(()=>window.mdv);
 for(const theme of ['light','dark']) {
  const result=await page.evaluate(options=>window.mdv.render(options),{mode,theme,markdown:'```mermaid\n'+source+'\n```'});
  expect(result.diagnostics).toEqual([]);
  for(const media of ['screen','print']) {
   await page.emulateMedia({media});
   const svg=page.locator('.diagram svg:visible');
   const edges=await svg.locator('path.flowchart-link').evaluateAll(nodes=>nodes.map(node=>{
    const style=getComputedStyle(node), id=node.getAttribute('marker-end')?.match(/#([^)]*)/)?.[1];
    return {fill:style.fill,stroke:style.stroke,length:node.getTotalLength(),marker:!!id && !!node.ownerSVGElement.querySelector(`[id="${id}"]`)};
   }));
   expect(edges).toHaveLength(20);
   for(const edge of edges) {
    expect(edge.fill,`${theme}/${media}`).toBe('none');
    expect(edge.stroke).not.toBe('rgb(127, 184, 191)');
    expect(edge.length).toBeGreaterThan(0);expect(edge.marker).toBe(true);
   }
   await expect(svg.locator('.node.root')).toHaveCount(1);
   const shape=svg.locator('.node.root .label-container').first();
   await expect(shape).toHaveCSS('fill','rgb(188, 226, 232)');
   await expect(shape).toHaveCSS('stroke','rgb(127, 184, 191)');
   await expect(svg.locator('.node.root text')).toHaveText('AIスキル学習プラン');
   await expect(svg.locator('.node.root text')).toHaveCSS('fill','rgb(11, 15, 16)');
   if(media==='screen') await svg.screenshot({path:`artifacts/flowchart-arrows/${mode}-${theme}-after.png`});
  }
 }
});

test('flowchart root class preserves explicit edge and nested cluster styles',async({page})=>{
 await page.goto('/');await page.waitForFunction(()=>window.mdv);
 const code=`flowchart LR
 subgraph Group[Group]
 direction TB
 A[Root]:::root --> B[Child]
 end
 Group --> C[Outside]
 classDef root fill:#BCE2E8,stroke:#7FB8BF;
 class Group root;
 linkStyle 0 stroke:#ff0000,stroke-width:4px;
 `;
 const result=await page.evaluate(markdown=>window.mdv.render({mode:'github',markdown}),'```mermaid\n'+code+'\n```');
 expect(result.diagnostics).toEqual([]);
 for(const media of ['screen','print']) {
  await page.emulateMedia({media});
  const svg=page.locator('.diagram svg:visible');
  await expect(svg.locator('.cluster.root > rect')).toHaveCSS('fill','rgb(188, 226, 232)');
  await expect(svg.locator('path.flowchart-link').first()).toHaveCSS('stroke','rgb(255, 0, 0)');
  await expect(svg.locator('path.flowchart-link').first()).toHaveCSS('stroke-width','4px');
 }
});
