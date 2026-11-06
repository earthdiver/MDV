// Inline markup may split a word or phrase into several text nodes. Keep those
// nodes together, but never join text across independent blocks or non-text UI.
const blockTags = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIV', 'DL', 'DT',
  'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4',
  'H5', 'H6', 'HEADER', 'HGROUP', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
  'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
]);
const excludedSelector = 'button, clipboard-copy, svg, math, .katex-mathml, script, style, br, hr, img';

function* textRuns(root) {
  let nodes = [];
  let node = root.firstChild;
  while (node) {
    const element = node.nodeType === 1;
    const excluded = element && node.matches(excludedSelector);
    if ((excluded || (element && blockTags.has(node.tagName))) && nodes.length) {
      yield nodes;
      nodes = [];
    }
    if (node.nodeType === 3 && node.textContent.length) nodes.push(node);
    if (!excluded && node.firstChild) {
      node = node.firstChild;
      continue;
    }
    // Walk iteratively so deeply nested document markup cannot exhaust the
    // JavaScript call stack. Leaving a block also ends its final inline run.
    while (node !== root) {
      if (node.nodeType === 1 && blockTags.has(node.tagName) && nodes.length) {
        yield nodes;
        nodes = [];
      }
      if (node.nextSibling) {
        node = node.nextSibling;
        break;
      }
      node = node.parentNode;
    }
    if (node === root) break;
  }
  if (nodes.length) yield nodes;
}

export function findTextRanges(root, query, limit = 10_000) {
  const ranges = [];
  if (!query || limit <= 0) return ranges;
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  for (const nodes of textRuns(root)) {
    let length = 0;
    const spans = nodes.map(node => {
      const start = length;
      length += node.textContent.length;
      return { node, start, end: length };
    });
    const text = nodes.map(node => node.textContent).join('');
    let index = 0;
    for (const match of text.matchAll(expression)) {
      // RegExp and DOM Range offsets both count UTF-16 code units, preserving
      // original offsets for emoji and Unicode case-insensitive matches.
      while (spans[index].end <= match.index) index++;
      const first = spans[index];
      const end = match.index + match[0].length;
      while (spans[index].end < end) index++;
      const last = spans[index];
      const range = root.ownerDocument.createRange();
      range.setStart(first.node, match.index - first.start);
      range.setEnd(last.node, end - last.start);
      ranges.push(range);
      if (ranges.length >= limit) return ranges;
    }
  }
  return ranges;
}
