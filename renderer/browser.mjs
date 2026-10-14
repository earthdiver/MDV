import { createDiagramMeasurement } from './diagram-layout.mjs';
import { mermaidRuntime } from './mermaid-runtime.mjs';
import { cleanSvg, diagramLabelSanitizer } from './diagram-svg.mjs';
import {prepareGithubDiagramViewport} from './github-diagram.mjs';
import { text as uiText, setLanguage } from './language.mjs';
import '@github/clipboard-copy-element';
import { githubIcon } from './github-icons.mjs';
import { selectStyles } from './service-styles.mjs';
import { applySavedQiitaCards } from './qiita-cards.mjs';
import { prepareServicePresentation } from './service-presentation.mjs';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';

const edition = __MDV_EDITION__;
const hasCustom = __MDV_CUSTOM__;
const hasUpstream = __MDV_UPSTREAM__;

const article = document.getElementById('document');
const codeSources = new WeakMap();
let generation = 0;
let currentOutline = [];
let originalAliases = {};
let searchRanges = [];
let searchIndex = -1;
let currentRequestId = 0;
let restoration;
const post = message => window.chrome?.webview?.postMessage(message);
const scrollableSelector = '.highlight, pre, table, .math-container, .math-display, .diagram';

function assignViewKeys() {
  const occurrences = new Map();
  const fingerprint = value => {
    let a = 2166136261, b = 5381;
    for (let i = 0; i < value.length; i++) {
      a = Math.imul(a ^ value.charCodeAt(i), 16777619);
      b = Math.imul(b, 33) ^ value.charCodeAt(i);
    }
    return `${value.length}-${a >>> 0}-${b >>> 0}`;
  };
  for (const item of article.querySelectorAll(`details, ${scrollableSelector}`)) {
    const content = item.tagName === 'DETAILS' ? item.querySelector(':scope > summary')?.textContent || ''
      : item.dataset.mdvSource || (item.tagName === 'PRE' ? item.querySelector('code') || item : item).textContent;
    const parent = item.parentElement.closest('details')?.dataset.mdvViewKey || '';
    const base = `${parent}/${item.tagName}/${item.id || fingerprint(content)}`;
    const occurrence = occurrences.get(base) || 0;
    occurrences.set(base, occurrence + 1);
    item.dataset.mdvViewKey = `${base}/${occurrence}`;
  }
}

function detailsState() {
  return Object.fromEntries([...article.querySelectorAll('details')].map(item => [item.dataset.mdvViewKey, item.open]));
}

function elementScrollState() {
  return Object.fromEntries([...article.querySelectorAll(scrollableSelector)]
    .filter(item => item.scrollLeft || item.scrollTop)
    .map(item => [item.dataset.mdvViewKey, { x: item.scrollLeft, y: item.scrollTop }]));
}

function captureView() {
  if (restoration && (Math.abs(window.scrollY - restoration.lastY) > 1 || Math.abs(window.scrollX - restoration.lastX) > 1))
    cancelRestoration();
  if (restoration) return restoration.view;
  const y = window.scrollY;
  let anchor = null;
  let offset = 0;
  for (const heading of article.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    if (!heading.checkVisibility()) continue;
    const target = heading.id ? heading : heading.querySelector('[id]');
    if (!target) continue;
    const top = target.getBoundingClientRect().top;
    if (top > 1) break;
    anchor = target.id;
    offset = -top;
  }
  return { x: window.scrollX, y, anchor, offset,
    ratio: y / Math.max(1, document.documentElement.scrollHeight - innerHeight),
    openDetails: [...article.querySelectorAll('details')].flatMap((item, index) => item.open ? [index] : []),
    detailsState: detailsState(), elementScroll: elementScrollState() };
}

function cancelRestoration() { restoration = null; }

