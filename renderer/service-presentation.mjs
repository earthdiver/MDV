import { gemoji } from 'gemoji';
import { text as uiText } from './language.mjs';
import { githubIcon } from './github-icons.mjs';
// GitHub wraps only these variation-selector sequences in g-emoji, not every
// Unicode emoji. Verified against the Markdown API's full gemoji 8.1.0 corpus;
// see the visual-n5 emoji probe record. In particular, ✅ remains ordinary text.
const wrappedEmoji=new Set('☺️ ☹️ ✈️ ♠️ ♥️ ♦️ ♣️ ⚠️ ↗️ ↘️ ↙️ ↖️ ↕️ ↔️ ⤴️ ⤵️ ▶️ ◀️ ⏏️ ‼️ ⁉️ 🅰️ 🅱️ Ⓜ️ 🅾️ 🅿️'.split(' '));
const shortcodes=new Map(gemoji.flatMap(e=>e.names.map(name=>[name,e.emoji])));
const literalEmojiPattern=new RegExp([...wrappedEmoji].join('|'),'gu');
function prepareGithubEmoji(article) {
  const walker=document.createTreeWalker(article,NodeFilter.SHOW_TEXT),nodes=[];
  while(walker.nextNode())if(!walker.currentNode.parentElement.closest('pre,code,g-emoji,.katex,mjx-container,svg,math,script,style'))nodes.push(walker.currentNode);
  for(const node of nodes){
    const value=node.parentElement.closest('a')?node.nodeValue:node.nodeValue.replace(/:([\w+-]+):/g,(match,name)=>shortcodes.get(name)||match);
    const matches=[...value.matchAll(literalEmojiPattern)];
    if(!matches.length){node.nodeValue=value;continue;}
    const fragment=document.createDocumentFragment();let cursor=0;
    for(const match of matches){
      fragment.append(value.slice(cursor,match.index));
      const emoji=document.createElement('g-emoji');emoji.className='g-emoji';emoji.textContent=match[0];fragment.append(emoji);
      cursor=match.index+match[0].length;
    }
    fragment.append(value.slice(cursor));node.replaceWith(fragment);
  }
}
// Shared service presentation for both converters. Keep destinations and code text intact.
export function prepareServicePresentation(article, mode) {
  for (const heading of article.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    if (heading.classList.contains('sr-only')) continue;
    let link = heading.querySelector('a.mdv-heading-link, a.heading-permalink, a:has(.fa-link)');
    const target = heading.id || heading.querySelector('[id]')?.id;
    if (!link && !target) continue;
    if (!link) { link = document.createElement('a'); link.href = `#${target}`; heading.prepend(link); }
    link.classList.add('mdv-heading-link');
    link.setAttribute('aria-label', `${uiText("見出しへのリンク", "Link to heading")}: ${heading.textContent.trim()}`);
    if (mode === 'qiita') {
      const icon = document.createElement('i'); icon.className = 'fa fa-link'; icon.setAttribute('aria-hidden', 'true');
      link.replaceChildren(icon);
    } else { link.classList.add('anchor'); link.replaceChildren(githubIcon('link')); }
  }
  if (mode !== 'qiita') {
    // GitHub unwraps links whose destination was rejected by sanitization.
    // Empty anchors otherwise split text shaping even when they look unstyled.
    for(const link of article.querySelectorAll('a:not([href]):not([id]):not([name])'))link.replaceWith(...link.childNodes);
    article.normalize();
    prepareGithubEmoji(article);
    for(const input of article.querySelectorAll('li input[type="checkbox"]')){
      const item=input.closest('li'),first=item.firstElementChild;
      if(first!==input&&!(first?.tagName==='P'&&first.firstElementChild===input))continue;
      item.classList.add('task-list-item');item.parentElement.classList.add('contains-task-list');
      input.classList.add('task-list-item-checkbox');
    }
    for (const alert of article.querySelectorAll('.markdown-alert')) {
      const title = alert.querySelector('p');
      const tone = ['note','tip','important','warning','caution'].find(t => alert.classList.contains(`markdown-alert-${t}`));
      if (title && tone) {
        title.classList.add('markdown-alert-title');
        title.querySelectorAll('svg').forEach(svg => svg.remove());
        title.prepend(githubIcon(tone === 'note' ? 'info' : tone));
      }
    }
    return;
  }
  // The public processor leaves standalone URLs as paragraphs. Present the same
  // offline card fallback in both engines; no remote metadata is requested.
  for (const paragraph of article.querySelectorAll('p:not(.link-card)')) {
    const link = paragraph.firstElementChild;
    if (paragraph.children.length !== 1 || link?.tagName !== 'A' ||
        paragraph.textContent.trim() !== link.getAttribute('href')) continue;
    let url;
    try { url = new URL(link.getAttribute('href')); } catch { continue; }
    if (!['https:','http:'].includes(url.protocol)) continue;
    paragraph.classList.add('link-card');
    const host = document.createElement('span'); host.className='link-card-host'; host.textContent=url.hostname;
    const address = document.createElement('span'); address.textContent=link.getAttribute('href');
    link.replaceChildren(host,address);
  }
  for (const link of article.querySelectorAll('sup a[href^="#"]')) {
    let id = link.getAttribute('href').slice(1);
    try { id = decodeURIComponent(id); } catch {}
    if ([...article.querySelectorAll('.footnotes [id]')].some(node => node.id === id || node.id === `mdv-content-${id}`))
      link.classList.add('qiita-footnote-ref');
  }
  for (const note of article.querySelectorAll('.qiita-note:not(.note)')) {
    const tone = ['info','warn','alert'].find(tone => note.classList.contains(`qiita-note-${tone}`));
    if (!tone) continue;
    note.classList.add('note', tone);
    const icon = document.createElement('i'); icon.className = `fa fa-fw fa-${{info:'check',warn:'exclamation',alert:'times'}[tone]}-circle`;
    icon.setAttribute('aria-hidden', 'true');
    const body = document.createElement('div'); body.append(...note.childNodes); note.append(icon, body);
  }
  for (const pre of article.querySelectorAll('pre')) {
    if (pre.closest('.diagram, .math-display, .render-error') || pre.classList.contains('mermaid-source')) continue;
    let frame = pre.closest('.code-frame');
    if (!frame) { frame = document.createElement('div'); frame.className = 'code-frame'; pre.before(frame); frame.append(pre); }
    const caption = frame.querySelector('figcaption');
    if (caption) caption.classList.add('code-lang');
    if (!pre.closest('.highlight')) {
      const highlight = document.createElement('div'); highlight.className = 'highlight'; pre.before(highlight); highlight.append(pre);
    }
  }
  // highlight.js and Rouge have different tokenizers. Reuse the upstream palette
  // for legacy tokens without claiming token-for-token equivalence.
  const tokens = {keyword:'k',selector_tag:'nt',deletion:'gd',comment:'c',quote:'c',string:'s',regexp:'sr',addition:'gi',number:'m',literal:'kc',built_in:'nb',attr:'na',title:'nf',section:'gh',name:'nt',variable:'nv',template_variable:'nv',subst:'s',symbol:'ss',meta:'cp'};
  for (const span of article.querySelectorAll('.highlight [class]'))
    for (const name of [...span.classList]) {
      const token = tokens[name.replace(/^hljs-/, '').replaceAll('-', '_')];
      if (name.startsWith('hljs-') && token) span.classList.add(token);
    }
}
