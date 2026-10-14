// Preserve successful server responses before launching a comparison browser.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { hash } from '../compatibility/corpus.mjs';
const {values} = parseArgs({options:{sources:{type:'string'},seed:{type:'string'},offset:{type:'string',default:'0'},count:{type:'string',default:'3'},out:{type:'string'}}});
if(!values.sources||!values.seed||!values.out)throw Error('--sources --seed --out required');
const sources=JSON.parse(await readFile(values.sources));
sources.sort((a,b)=>hash(values.seed+a.id).localeCompare(hash(values.seed+b.id)));
await mkdir(values.out,{recursive:true});
for(const source of sources.slice(Number(values.offset),Number(values.offset)+Number(values.count))){
  const url=new URL(source.url);
  if(url.protocol!=='https:'||!['github.com','qiita.com'].includes(url.hostname)||!/^[a-z0-9-]+$/.test(source.id))throw Error('Invalid source');
  let response;
  for(let attempt=0;attempt<4;attempt++){
    response=await fetch(source.url,{signal:AbortSignal.timeout(30000)});
    if(response.ok)break;
    await new Promise(r=>setTimeout(r,2000));
  }
  let html, branchVerified = false;
  if(!response.ok && source.branchUrl) {
    const branch = new URL(source.branchUrl);
    if(branch.origin!==url.origin || branch.pathname.split('/').slice(0,4).join('/')!==url.pathname.split('/').slice(0,4).join('/')) throw Error('Invalid branch URL');
    response=await fetch(source.branchUrl,{signal:AbortSignal.timeout(30000)});
    if(response.ok) {
      html=await response.text();
      let lines;
      function find(value) { if(!value||typeof value!=='object') return; if(Array.isArray(value.rawLines)) lines=value.rawLines; for(const child of Object.values(value)) if(typeof child==='object')find(child); }
      for(const match of html.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) {try{find(JSON.parse(match[1]));}catch{}}
      const raw=await fetch(source.markdownUrl,{signal:AbortSignal.timeout(30000)});
      if(!raw.ok || !lines || lines.join('\n').replace(/\n$/,'')!==(await raw.text()).replace(/\r\n/g,'\n').replace(/\n$/,'')) throw Error('Branch content differs from pinned Markdown');
      branchVerified=true;
    }
  }
  if(!response.ok)throw Error(`${source.url}: ${response.status}`);
  html ??= await response.text();
  await writeFile(resolve(values.out,source.id+'.json'),JSON.stringify({url:source.url,responseUrl:response.url,branchVerified,capturedAt:new Date().toISOString(),html,hash:hash(html)},null,2)+'\n');
  console.log('Captured '+source.id);
}