function applyView(view) {
  for (const item of article.querySelectorAll(scrollableSelector)) {
    const position = view.elementScroll?.[item.dataset.mdvViewKey];
    if (position) { item.scrollLeft = position.x; item.scrollTop = position.y; }
  }
  const heading = view.anchor && document.getElementById(view.anchor);
  let y = view.y || 0;
  if (heading && article.contains(heading) && heading.checkVisibility())
    y = heading.getBoundingClientRect().top + window.scrollY + (view.offset || 0);
  else if (view.anchor)
    y = (view.ratio || 0) * Math.max(0, document.documentElement.scrollHeight - innerHeight);
  window.scrollTo({ left: view.x || 0, top: y, behavior: 'instant' });
  if (restoration) { restoration.lastX = window.scrollX; restoration.lastY = window.scrollY; }
}

function restoreView(view) {
  const details = [...article.querySelectorAll('details')];
  if (view.detailsState) {
    for (const item of details) {
      const open = view.detailsState[item.dataset.mdvViewKey];
      if (typeof open === 'boolean') item.open = open;
    }
  } else if (Array.isArray(view.openDetails)) {
    const open = new Set(view.openDetails);
    details.forEach((item, index) => { item.open = open.has(index); });
  }
  restoration = { view: { ...view, openDetails: details.flatMap((item, index) => item.open ? [index] : []), detailsState: detailsState() }, generation };
  applyView(view);
}

// Images and fonts can change layout after the first render. Keep the saved reading
// position until the reader starts interacting; do not fight their scrolling/search.
new ResizeObserver(() => {
  if (restoration?.generation === generation) applyView(restoration.view);
}).observe(article);
for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
  document.addEventListener(type, cancelRestoration, { capture: true, passive: true });

