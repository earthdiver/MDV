import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { OriginalEngine, repositoryRoot } from './client.mjs';
import { loadHtmlCorpus, corpusRoot, hash, readJson } from '../../scripts/compatibility/corpus.mjs';
import { compareHtml, reportHtml, summarize } from '../../scripts/compatibility/compare.mjs';
import { renderMarkdown } from '../../renderer/markdown.mjs';

if (process.argv.length !== 2) throw new Error('This command takes no arguments');
const corpus = await loadHtmlCorpus();
const catalog = await readJson(resolve(corpusRoot, 'browser-cases.json'));
const cases = [...corpus.cases, ...catalog.cases.flatMap(test => test.modes.map(mode => ({
  ...test, id: `${test.id}-${mode}`, mode, suite: 'browser-input', referenceKind: 'missing-service-capture',
})))];
const output = resolve(repositoryRoot, 'artifacts/compatibility/original-engines');
await mkdir(output, { recursive: true });
const referenceResults = [], mdvResults = [], rendered = [];
const metadata = { generatedAt: new Date().toISOString(), node: process.version, platform: process.platform,
  engines: {}, timings: {}, sources: corpus.lock, uncoveredQiitaAssertions: corpus.uncovered,
  packageLockHash: hash(await readFile(resolve(repositoryRoot, 'package-lock.json'))),
  scope: 'Public libraries at fixed revisions; github.com/qiita.com deployment, styling and client rendering remain unverified' };
for (const mode of ['github', 'qiita']) {
  const started = performance.now();
  const engine = await OriginalEngine.start(mode);
  const startupMs = performance.now() - started;
  metadata.engines[mode] = engine.metadata;
  const elapsed = [];
  try {
    for (const test of cases.filter(test => test.mode === mode)) {
      try {
        const response = await engine.render(test.markdown);
        elapsed.push(response.elapsed_ms);
        rendered.push({ ...test, originalHtml: response.html, extracted: response.extracted, elapsedMs: response.elapsed_ms });
        const originalComparison = compareHtml(test.expectedHtml, response.html);
        referenceResults.push({ ...test, actualHtml: response.html, ...originalComparison });
        const mdv = renderMarkdown(test.markdown, { mode });
        mdvResults.push({ ...test, expectedHtml: response.html, actualHtml: mdv.html,
          upstreamExpectedHtml: test.expectedHtml, referenceKind: 'executed-public-implementation',
          ...compareHtml(response.html, mdv.html) });
      } catch (error) {
        const result = { ...test, status: 'error', error: String(error) };
        referenceResults.push(result); mdvResults.push(result);
      }
    }
  } finally { engine.close(); }
  elapsed.sort((a, b) => a - b);
  metadata.timings[mode] = { startupMs, samples: elapsed.length,
    renderMedianMs: elapsed[Math.floor(elapsed.length / 2)], renderP95Ms: elapsed[Math.min(elapsed.length - 1, Math.floor(elapsed.length * .95))],
    note: 'Warm Ruby render time; excludes transport, Mermaid/MathJax and UI. Small corpus inputs, not a performance guarantee.' };
}
for (const [name, results, description, actualLabel] of [
  ['upstream-vs-original', referenceResults, '上流の期待HTMLと、固定した原実装を実行したHTMLの比較。GFM仕様と公開ラッパーの既定設定は異なります。', '原実装 HTML'],
  ['mdv-vs-original', mdvResults, '固定した原実装を実行したHTMLと、現行MDVの最終HTMLの比較。実サイトの期待HTMLではありません。', 'MDV HTML'],
]) {
  const report = { schemaVersion: 1, description, actualLabel, metadata, summary: summarize(results), results };
  await writeFile(resolve(output, `${name}.json`), JSON.stringify(report, null, 2) + '\n');
  await writeFile(resolve(output, `${name}.html`), reportHtml(report));
  console.log(`${name}: ${JSON.stringify(report.summary)}`);
}
await writeFile(resolve(output, 'renders.json'), JSON.stringify({ schemaVersion: 1, metadata, results: rendered }, null, 2) + '\n');
// Specification differences are observations. Failing the original implementation's
// own complete assertions or losing any request is a broken prototype/check.
const failures = referenceResults.filter(result => result.status === 'error' ||
  (result.referenceKind === 'upstream-assertion' && result.status !== 'match'));
if (failures.length) {
  console.error(`Original engine checks failed: ${failures.map(result => result.id).join(', ')}`);
  process.exitCode = 1;
}
console.log(`Reports: ${output}`);
