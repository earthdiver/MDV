import {createHash} from 'node:crypto';
import { buildGithubAssets } from './build-github-assets.mjs';
import { build } from 'esbuild';
import { mkdir, cp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const edition = process.argv[2] || 'dual';
if (!['dual', 'custom', 'upstream'].includes(edition)) throw new Error('Edition must be dual, custom or upstream');
const custom = edition !== 'upstream', upstream = edition !== 'custom';
const out = resolve(process.argv[3] || 'src/Mdv.App/Renderer');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const result = await build({
  entryPoints: ['renderer/browser.mjs'], bundle: true, format: 'esm', splitting: true,
  outdir: out, entryNames: 'viewer', chunkNames: 'chunks/[name]-[hash]',
  define: { __MDV_EDITION__: JSON.stringify(edition), __MDV_CUSTOM__: String(custom), __MDV_UPSTREAM__: String(upstream) },
  loader: { '.svg': 'text', '.wasm':'binary', '.scm':'text' }, target: 'es2022', minify: true, legalComments: 'linked', metafile: true,
});
const inputs = Object.keys(result.metafile.inputs);
if (!custom && inputs.includes('renderer/markdown.mjs')) throw new Error('Custom converter leaked into upstream edition');
if (!upstream && inputs.includes('renderer/upstream-display.mjs')) throw new Error('Upstream converter leaked into custom edition');
await buildGithubAssets(out);
for (const name of ['github-host.css', 'qiita.css', 'qiita-host.css', 'diagram.css']) await cp(join('renderer', name), join(out, name));
let html = await readFile('renderer/index.html', 'utf8');
if (!custom) html = html.replace(/.*href="katex.min.css".*\n/, '');
await writeFile(join(out, 'index.html'), html);
await cp('third_party/font-awesome', join(out, 'qiita/font-awesome'), { recursive: true });
await cp('node_modules/mathjax/es5', join(out, 'mathjax'), { recursive: true });
if (custom) {
  await cp('node_modules/katex/dist/katex.min.css', join(out, 'katex.min.css'));
  await cp('node_modules/katex/dist/fonts', join(out, 'fonts'), { recursive: true });
}
// License notices follow the packages actually bundled in this edition.
// Mermaid itself uses KaTeX, including in the upstream edition.
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const packages = new Set(inputs.flatMap(input => {
  const match = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
  return match ? [match[1]] : [];
}));
for (const name of ['@primer/css', '@primer/primitives', '@primer/octicons']) packages.add('node_modules/' + name);
packages.add('node_modules/mathjax');
const shellLicense=await readFile('third_party/atom-shellscript/LICENSE.md','utf8');
const licenses = ['atom/language-shellscript 35dc1aa1371ab75ece08fd0837330eb62e1f9da9\n'+shellLicense,'Qiita article presentation: independently implemented by MDV (MIT).\nFont Awesome 4.7.0 by Dave Gandy: CSS MIT; font SIL OFL 1.1. See qiita/font-awesome/.'];
for (const path of [...packages].sort()) {
  const metadata = lock.packages[path];
  if (!metadata) throw new Error(`Missing locked package: ${path}`);
  const names = await readdir(path);
  const files = names.filter(name => /^(licen[sc]e|copying|notice)([.-]|$)/i.test(name));
  const texts = await Promise.all(files.map(name => readFile(join(path, name), 'utf8')));
  if (!texts.length && ['node_modules/format', 'node_modules/remark-math'].includes(path))
    texts.push(await readFile(join('third_party', path.slice('node_modules/'.length), 'LICENSE'), 'utf8'));
  if (!texts.length) throw new Error(`Missing license text: ${path}`);
  licenses.push(`${path.replace(/^node_modules\//, '')} ${metadata.version}\n${metadata.license || ''}\n${texts.join('\n')}`);
}
await writeFile(join(out, 'THIRD-PARTY-NOTICES.txt'), licenses.join('\n\n' + '='.repeat(72) + '\n\n'));
// Bind comparison evidence to asset bytes, not only the list of source paths.
const assetHashes={};
async function hashAssets(directory,prefix='') {
  for(const entry of (await readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const name=prefix+entry.name,path=join(directory,entry.name);
    if(entry.isDirectory())await hashAssets(path,name+'/');
    else assetHashes[name]=createHash('sha256').update(await readFile(path)).digest('hex');
  }
}
await hashAssets(out);
await writeFile(join(out,'bundle-manifest.json'),JSON.stringify({edition,inputs,assetHashes},null,2)+'\n');
console.log(`${edition} renderer and licenses: ${out}`);
