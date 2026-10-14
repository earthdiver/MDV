import { readFile, writeFile } from 'node:fs/promises';
import { OriginalEngine } from './client.mjs';

const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i++) {
  if (!['--mode', '--input', '--output'].includes(args[i]) || !args[i + 1])
    throw new Error('Usage: npm run upstream:render -- --mode github|qiita --input document.md [--output result.json]');
  options[args[i].slice(2)] = args[++i];
}
if (!options.input || !options.mode) throw new Error('--input and --mode are required');
const source = await readFile(options.input, 'utf8');
const engine = await OriginalEngine.start(options.mode);
try {
  const result = await engine.render(source);
  const json = JSON.stringify({ metadata: engine.metadata, ...result }, null, 2) + '\n';
  if (options.output) await writeFile(options.output, json);
  else process.stdout.write(json);
} finally { engine.close(); }