function scrollToAnchor(anchor) {
  cancelRestoration();
  let id;
  try { id = decodeURIComponent(anchor.replace(/^#/, '')); } catch { return false; }
  const candidates = [originalAliases[id], id, `mdv-heading-${id}`, `mdv-content-${id}`, `mdv-content-user-content-${id}`];
  for (const candidate of candidates) {
    const target = document.getElementById(candidate);
    if (!target || !article.contains(target)) continue;
    let parent = target.parentElement;
    while (parent) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; }
    target.scrollIntoView({ block: 'start' });
    return true;
  }
  return false;
}

function resolveImageSource(src, allowRemoteImages, savedImages = {}) {
  savedImages ??= {};
  src = src.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '');
  let canonical = src;
  try { canonical = new URL(src).href; } catch { /* Relative images keep their normal path. */ }
  if (Object.hasOwn(savedImages, canonical) && /^https:\/\/document\.mdv\.invalid\/(?:qiita|github)-image\/[a-f0-9]{64}$/.test(savedImages[canonical]))
    return savedImages[canonical];
  const proxy = route => {
    const hash = src.indexOf('#');
    return `https://document.mdv.invalid/${route}/${encodeURIComponent(hash < 0 ? src : src.slice(0, hash))}${hash < 0 ? '' : src.slice(hash)}`;
  };
  if (allowRemoteImages) {
    if (/^http:\/\//i.test(src)) return proxy('remote-image');
    if (/^https:\/\//i.test(src)) return src;
  }
  if (/^data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,[a-z\d+/=\s]+$/i.test(src)) return src;
  if (src && !/^(?:[a-z][\w+.-]*:|[\\/])/i.test(src) && !src.includes('\\'))
    return proxy('image');
  return '';
}

function resolveImageCandidates(srcset, allowRemoteImages, savedImages) {
  const candidates = [];
  let remaining = srcset;
  while (remaining) {
    remaining = remaining.replace(/^[\s,]+/, '');
    const token = remaining.match(/^\S+/)?.[0];
    if (!token) break;
    let src = token;
    let descriptor = '';
    remaining = remaining.slice(token.length);
    // A data URL's internal comma belongs to the URL, not the candidate separator.
    if (src.endsWith(',')) src = src.replace(/,+$/, '');
    else {
      const comma = remaining.indexOf(',');
      descriptor = (comma < 0 ? remaining : remaining.slice(0, comma)).trim();
      remaining = comma < 0 ? '' : remaining.slice(comma + 1);
    }
    const resolved = resolveImageSource(src, allowRemoteImages, savedImages);
    if (!resolved || (descriptor && !/^(?:[1-9]\d*w|(?:\d+(?:\.\d+)?|\.\d+)x)$/.test(descriptor))) return '';
    candidates.push(resolved + (descriptor ? ` ${descriptor}` : ''));
  }
  return candidates.join(', ');
}

function prepareImages(root, allowRemoteImages, savedImages) {
  for (const source of root.querySelectorAll('picture source')) {
    const resolved = resolveImageCandidates(source.dataset.originalSrcset || source.getAttribute('srcset') || '', allowRemoteImages, savedImages);
    if (resolved) source.setAttribute('srcset', resolved);
    else source.remove();
  }
  for (const img of root.querySelectorAll('img')) {
    const src = img.dataset.originalSrc || img.getAttribute('src') || '';
    img.dataset.originalSrc = src;
    if (img.dataset.originalAlt !== undefined) img.alt = img.dataset.originalAlt;
    img.classList.remove('blocked-image');
    img.removeAttribute('src');
    img.referrerPolicy = 'no-referrer';
    img.loading = 'lazy';
    const resolved = resolveImageSource(src, allowRemoteImages, savedImages);
    if (/^https:\/\/document\.mdv\.invalid\/(?:qiita|github)-image\//.test(resolved))
      img.closest('picture')?.querySelectorAll('source').forEach(n => n.remove());
    if (resolved) img.src = resolved;
    else {
      img.classList.add('blocked-image');
      img.alt = `${uiText("[画像]", "[Image]")} ${img.alt || src}${/^https?:/i.test(src) ? uiText('（外部画像を有効にすると表示）', ' (enable remote images to display)') : ''}`;
    }
  }
}

function sanitizeDiagram(svg) {
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  if (root.localName !== 'svg') throw new Error('Invalid diagram SVG');
  // Mermaid uses "root" for flowchart layout groups as well as authored classes.
  // With SVG labels, classDef root generates descendant rules (including path)
  // that otherwise paint every edge. Retain the class on authored nodes/clusters
  // and give only the internal layout wrapper a separate, non-class identity.
  if (root.classList.contains('flowchart')) {
    for (const group of root.querySelectorAll('g.root')) {
      if (!group.querySelector(':scope > g.nodes') || !group.querySelector(':scope > g.edgePaths')) continue;
      group.classList.remove('root');
      group.setAttribute('data-mdv-layout-root', '');
    }
    // Preserve Mermaid's built-in anchor-shape styling after renaming its wrapper.
    for (const style of root.querySelectorAll('style'))
      style.textContent = style.textContent.replaceAll('.root .anchor', '[data-mdv-layout-root] .anchor');
  }

  for (const node of root.querySelectorAll('.mindmap-node')) {
    const label = node.querySelector(':scope > .label');
    if (!label) continue;
    // Cloud/bang shapes already translate by half the label width; ordinary
    // shaped nodes instead leave the label at the node's horizontal origin.
    if (Math.abs(label.transform.baseVal.consolidate()?.matrix.e ?? 0) < .001)
      for (const text of label.querySelectorAll('text')) text.style.textAnchor = 'middle';
  }
  for (const foreign of root.querySelectorAll('foreignObject')) {
    const math = foreign.querySelector('math');
    if (!math) { foreign.remove(); continue; }
    // Keep only sanitized MathML, never Mermaid's surrounding HTML or callbacks.
    foreign.replaceChildren(DOMPurify.sanitize(math.outerHTML, {
      USE_PROFILES: { mathMl: true }, RETURN_DOM_FRAGMENT: true,
      FORBID_TAGS: ['annotation', 'annotation-xml'], FORBID_ATTR: ['href', 'xlink:href', 'style'],
    }));
  }
  return DOMPurify.sanitize(new XMLSerializer().serializeToString(root), {
    USE_PROFILES: { svg: true, svgFilters: true, mathMl: true }, ADD_TAGS: ['foreignObject'],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    FORBID_TAGS: ['script', 'a', 'image', 'annotation', 'annotation-xml'], FORBID_ATTR: ['href', 'xlink:href'],
  });
}

async function diagrams(localGeneration, theme, diagnostics) {
  const sources = [...article.querySelectorAll('pre.mermaid-source')];
  if (!sources.length) return;
  const mermaid = await mermaidRuntime(article.classList.contains('qiita') ? 'qiita' : 'github');
  // Markdown cannot override these options using frontmatter or init directives.
  const initialize = (diagramTheme, printing, htmlLabels) => mermaid.initialize({ startOnLoad: false, dompurifyConfig: diagramLabelSanitizer, securityLevel: 'strict', htmlLabels, theme: diagramTheme,
    deterministicIds: true, deterministicIDSeed: 'compatibility', handDrawnSeed: 1,
    // Journey's SVG fallback otherwise inherits the section rectangle's fill.
    themeCSS: 'text.journey-section { fill: currentColor; }',
    maxTextSize: 50_000, maxEdges: 500, suppressErrorRendering: true,
    secure: ['secure', 'dompurifyConfig', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering', 'htmlLabels', 'themeCSS',
      ...(printing ? ['theme', 'themeVariables'] : [])],
    flowchart: { htmlLabels, ...(article.classList.contains('github')?{diagramPadding:48}:{}) },
    ...(article.classList.contains('github')?{sequence:{diagramMarginY:40},gantt:{useWidth:1200},pie:{useWidth:1200}}:{}), });
  // Printing cannot wait for an async Mermaid render. Prepare its light SVG before
  // reporting the document ready, and let the print stylesheet select it.
  const themes = [theme === 'dark' ? 'dark' : 'default', 'default'];
  for (let i = 0; i < sources.length; i++) {
    if (localGeneration !== generation) return;
    const source = sources[i];
    const code = source.textContent;
    try {
      if (code.length > 50_000 || i >= 40) throw new Error('Diagram limit');
      const container = document.createElement('div');
      container.className = 'diagram';
      container.dataset.mdvSource = code;
      for (const [variantIndex, diagramTheme] of themes.entries()) {
        initialize(diagramTheme, variantIndex === 1, false);
        const { diagramType } = await mermaid.parse(code);
        const htmlLabels = diagramType === 'mindmap' || diagramType.startsWith('flowchart');
        initialize(diagramTheme, variantIndex === 1, htmlLabels);
        const measurement = htmlLabels ? createDiagramMeasurement(article) : undefined;
        let svg;
        try { ({ svg } = await mermaid.render(`mdv-diagram-${localGeneration}-${i}-${variantIndex}`, code, measurement)); }
        finally { measurement?.remove(); }
        if (localGeneration !== generation) return;
        const variant = document.createElement('div');
        variant.className = variantIndex === 0 ? 'diagram-screen' : 'diagram-print';
        variant.innerHTML = htmlLabels ? cleanSvg(svg) : sanitizeDiagram(svg);
        if(article.classList.contains('github'))prepareGithubDiagramViewport(variant);
        container.append(variant);
      }
      source.replaceWith(container);
    } catch {
      source.classList.add('diagram-error');
      source.title = uiText('Mermaidの描画に失敗しました。記法と図の大きさを確認してください。', 'Unable to render Mermaid. Check the syntax and diagram size.');
      diagnostics.push(uiText('描画できないMermaid図があります。該当箇所はコードとして表示しています。', 'Some Mermaid diagrams could not be rendered and are shown as code.'));
    }
  }
}

// Borrow only syntax tokens, never the original engine's document structure.
function applyQiitaHighlighting(original) {
  if (original?.metadata?.mode !== 'qiita') return;
  const template = document.createElement('template'); template.innerHTML = original.html;
  const candidates = new Map();
  for (const frame of template.content.querySelectorAll('.code-frame[data-lang]')) {
    const code = frame.querySelector('pre code');
    if (!code || !code.querySelector('span[class]')) continue;
    const key = frame.dataset.lang.toLowerCase() + '\0' + code.textContent;
    if (!candidates.has(key)) candidates.set(key, code.innerHTML);
  }
  for (const code of article.querySelectorAll('pre > code')) {
    if (code.textContent.length > 100001 || code.closest('.mermaid-source,.diagram')) continue;
    const language = [...code.classList].find(c => c.startsWith('language-'))?.slice(9).toLowerCase();
    const html = candidates.get(language + '\0' + code.textContent);
    if (!html) continue;
    const fragment = DOMPurify.sanitize(html, {ALLOWED_TAGS:['span'], ALLOWED_ATTR:['class'], ALLOW_DATA_ATTR:false, RETURN_DOM_FRAGMENT:true});
    if (fragment.textContent !== code.textContent) continue;
    code.replaceChildren(fragment); code.dataset.mdvHighlighter = 'rouge';
  }
}

function copyButtons() {
  for (const pre of article.querySelectorAll('pre')) {
    const text = codeSources.get(pre) ?? pre.querySelector('code')?.textContent ?? pre.textContent;
    if (article.classList.contains('github')) {
      const button = document.createElement('clipboard-copy');
      button.className = 'copy-code btn btn-sm'; button.value = text;
      button.setAttribute('aria-label', uiText('コピー', 'Copy')); button.title = uiText('コードをコピー', 'Copy code');
      button.append(githubIcon('copy'));
      const copied = () => {
        button.replaceChildren(githubIcon('check')); button.setAttribute('aria-label', uiText('コピーしました', 'Copied'));
        setTimeout(() => { button.replaceChildren(githubIcon('copy')); button.setAttribute('aria-label', uiText('コピー', 'Copy')); }, 1500);
      };
      button.addEventListener('clipboard-copy', copied);
      // WebView uses the native clipboard bridge, preserving the exact code text.
      // In a browser the official custom element handles both click and keyboard.
      if (window.chrome?.webview) for (const type of ['click','keydown']) button.addEventListener(type, event => {
        if (type === 'keydown' && !['Enter',' '].includes(event.key)) return;
        event.preventDefault(); event.stopImmediatePropagation(); post({type:'copy', text}); copied();
      }, {capture:true});
      pre.append(button);
    } else {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'copy-code'; button.textContent = uiText('コピー', 'Copy');
      button.addEventListener('click', async () => {
        if (window.chrome?.webview) post({type:'copy', text});
        else await navigator.clipboard.writeText(text).catch(() => {});
        button.textContent = uiText('コピーしました', 'Copied'); setTimeout(() => {button.textContent = uiText('コピー', 'Copy');}, 1500);
      });
      pre.append(button);
    }
  }
}


async function render(options) {
  const language = setLanguage(options.language);
  document.documentElement.lang = language;
  document.title = uiText('MDV プレビュー', 'MDV Preview');
  article.setAttribute('aria-label', uiText('Markdownプレビュー', 'Markdown preview'));
  if (options.failure) throw new Error(options.failure);
  const view = options.view || (options.resetScroll ? { x: 0, y: 0 } : captureView());
  cancelRestoration();
  const localGeneration = ++generation;
  const theme = options.theme === 'dark' ? 'dark' : 'light';
  const started = performance.now();
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.colorMode = theme;
  document.documentElement.dataset.lightTheme = 'light';
  document.documentElement.dataset.darkTheme = 'dark';
  let result;
  originalAliases = {};
  const qiita = options.mode === 'qiita';
  document.documentElement.dataset.service = qiita ? 'qiita' : 'github';
  await Promise.all([
    ...['github-primer', 'github-host'].map(id => selectStyles(id, !qiita)),
    ...['qiita-mdv', 'qiita-icons', 'qiita-host'].map(id => selectStyles(id, qiita)),
  ]);
  if (localGeneration !== generation) return;
  const engine = hasCustom && hasUpstream ? (options.engine || 'legacy') : hasUpstream ? 'original' : 'legacy';
  if (__MDV_UPSTREAM__ && engine === 'original') {
    if (!options.original || options.original.metadata?.mode !== options.mode) throw new Error(uiText('公開実装の変換結果がありません。', 'The upstream engine conversion result is missing.'));
    const { renderOriginalDocument } = await import('./upstream-display.mjs');
    result = await renderOriginalDocument(article, options.original, { theme, articleClass: qiita ? 'markdown-body it-MdContent' : 'markdown-body',
      prepareResources: root => {
        prepareImages(root, options.allowRemoteImages, qiita ? options.savedQiitaImages : options.savedGithubImages);
        if (options.mode === 'github') for (const pre of root.querySelectorAll('pre[lang]')) {
          const lang = pre.getAttribute('lang').toLowerCase();
          if (!hljs.getLanguage(lang) || pre.textContent.length > 100000) continue;
          const code = document.createElement('code'); code.className = `hljs language-${lang}`;
          code.innerHTML = hljs.highlight(pre.textContent, {language:lang, ignoreIllegals:true}).value;
          pre.replaceChildren(code);
        }
      } });
    originalAliases = result.aliases;
    article.classList.add('markdown-body');
  } else if (__MDV_CUSTOM__) {
    const { renderMarkdown } = await import('./markdown.mjs');
    article.className = `markdown-body ${options.mode === 'qiita' ? 'qiita it-MdContent' : 'github'}`;
    result = renderMarkdown(options.markdown ?? '', { mode: options.mode, language, deferMath: qiita, deferGithubEmoji: !qiita });
    const template = document.createElement('template');
    template.innerHTML = result.html;
    prepareImages(template.content, options.allowRemoteImages, qiita ? options.savedQiitaImages : options.savedGithubImages);
    article.replaceChildren(template.content);
    if (qiita) {
      applyQiitaHighlighting(options.original);
      const { renderQiitaMath } = await import('./math-runtime.mjs');
      await renderQiitaMath(article, result.diagnostics);
    }
    if (options.highlightFailure) result.diagnostics.push(options.highlightFailure);
    await diagrams(localGeneration, theme, result.diagnostics);
  }
  if (!qiita) {
    const { applyGithubHighlighting } = await import('./github-highlighting.mjs');
    for (const pre of article.querySelectorAll('pre')) codeSources.set(pre, pre.querySelector('code')?.textContent ?? pre.textContent);
    await applyGithubHighlighting(article);
  }
  if (engine !== 'original') prepareServicePresentation(article, options.mode);
  applySavedQiitaCards(article, qiita ? options.savedQiitaCards : undefined);
  if (options.savedCardFailure) result.diagnostics.push(options.savedCardFailure);
  if (options.savedImageFailure) result.diagnostics.push(options.savedImageFailure);
  currentOutline = result.outline;
  if (localGeneration !== generation) return;
  assignViewKeys();
  copyButtons();
  find('');
  restoreView(view);
  if (options.anchor != null) {
    if (scrollToAnchor(options.anchor)) restoreView(captureView());
  }
  currentRequestId = options.requestId ?? 0;
  const message = { type: 'rendered', requestId: options.requestId, outline: result.outline,
    diagnostics: [...new Set(result.diagnostics)], duration: Math.round(performance.now() - started) };
  post(message);
  return message;
}

function find(query, direction = 0, scroll = true) {
  if (direction === 0) {
    searchRanges = [];
    searchIndex = -1;
    if (query) {
      const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
      const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
        acceptNode(node) { return node.parentElement.closest('button, clipboard-copy, svg, math, .katex-mathml') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; },
      });
      let node;
      while ((node = walker.nextNode()) && searchRanges.length < 10_000) {
        for (const match of node.textContent.matchAll(expression)) {
          if (searchRanges.length >= 10_000) break;
          const range = new Range();
          range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
          searchRanges.push(range);
        }
      }
    }
  }
  if (searchRanges.length) searchIndex = (searchIndex + (direction || 1) + searchRanges.length) % searchRanges.length;
  CSS.highlights?.set('mdv-search', new Highlight(...searchRanges));
  CSS.highlights?.set('mdv-current', new Highlight(...(searchRanges.length ? [searchRanges[searchIndex]] : [])));
  if (searchRanges.length && scroll) {
    cancelRestoration();
    const parent = searchRanges[searchIndex].startContainer.parentElement;
    for (let ancestor = parent; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.tagName === 'DETAILS') ancestor.open = true;
    }
    const range = searchRanges[searchIndex];
    for (let ancestor = parent; ancestor && ancestor !== article; ancestor = ancestor.parentElement) {
      if (!['auto', 'scroll'].includes(getComputedStyle(ancestor).overflowX)) continue;
      const bounds = ancestor.getBoundingClientRect();
      const match = range.getBoundingClientRect();
      if (match.left < bounds.left || match.right > bounds.right)
        ancestor.scrollLeft += match.left - bounds.left - (ancestor.clientWidth - match.width) / 2;
    }
    const match = range.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + match.top - (innerHeight - match.height) / 2, behavior: 'instant' });
  }
  const result = { type: 'findResult', total: searchRanges.length, index: searchIndex + 1 };
  post(result);
  return result;
}

