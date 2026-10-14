// Public read-only candidate discovery. No credentials or article bodies saved here.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createHash, randomBytes } from 'node:crypto';
const {values} = parseArgs({options:{mode:{type:'string'},out:{type:'string'},exclude:{type:'string'},repos:{type:'string'}}});
if (!['github','qiita'].includes(values.mode) || !values.out) throw new Error('--mode github|qiita --out FILE required');
const requests = [];
async function get(url) {
  const response = await fetch(url,{signal:AbortSignal.timeout(30000),headers:{Accept:'application/json'}});
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const data = await response.json(); requests.push({url,fetchedAt:new Date().toISOString()}); return data;
}
const repos=values.repos?values.repos.split(','):['github/markup','markdown-it/markdown-it','increments/qiita-markdown'];
if(repos.some(repo=>!/^[-\w.]+\/[-\w.]+$/.test(repo)))throw Error('Invalid repository name');
let sources = [];
if (values.mode === 'github') {
  // Different projects; include all human-facing Markdown, not parser fixtures.
  for (const repo of repos) {
    const {default_branch:branch} = await get(`https://api.github.com/repos/${repo}`);
    const {sha} = await get(`https://api.github.com/repos/${repo}/commits/${branch}`);
    const tree = await get(`https://api.github.com/repos/${repo}/git/trees/${sha}?recursive=1`);
    if (tree.truncated) throw new Error(`Truncated tree: ${repo}`);
    for (const entry of tree.tree) {
      if (entry.type !== 'blob' || entry.size === 0 || !['100644','100755'].includes(entry.mode) || !/\.(md|markdown)$/i.test(entry.path) || /(?:^|\/)(?:tests?(?:[-_][^/]*)?|spec|benchmark|vendor|node_modules|fixtures)(?:\/|$)/.test(entry.path)) continue;
      const path = entry.path.split('/').map(encodeURIComponent).join('/');
      const id = `github-${createHash('sha256').update(repo+'/'+entry.path).digest('hex').slice(0,12)}`;
      sources.push({id,mode:'github',branchUrl:`https://github.com/${repo}/blob/${branch}/${path}`,url:`https://github.com/${repo}/blob/${sha}/${path}`,markdownUrl:`https://raw.githubusercontent.com/${repo}/${sha}/${path}`});
    }
  }
} else {
  const items = await get('https://qiita.com/api/v2/items?page=1&per_page=100');
  for (const item of items) sources.push({id:`qiita-${item.id}`,mode:'qiita',url:item.url,markdownUrl:item.url+'.md'});
}
const excludedIds = values.exclude ? JSON.parse(await readFile(values.exclude,'utf8')) : [];
if (!Array.isArray(excludedIds) || excludedIds.some(id=>typeof id!=='string')) throw Error('--exclude must contain an array of source IDs');
const excluded = sources.filter(source=>excludedIds.includes(source.id)).map(source=>source.id);
sources = sources.filter(source=>!excludedIds.includes(source.id));
await mkdir(dirname(resolve(values.out)),{recursive:true});
await writeFile(values.out,JSON.stringify(sources,null,2)+'\n');
const metadata={mode:values.mode,seed:randomBytes(16).toString('hex'),candidateCount:sources.length,excluded,requests,
  scope:values.mode==='github'?`All nonempty regular non-test Markdown files in pinned repository trees: ${repos.join(', ')}`:'Latest 100 public Qiita items at discovery time'};
await writeFile(values.out+'.metadata.json',JSON.stringify(metadata,null,2)+'\n');
console.log(JSON.stringify(metadata));
