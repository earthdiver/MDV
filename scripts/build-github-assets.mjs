import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const packages = fileURLToPath(new URL('../node_modules/', import.meta.url));

// Official published assets only; retain their declarations and record exact inputs.
export async function buildGithubAssets(out) {
  await mkdir(join(out, 'github'), {recursive:true});
  const files = [
    ...['primitives','base','markdown','buttons'].map(name => `@primer/css/dist/${name}.css`),
    '@primer/primitives/dist/css/base/typography/typography.css',
    ...['light','dark'].map(name => `@primer/primitives/dist/css/functional/themes/${name}.css`),
  ];
  const sources = await Promise.all(files.map(async path => {
    const text = await readFile(join(packages, path), 'utf8');
    return {path, text, sha256:createHash('sha256').update(text).digest('hex')};
  }));
  const light = sources.at(-2).text;
  const printLight = light.replace(/\[data-color-mode="(?:light|auto)"\]\[data-light-theme="light"\]/g, ':root[data-color-mode]');
  await writeFile(join(out, 'github/primer.css'), sources.map(s => s.text).join('\n') + `\n/* MDV print adapter: original light theme declarations, selected for print. */\n@media print {${printLight}\n}\n`);
  await writeFile(join(out, 'github/sources.json'), JSON.stringify({
    packages:Object.fromEntries(await Promise.all(['@primer/css','@primer/primitives','@primer/octicons','@github/clipboard-copy-element'].map(async name => [name, JSON.parse(await readFile(join(packages, name, 'package.json'), 'utf8')).version]))),
    styles:sources.map(({text,...source}) => source),
    adaptations:['Light theme selector also applies when printing a dark document.','Only the required Octicons SVGs are bundled; paths are unchanged.'],
  }, null, 2)+'\n');
}
