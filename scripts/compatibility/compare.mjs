import { unified } from 'unified';
import rehypeRaw from 'rehype-raw';
import { hash } from './corpus.mjs';

const parser = unified().use(rehypeRaw);
const structuralParents = new Set(['ul', 'ol', 'table', 'thead', 'tbody', 'tfoot', 'tr']);
const blockTags = new Set(['p', 'div', 'pre', 'blockquote', 'ul', 'ol', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'section', 'details']);

// Normalize HTML serialization only. Do not remove classes/IDs/URLs, collapse
// inline whitespace, strip code whitespace, or sanitize the reference HTML.
export function canonicalHtml(html) {
  const tree = parser.runSync({ type: 'root', children: [{ type: 'raw', value: html }] });
  function canonical(node, parent) {
    if (node.type === 'text' || node.type === 'comment') {
      if (node.type === 'text' && structuralParents.has(parent) && /^\s*$/.test(node.value)) return null;
      return { type: node.type, value: node.value };
    }
    const result = { type: node.type };
    if (node.tagName) result.tag = node.tagName;
    if (node.properties) result.attributes = Object.fromEntries(Object.entries(node.properties).sort(([a], [b]) => a.localeCompare(b)));
    if (node.children) {
      const blockRoot = node.type === 'root' && node.children.every(child => child.type === 'comment' ||
        (child.type === 'text' && /^\s*$/.test(child.value)) || (child.type === 'element' && blockTags.has(child.tagName)));
      result.children = node.children.filter(child => !(blockRoot && child.type === 'text' && /^\s*$/.test(child.value)))
        .map(child => canonical(child, node.tagName || node.type)).filter(Boolean);
    }
    // HTML template content is not in children.
    if (node.content) result.content = canonical(node.content, 'template');
    return result;
  }
  return JSON.stringify(canonical(tree), null, 2);
}

export function firstDifference(expected, actual) {
  const a = expected.split('\n'), b = actual.split('\n');
  const index = Array.from({ length: Math.max(a.length, b.length) }, (_, i) => i).find(i => a[i] !== b[i]);
  return index === undefined ? null : { line: index + 1, expected: a.slice(Math.max(0, index - 2), index + 4).join('\n'), actual: b.slice(Math.max(0, index - 2), index + 4).join('\n') };
}

export function compareHtml(expectedHtml, actualHtml) {
  if (typeof expectedHtml !== 'string') return { status: 'unverified', reason: 'No independently sourced expectation' };
  const expected = canonicalHtml(expectedHtml), actual = canonicalHtml(actualHtml);
  return { status: expected === actual ? 'match' : 'different',
    expectedHash: hash(expected), actualHash: hash(actual), difference: firstDifference(expected, actual) };
}

export function summarize(results) {
  const totals = { total: results.length, match: 0, different: 0, unverified: 0, error: 0 };
  for (const result of results) {
    if (!(result.status in totals) || result.status === 'total') throw new Error(`Unknown status: ${result.status}`);
    totals[result.status]++;
  }
  return totals;
}
export const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function reportHtml(report) {
  const e = escapeHtml;
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><title>MDV 互換性比較</title>
<style>body{font:16px system-ui;margin:2rem;max-width:1200px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f4f4f4;padding:1rem}summary{cursor:pointer;padding:.5rem}.different,.error{color:#a20}.unverified{color:#765000}img{max-width:100%;border:1px solid #aaa}section{display:grid;grid-template-columns:1fr 1fr;gap:1rem}</style>
<h1>MDV 互換性比較</h1><p>${e(report.description)}</p>
<p>一致 ${report.summary.match} / 差異 ${report.summary.different} / 未検証 ${report.summary.unverified} / 実行エラー ${report.summary.error} / 全 ${report.summary.total} 件</p>
<p>一致は記録した比較基準に対するものです。実サイトとの完全互換率ではありません。</p>
<details><summary>基準・実行環境・未検証範囲</summary><pre>${e(JSON.stringify(report.metadata, null, 2))}</pre></details>
${report.results.map(result => `<details><summary class="${e(result.status)}">${e(result.status)} — ${e(result.id)} (${e(result.mode || '')})</summary>
<pre>${e(JSON.stringify(result, null, 2))}</pre>
${result.markdown !== undefined ? `<pre>${e(result.markdown)}</pre>` : ''}
${result.expectedHtml !== undefined ? `<section><div>期待 HTML<pre>${e(result.expectedHtml)}</pre></div><div>${e(report.actualLabel || 'MDV HTML')}<pre>${e(result.actualHtml)}</pre></div></section>` : ''}
${result.images ? Object.entries(result.images).map(([label, path]) => `<p>${e(label)}<br><img alt="${e(label)}" src="${e(path)}"></p>`).join('') : ''}</details>`).join('\n')}</html>`;
}