function openLink(event, newTab) {
  const anchor = event.target.closest('a[href]');
  if (!anchor) return;
  event.preventDefault();
  const href = anchor.getAttribute('href');
  if (href.startsWith('#') && !newTab) scrollToAnchor(href);
  else post({ type: 'openLink', href, newTab, requestId: currentRequestId });
}
article.addEventListener('click', event => openLink(event, event.ctrlKey || event.metaKey));
article.addEventListener('auxclick', event => { if (event.button === 1) openLink(event, true); });
article.addEventListener('mousedown', event => {
  if (event.button === 1 && event.target.closest('a[href]')) event.preventDefault();
});

async function receive(message) {
  try {
    if (message.type === 'render') await render(message);
    if (message.type === 'scroll') scrollToAnchor(message.anchor);
    if (message.type === 'find') find(message.query, message.direction, message.scroll !== false);
  } catch (error) {
    article.textContent = `${uiText("表示できませんでした", "Unable to display")}: ${error.message}`;
    currentOutline = []; originalAliases = {}; find('');
    post({ type: 'error', requestId: message.requestId, message: error.message });
  }
}
// Serialize renders: Mermaid maintains shared state. Keep only the newest pending render.
let running = false;
let pending;
async function enqueue(message) {
  if (message.type !== 'render') return receive(message);
  pending = message;
  if (running) return;
  running = true;
  try { while (pending) { const next = pending; pending = null; await receive(next); } }
  finally { running = false; }
}
window.mdv = { edition, render, find, scrollToAnchor, captureView,
  getCardSources: () => [...new Set([...article.querySelectorAll('.link-card a[href]')].map(n=>n.href).filter(s=>/^https?:\/\//i.test(s)))],
  getImageSources: () => [...new Set([...article.querySelectorAll('img')].map(n => n.dataset.originalSrc || '').filter(s => s && !/^(?:data:|#)/i.test(s)))],
  get requestId() { return currentRequestId; }, get outline() { return currentOutline; } };
document.addEventListener('keydown', event => {
  let key;
  if (event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey)
    key = ({ ArrowLeft: 'back', ArrowRight: 'forward' })[event.key];
  if (event.ctrlKey && !event.altKey) key = ({ o: 'open', t: 'newTab', w: 'closeTab', tab: event.shiftKey ? 'previousTab' : 'nextTab',
    f: 'find', p: 'print', u: 'source', '1': 'github', '2': 'qiita', '0': 'zoomReset', '+': 'zoomIn', '=': 'zoomIn', '-': 'zoomOut' })[event.key.toLowerCase()];
  if (event.key === 'F5') key = 'reload';
  if (event.key === 'Escape') key = 'escape';
  if (event.key === 'F3') key = event.shiftKey ? 'findPrevious' : 'findNext';
  if (key) { event.preventDefault(); post({ type: 'shortcut', key }); }
});
document.addEventListener('wheel', event => {
  if (!event.ctrlKey || event.altKey || event.deltaY === 0) return;
  event.preventDefault();
  post({ type: 'shortcut', key: event.deltaY < 0 ? 'zoomIn' : 'zoomOut' });
}, { passive: false });
document.addEventListener('dragover', event => { event.preventDefault(); });
document.addEventListener('drop', event => {
  event.preventDefault();
  if (event.dataTransfer.files.length) window.chrome?.webview?.postMessageWithAdditionalObjects({ type: 'drop' }, [...event.dataTransfer.files]);
});
window.chrome?.webview?.addEventListener('message', event => enqueue(event.data));
post({ type: 'ready' });
