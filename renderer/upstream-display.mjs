import { createDiagramMeasurement } from './diagram-layout.mjs';
import { cleanSvg, diagramLabelSanitizer } from './diagram-svg.mjs';
import {prepareGithubDiagramViewport} from './github-diagram.mjs';
import { imageDimensionStyle } from './image-styles.mjs';
import { mathRuntime, queueMathRender, prepareQiitaMathScope,renderMathBlock } from './math-runtime.mjs';
import { text as uiText } from './language.mjs';
import { prepareServicePresentation } from './service-presentation.mjs';
import createDOMPurify from 'dompurify';
import { mermaidRuntime, mermaidVersion } from './mermaid-runtime.mjs';
import GithubSlugger from 'github-slugger';
import { gemoji } from 'gemoji';

const purify = createDOMPurify(window);
const emojis = new Map(gemoji.flatMap(({ names, emoji }) => names.map(name => [name, emoji])));
let sequence = 0;

export function prepareHtml(html, mode) {
  const changes = [];
  const fragment = purify.sanitize(html, { USE_PROFILES: { html: true }, RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ['style', 'form', 'iframe', 'object', 'embed', 'script', 'video', 'audio', 'link', 'meta', 'base', ...(mode === 'github' ? ['font'] : [])] });
  for (const item of purify.removed) changes.push({ stage: 'sanitize', kind: 'removed',
    element: item.element?.localName || item.from?.localName, attribute: item.attribute?.name });
  const root = document.createElement('div'); root.append(fragment);
  // All resource filtering happens in a detached tree, before anything can load.
  for (const node of root.querySelectorAll('*')) {
    for (const attribute of ['src', 'srcset', 'poster', 'background']) {
      if (!node.hasAttribute(attribute)) continue;
      changes.push({ stage: 'sanitize', kind: 'offline-resource', element: node.localName, attribute });
      if (attribute === 'srcset') node.dataset.originalSrcset = node.getAttribute(attribute);
      if (node.localName === 'img' && attribute === 'src') {
        node.dataset.originalSrc = node.getAttribute(attribute);
        node.dataset.originalAlt = node.alt;
        node.alt = `${uiText("[画像]", "[Image]")} ${node.alt || node.getAttribute(attribute)}`; node.classList.add('blocked-image');
      }
      node.removeAttribute(attribute);
    }
    if (node.hasAttribute('style')) {
      const before = node.getAttribute('style'), allowed = document.createElement('span').style;
      if (node.localName === 'img') allowed.cssText = imageDimensionStyle(before);
      for (const property of (mode === 'github' ? ['text-align'] : ['text-align', 'color', 'background-color'])) {
        const value = node.style.getPropertyValue(property);
        if (value && !/url\(|var\(|expression|\\/i.test(value)) allowed.setProperty(property, value);
      }
      if (allowed.cssText) node.setAttribute('style', allowed.cssText); else node.removeAttribute('style');
      if (before !== (node.getAttribute('style') || '')) changes.push({ stage: 'sanitize', kind: 'style-filter', before, after: node.getAttribute('style') });
    }
    if (node.localName === 'input') { node.type = 'checkbox'; node.disabled = true; }
  }
  if (mode === 'github') {
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),nodes=[];
    while(walker.nextNode())if(!walker.currentNode.parentElement.closest('a,pre,code,script,style'))nodes.push(walker.currentNode);
    for(const node of nodes){
      const matches=[...node.nodeValue.matchAll(/https?:\/\/localhost(?::\d+)?(?![\w.:-])(?:[/?#][^\s<>]*)?/gi)];
      if(!matches.length)continue;
      const fragment=document.createDocumentFragment();let cursor=0;
      for(const match of matches){const value=match[0].replace(/[.,;:!?]+$/,'');fragment.append(node.nodeValue.slice(cursor,match.index));const link=document.createElement('a');link.href=value;link.textContent=value;fragment.append(link);cursor=match.index+value.length;}
      fragment.append(node.nodeValue.slice(cursor));node.replaceWith(fragment);
    }
  }
  const sanitized = root.innerHTML, aliases = new Map();
  for (const image of root.querySelectorAll('img.emoji')) {
    const name = image.title?.match(/^:([^:]+):$/)?.[1];
    if (!emojis.has(name)) continue;
    const span = document.createElement('span'); span.className = 'emoji'; span.title = image.title;
    span.textContent = emojis.get(name); image.replaceWith(span);
    changes.push({ stage: 'prepare', kind: 'emoji-resource-fallback', name,
      reason: 'Service emoji images unavailable offline; Unicode glyph is not pixel-equivalent.' });
  }
  let counter = 0;
  const idOccurrences = new Map();
  // Preserve fragment semantics, but never let input IDs collide with the UI.
  for (const node of root.querySelectorAll('[id], a[name]')) {
    const original = node.id || node.getAttribute('name');
    // Sanitization may remove a clobbering ID such as "after". Numbering all
    // surviving IDs would then move every later anchor on the next reload.
    const occurrence = idOccurrences.get(original) || 0;
    idOccurrences.set(original, occurrence + 1);
    const token = encodeURIComponent(original).replaceAll('_', '_5F').replaceAll('%', '_');
    const id = `mdv-original-content-${token}-${occurrence}`;
    counter++;
    node.id = id; if (!aliases.has(original)) aliases.set(original, id); node.removeAttribute('name');
  }
  const slugger = new GithubSlugger();
  const outline = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((heading, index) => {
    let target = heading.id ? heading : heading.querySelector('[id]');
    if (!target) {
      heading.id = `mdv-original-heading-${index}`; target = heading;
      const slug = slugger.slug(heading.textContent.trim());
      if (!aliases.has(slug)) aliases.set(slug, heading.id);
      changes.push({ stage: 'prepare', kind: 'generated-heading-target', text: heading.textContent, slug, id: heading.id });
      const permalink = heading.querySelector('a.heading-permalink, a:has(.fa-link)') || document.createElement('a'); permalink.href = `#${heading.id}`;
      permalink.className = 'heading-permalink'; permalink.setAttribute('aria-label', `Permalink: ${heading.textContent.trim()}`);
      if (!permalink.parentElement) heading.prepend(permalink);
    }
    return { id: target.id, text: heading.textContent.trim(), level: Number(heading.tagName[1]) };
  });
  for (const link of root.querySelectorAll('a[href^="#"]')) {
    const value = link.getAttribute('href').slice(1); let decoded = value;
    try { decoded = decodeURIComponent(value); } catch { /* Preserve malformed literals. */ }
    const target = aliases.get(decoded) || aliases.get(value);
    if (target) link.setAttribute('href', `#${target}`);
  }
  for (const node of root.querySelectorAll('[aria-labelledby], [aria-describedby]'))
    for (const attribute of ['aria-labelledby', 'aria-describedby'])
      if (node.hasAttribute(attribute)) node.setAttribute(attribute, node.getAttribute(attribute).split(/\s+/).map(id => aliases.get(id) || id).join(' '));
  if (counter) changes.push({ stage: 'prepare', kind: 'namespace-ids', aliases: Object.fromEntries(aliases) });
  return { root, sanitized, prepared: root.innerHTML, outline, changes, aliases: Object.fromEntries(aliases) };
}


async function render(article, result, { theme = 'light', captureStages = false, prepareResources, articleClass = '' } = {}) {
  if (!['github', 'qiita'].includes(result.metadata?.mode) || typeof result.html !== 'string') throw new Error('Invalid original rendering result');
  await mathRuntime(result.metadata.mode); window.MathJax.typesetClear(); window.MathJax.texReset();
  const diagnostics = [], graphics = [], prepared = prepareHtml(result.html, result.metadata.mode);
  prepareServicePresentation(prepared.root, result.metadata.mode);
  prepared.prepared = prepared.root.innerHTML;
  const stages = captureStages ? { original: result.html, sanitized: prepared.sanitized, prepared: prepared.prepared } : undefined;
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  if (prepareResources) prepareResources(prepared.root);
  article.className = `original-body ${result.metadata.mode} ${articleClass}`.trim(); article.replaceChildren(...prepared.root.childNodes);
  let diagrams = 0, mathBlocks = 0;
  for (const block of [...article.querySelectorAll('.code-frame[data-lang], pre[lang]')]) {
    const language = (block.dataset.lang || block.getAttribute('lang') || '').toLowerCase();
    if (!['mermaid', 'math'].includes(language)) continue;
    const code = (block.querySelector('pre') || block).textContent, container = document.createElement('div');
    container.className = language === 'mermaid' ? 'diagram' : 'math-display'; container.dataset.mdvSource = code; block.replaceWith(container);
    try {
      if (language === 'mermaid') {
        const mermaid = await mermaidRuntime(result.metadata.mode);
        if (diagrams >= 40 || code.length > 50000) throw new Error('Diagram limit');
        for (const variant of ['screen', 'print']) {
          mermaid.initialize({ startOnLoad: false, dompurifyConfig: diagramLabelSanitizer, securityLevel: 'strict', htmlLabels: true,
            theme: variant === 'print' || theme !== 'dark' ? 'default' : 'dark',
            deterministicIds: true, deterministicIDSeed: 'compatibility', handDrawnSeed: 1, suppressErrorRendering: true,
            maxTextSize: 50000, maxEdges: 500,
            ...(result.metadata.mode==='github'?{flowchart:{diagramPadding:48},sequence:{diagramMarginY:40},gantt:{useWidth:1200},pie:{useWidth:1200}}:{}),
            secure: ['secure', 'dompurifyConfig', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering',
              ...(variant === 'print' ? ['theme', 'themeVariables'] : [])] });
          const measurement = createDiagramMeasurement(article);
          let svg;
          try { ({ svg } = await mermaid.render(`original-diagram-${++sequence}`, code, measurement)); }
          finally { measurement.remove(); }
          const view = document.createElement('div'); view.className = `diagram-${variant}`;
          view.innerHTML = cleanSvg(svg);
          if(result.metadata.mode==='github')prepareGithubDiagramViewport(view);
          container.append(view);
          if (captureStages) graphics.push({ kind: 'mermaid', variant, code, raw: svg, sanitized: view.innerHTML });
        }
        diagrams++;
      } else { container.append(await renderMathBlock(code,container,result.metadata.mode)); mathBlocks++; }
    } catch (error) {
      container.replaceChildren(); // Do not keep a half-rendered screen/print pair.
      diagnostics.push(`${language}: ${error.message}`);
      const fallback = document.createElement('pre'); fallback.textContent = code; container.append(fallback); container.classList.add('render-error');
    }
  }
  for (const code of article.querySelectorAll('code')) {
    if (code.closest('pre')) continue;
    const before = code.previousSibling, after = code.nextSibling;
    if (before?.nodeType === Node.TEXT_NODE && after?.nodeType === Node.TEXT_NODE &&
        /(?<!\$)\$$/.test(before.textContent) && /^\$(?!\$)/.test(after.textContent)) {
      before.textContent = before.textContent.slice(0, -1); after.textContent = after.textContent.slice(1);
      const span = document.createElement('span'); span.textContent = `$${code.textContent}$`; code.replaceWith(span);
    }
  }
  if (result.metadata.mode === 'qiita') prepareQiitaMathScope(article);
  await document.fonts.ready;
  await window.MathJax.typesetPromise([article]);
  for (const error of article.querySelectorAll('[data-mjx-error]')) diagnostics.push(`math: ${error.getAttribute('data-mjx-error')}`);
  article.getBoundingClientRect(); // Flush layout so newly inserted CHTML starts its local font loads.
  await document.fonts.ready;
  if (captureStages) stages.rendered = article.innerHTML;
  return { diagrams, mathBlocks, math: article.querySelectorAll('mjx-container').length, diagnostics,
    outline: prepared.outline, aliases: prepared.aliases, changes: prepared.changes, stages, graphics,
    displayProfile: { theme, mermaid: mermaidVersion(result.metadata.mode), mathjax: '3.2.2', styles: 'mdv-original-v1', serviceStatus: 'unverified' } };
}

// Both libraries keep global state: serialize mode/theme/document transitions.
export function renderOriginalDocument(article, result, options) {
  return queueMathRender(() => render(article, result, options));
}
export function followFragment(article, href) {
  if (!href?.startsWith('#')) return false;
  const target = [...article.querySelectorAll('[id]')].find(node => node.id === href.slice(1));
  if (!target) return false;
  for (let parent = target.parentElement; parent && parent !== article; parent = parent.parentElement)
    if (parent.tagName === 'DETAILS') parent.open = true;
  target.scrollIntoView({ block: 'start' }); return true;
}
