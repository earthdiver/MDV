import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderMarkdown } from '../../renderer/markdown.mjs';
import { corpusRoot, hash, loadHtmlCorpus, readJson } from './corpus.mjs';
import { compareHtml, reportHtml, summarize } from './compare.mjs';

const args = new Set(process.argv.slice(2));
for (const arg of args) if (!['--strict', '--check', '--record-baseline'].includes(arg)) throw new Error(`Unknown option: ${arg}`);
if (args.has('--check') && args.has('--record-baseline')) throw new Error('Cannot check and replace baseline together');
const corpus = await loadHtmlCorpus();
const results = corpus.cases.map(test => {
  try {
    const rendered = renderMarkdown(test.markdown, { mode: test.mode });
    return { ...test, actualHtml: rendered.html, diagnostics: rendered.diagnostics, ...compareHtml(test.expectedHtml, rendered.html) };
  } catch (error) { return { ...test, status: 'error', error: String(error) }; }
});
const profiles = await readJson(resolve(corpusRoot, 'profiles.json'));
const report = { schemaVersion: 1, description: '現行MDVの最終HTMLと、GFM仕様・上流の完全一致アサーションの比較。パーサー単独や実サイトとの一致を意味しません。',
  metadata: { generatedAt: new Date().toISOString(), node: process.version,
    packageLockHash: hash(await readFile('package-lock.json')), sources: corpus.lock, profiles,
    uncoveredQiitaAssertions: corpus.uncovered, scope: 'Final MDV HTML (including sanitizer/decorations) vs reference HTML' },
  summary: summarize(results), results };
const out = resolve('artifacts/compatibility/html');
await mkdir(out, { recursive: true });
await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
await writeFile(resolve(out, 'index.html'), reportHtml(report));
const baselinePath = resolve(corpusRoot, 'html-baseline.json');
const baseline = { schemaVersion: 1, purpose: 'MDV observation only; never a compatibility oracle',
  referenceConfigHash: hash(JSON.stringify({ profiles, sources: corpus.lock, normalization: 'conservative-dom-v1' })),
  corpusHash: hash(JSON.stringify(corpus.cases)), results: Object.fromEntries(results.map(result => [result.id,
    { status: result.status, actualHash: result.actualHash ?? null, expectedHash: result.expectedHash ?? null }])) };
if (args.has('--record-baseline')) {
  if (report.summary.error) throw new Error('Cannot record a baseline containing execution errors');
  await writeFile(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
}
if (args.has('--check')) {
  const previous = await readJson(baselinePath);
  if (JSON.stringify(previous) !== JSON.stringify(baseline)) {
    console.error('Compatibility observations changed. Review the report; update the observation baseline explicitly.');
    process.exitCode = 1;
  }
}
if (report.summary.error || (args.has('--strict') && results.some(result => result.status !== 'match'))) process.exitCode = 1;
console.log(JSON.stringify(report.summary));
console.log(`Report: ${out}/index.html`);
