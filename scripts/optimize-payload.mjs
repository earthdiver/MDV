import { readdir, readFile, stat, rm, writeFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';

// Operate on the staging copy only, never on the installed Ruby or gem source.
const root = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage: node scripts/optimize-payload.mjs PAYLOAD [--apply] [--report=FILE]');
for (const file of ['Renderer/index.html', 'WebView2Runtime/msedgewebview2.exe', 'LICENSE']) await stat(join(root, file));
const apply = process.argv.includes('--apply');
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected payload symlink: ${path}`);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile()) files.push({ path: relative(root, path).replaceAll('\\', '/'), bytes: (await stat(path)).size });
  }
}
await walk(root);
const hasOriginal = files.some(file => file.path === 'OriginalEngines/worker.rb');
let rubyAbi;
if (hasOriginal) {
  // Licenses collected before pruning include those in removed documentation.
  await stat(join(root, 'OriginalEngines/THIRD-PARTY-NOTICES.txt'));
  const configs = files.filter(file => /^OriginalEngines\/ruby\/lib\/ruby\/[^/]+\/[^/]+\/rbconfig\.rb$/.test(file.path));
  if (configs.length !== 1) throw new Error('Expected one Ruby runtime configuration');
  const config = await readFile(join(root, configs[0].path), 'utf8');
  const major = config.match(/CONFIG\["MAJOR"\] = "(\d+)"/)?.[1];
  const minor = config.match(/CONFIG\["MINOR"\] = "(\d+)"/)?.[1];
  if (!major || !minor) throw new Error('Cannot identify bundled Ruby ABI');
  rubyAbi = `${major}.${minor}`;
}
function reason(path) {
  if (/^OriginalEngines\/ruby\/share\/(doc|ri)\//.test(path)) return 'Ruby manuals';
  if (/^OriginalEngines\/ruby\/include\//.test(path) || /^OriginalEngines\/ruby\/lib\/[^/]+\.a$/.test(path) || /^OriginalEngines\/ruby\/lib\/pkgconfig\//.test(path)) return 'Ruby development headers and import libraries';
  if (/^OriginalEngines\/(gems\/ruby|ruby\/lib\/ruby\/gems)\/[^/]+\/cache\/[^/]+\.gem$/.test(path)) return 'Gem installation archives';
  const native = path.match(/^OriginalEngines\/gems\/ruby\/[^/]+\/gems\/(?:commonmarker|nokogiri)-[^/]+\/lib\/(?:commonmarker|nokogiri)\/(\d+\.\d+)\//);
  if (native && rubyAbi && native[1] !== rubyAbi) return 'Native gems for other Ruby ABIs';
  if (/^OriginalEngines\/gems\/.+\.(o|a|pdb)$/.test(path)) return 'Native gem build artifacts';
  // The app loads tex-svg-full.js. Keep all lazy-loaded components, TeX
  // extensions, accessibility resources and fonts; omit alternative bundles.
  if (/^Renderer\/mathjax\/(mml-chtml|mml-svg|tex-chtml-full-speech|tex-chtml-full|tex-chtml|tex-mml-chtml|tex-mml-svg|tex-svg)\.js$/.test(path)) return 'Unused MathJax combined entry points';
}
const removed = files.flatMap(file => {
  const why = reason(file.path);
  return why ? [{ ...file, reason: why }] : [];
});
const groups = {};
for (const file of removed) {
  groups[file.reason] ??= { files: 0, bytes: 0 };
  groups[file.reason].files++;
  groups[file.reason].bytes += file.bytes;
}
const beforeBytes = files.reduce((sum, file) => sum + file.bytes, 0);
const removedBytes = removed.reduce((sum, file) => sum + file.bytes, 0);
// Never change any part of the vendor WebView2 distribution.
if (apply) for (const file of removed) await rm(join(root, file.path));
const report = { applied: apply, rubyAbi, beforeBytes, afterBytes: beforeBytes - removedBytes, removedBytes, beforeFiles: files.length, afterFiles: files.length - removed.length, groups, removed };
const reportPath = process.argv.find(arg => arg.startsWith('--report='))?.slice('--report='.length);
if (reportPath) await writeFile(resolve(reportPath), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, removed: undefined }, null, 2));
