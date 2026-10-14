// Narrow contracts: no claim that these observations verify every input or pixel.
export function features(root, emojiLookup = {}) {
  const text = node => {
    if (!node) return '';
    const copy = node.cloneNode(true);
    copy.querySelectorAll('br').forEach(n=>n.replaceWith(' '));
    copy.querySelectorAll('img.emoji').forEach(n=>n.replaceWith(emojiLookup[n.title?.slice(1,-1)] || n.alt));
    copy.querySelectorAll('mjx-container,.katex').forEach(n=>n.replaceWith('[math]'));
    copy.querySelectorAll('p,div,pre,li,blockquote,ul,ol,table,tr,th,td').forEach(n=>{n.prepend(' ');n.append(' ');});
    return copy.textContent.replace(/\s+/g, ' ').trim();
  };
  const headings = [...root.querySelectorAll(':is(h1,h2,h3,h4,h5,h6):not(.sr-only)')].map(node => {
    const copy = node.cloneNode(true); copy.querySelectorAll('a[href^="#"]:has(.fa-link),.mdv-heading-link,svg').forEach(n => n.remove());
    return { level: node.tagName, text: text(copy) };
  });
  const anchors = [...root.querySelectorAll(':is(h1,h2,h3,h4,h5,h6):not(.sr-only)')].map(node => {
    const holder = node.closest('.markdown-heading') || node;
    const link = holder.querySelector('a[href^="#"]');
    let id = link?.getAttribute('href').slice(1);
    try { id = decodeURIComponent(id); } catch {}
    const target = [...root.querySelectorAll('[id],a[name]')].find(n => n.id === id || n.getAttribute('name') === id || n.id === `user-content-${id}`);
    return { text: headings[[...root.querySelectorAll(':is(h1,h2,h3,h4,h5,h6):not(.sr-only)')].indexOf(node)].text, linked: !!target };
  });
  const footnotes = [...root.querySelectorAll('.footnotes li')].map(node => {
    const copy = node.cloneNode(true); copy.querySelectorAll('a').forEach(n=>n.remove()); return text(copy);
  });
  const footnoteLinks = [...root.querySelectorAll('a')].filter(n => /^#(?:user-content-)?fn(?:ref|[-:])/.test(n.getAttribute('href') || '') || n.matches('[data-footnote-ref],[data-footnote-backref],.reversefootnote,.footnote-ref,.footnote-backref,.qiita-footnote-ref'));
  const footnoteTargets = footnoteLinks.map(n => {
    let id = (n.getAttribute('href') || '').slice(1); try { id = decodeURIComponent(id); } catch {}
    return !![...root.querySelectorAll('[id]')].find(target => target.id === id || target.id === `mdv-content-${id}`);
  });
  const clean = node => { const copy = node.cloneNode(true); copy.querySelectorAll('button,clipboard-copy,.copy-code,.code-copy,.sr-only,svg').forEach(n=>n.remove()); return copy; };
  const dimension = (node, name) => {
    const value = node.style.getPropertyValue(name) || node.getAttribute(name) || '';
    return /^\d+(?:\.\d+)?$/.test(value) ? value+'px' : value;
  };
  return {
    fontColors: [...root.querySelectorAll('font[color]')].map(n=>({text:text(n),color:getComputedStyle(n).color})),
    imageFrames: [...root.querySelectorAll('img')].filter(n=>n.getClientRects().length>0&&getComputedStyle(n).visibility!=='hidden'&&!n.closest('.diagram,.katex,mjx-container,.link-card')&&!n.classList.contains('emoji')).map(n=>{const s=getComputedStyle(n);return {border:s.borderStyle==='none'?'none':s.border,shadow:s.boxShadow};}),
    imageDimensions: [...root.querySelectorAll('img')].filter(n=>n.getClientRects().length>0&&getComputedStyle(n).visibility!=='hidden'&&!n.closest('.diagram,.katex,mjx-container,.link-card')&&!n.classList.contains('emoji')).map(n=>({width:dimension(n,'width'),height:dimension(n,'height')})),
    alertTitles: [...root.querySelectorAll('.markdown-alert-title')].map(n=>({text:text(clean(n)),fontWeight:getComputedStyle(n.querySelector('strong')||n).fontWeight})),
    paragraphs: [...root.querySelectorAll('p')].filter(n=>!n.closest('.footnotes,.link-card,.markdown-alert-title,.diagram,svg') && text(clean(n))).map(n=>({text:text(clean(n)),breaks:n.querySelectorAll('br').length})),
    codeBlocks: [...root.querySelectorAll('pre')].filter(n=>n.getClientRects().length&&!n.closest('.diagram,.math-display,.math-container')).map(n=>clean(n).textContent.replace(/\n$/, '')),
    inlineCode: [...root.querySelectorAll('code')].filter(n=>!n.closest('pre')).map(n=>n.textContent),
    formatting: [...root.querySelectorAll('strong,b,em,i:not(.fa),del,s')].filter(n=>!n.closest('pre,.katex,mjx-container,.markdown-alert-title')).map(n=>({kind:({B:'STRONG',I:'EM',S:'DEL'})[n.tagName]||n.tagName,text:text(n)})),
    lists: [...root.querySelectorAll('ul,ol')].filter(n=>!n.closest('.footnotes')).map(n=>({kind:n.tagName,start:n.getAttribute('start')||'1',items:[...n.children].filter(n=>n.tagName==='LI').map(n=>text(clean(n)))})),
    math: {inline:root.querySelectorAll('mjx-container:not([display="true"]),.math-inline > .katex').length,display:root.querySelectorAll('mjx-container[display="true"],.katex-display').length,errors:root.querySelectorAll('[data-mjx-error],.math-error').length},
    headings, anchors, footnotes, footnoteTargets,
    notes: [...root.querySelectorAll('.note,.qiita-note')].map(n=>({kind:['info','warn','alert'].find(c=>n.classList.contains(c) || n.classList.contains('qiita-note-'+c)),text:text(n)})),
    tableAlignment: [...root.querySelectorAll('th,td')].map(n=>({text:text(n),align:n.getAttribute('align') || n.style.textAlign || ''})),
    codeFilenames: [...root.querySelectorAll('.code-lang,figcaption')].map(text),
    linkUnderlines: [...root.querySelectorAll('p a[href]')].filter(n=>text(n) && !n.closest('sup,.footnotes,.link-card')).map(n=>({text:text(n),underline:getComputedStyle(n).textDecorationLine.includes('underline')})) };
}

// Qiita inserts its MathJax loader after document load when math is present.
// A configuration object alone exists on ordinary articles, including prices.
export function hasPendingQiitaMath(root) {
  if (root.querySelector('[data-lang="math"],mjx-container')) return true;
  const copy = root.cloneNode(true);
  copy.querySelectorAll('pre,code,a,h1,h2,h3,h4,h5,h6').forEach(n=>n.remove());
  return /(?<!\\)\$\$?[\s\S]+?(?<!\\)\$/.test(copy.textContent);
}
