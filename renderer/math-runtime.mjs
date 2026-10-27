// Conservative DOM check: false positives cost a load; false negatives lose equations.
// Read decoded text so HTML entities and Markdown escapes cannot hide delimiters.
export function hasMathCandidate(root) {
  return !!root.querySelector('[data-mdv-tex], pre[lang="math" i], .code-frame[data-lang="math" i], code.language-math, .math-inline, .math-display') ||
    /[$\\]/.test(root.textContent || '');
}

let mathReady;
let queue = Promise.resolve();
export async function mathRuntime(mode='github') {
  if (!mathReady) {
    window.MathJax = { startup: { typeset: false, output:'svg' }, loader:{load:['output/chtml']},
      tex: { inlineMath: [['$', '$'], ['\\(', '\\)']], displayMath: [['$$', '$$'], ['\\[', '\\]']], processEscapes: true, processEnvironments: false, processRefs: false,
        autoload: { html: [] }, require: { allow: { html: false } } },
      options: { ignoreHtmlClass: 'diagram|mdv-math-ignore' }, svg: { fontCache: 'none' },
      chtml:{fontURL:'/mathjax/output/chtml/fonts/woff-v2'} };
    mathReady = new Promise((accept, reject) => {
      const script = document.createElement('script'); script.src = '/mathjax/tex-svg-full.js';
      script.onload = () => window.MathJax.startup.promise.then(accept, reject);
      script.onerror = () => reject(new Error('MathJax could not be loaded'));
      document.head.append(script);
    });
  }
  await mathReady;
  const output=mode==='qiita'?'chtml':'svg',runtime=window.MathJax;
  if(runtime.startup.output.name.toLowerCase()!==output) {
    runtime.typesetClear();
    document.querySelectorAll('#MJX-CHTML-styles,#MJX-SVG-styles').forEach(n=>n.remove());
    runtime.startup.useOutput(output,true);runtime.startup.getComponents();runtime.startup.makeMethods();
    runtime.startup.output.clearCache?.();
  }
}

export async function renderMathBlock(source,container,mode) {
  if(mode!=='qiita')return window.MathJax.tex2svgPromise(source,{display:true});
  await document.fonts.ready;
  return window.MathJax.tex2chtmlPromise(source,window.MathJax.getMetricsFor(container,true));
}


export function queueMathRender(run) { const task = queue.then(run); queue = task.catch(()=>{}); return task; }

// Both services find dollar math in the sanitized Markdown DOM. Fenced math
// bypasses Markdown parsing and is converted from its literal TeX separately.
export function renderCustomMath(article, diagnostics, mode) {
  return queueMathRender(async () => {
    if (!hasMathCandidate(article)) {
      window.MathJax?.typesetClear?.();
      return;
    }
    await mathRuntime(mode);
    window.MathJax.typesetClear(); window.MathJax.texReset();
    for (const node of article.querySelectorAll('[data-mdv-tex]')) {
      const source = node.dataset.mdvTex;
      try { node.replaceChildren(mode === 'qiita'
        ? await renderMathBlock(source,node,mode)
        : await window.MathJax.tex2svgPromise(source,{display:node.classList.contains('math-block')})); }
      catch (error) { node.textContent=source; node.classList.add('math-error'); diagnostics.push(`math: ${error.message}`); }
    }
    prepareCodeMath(article, mode);
    if (mode === 'qiita') {
      prepareQiitaMathScope(article);
      await document.fonts.ready;
      await window.MathJax.typesetPromise([article]);
    } else await renderGithubMath(article);
    for (const error of article.querySelectorAll('[data-mjx-error]')) diagnostics.push(`math: ${error.getAttribute('data-mjx-error')}`);
    article.getBoundingClientRect(); // Start font loads before awaiting the current FontFaceSet.ready.
    await document.fonts.ready;
  });
}

export function prepareCodeMath(article, mode) {
  for (const code of article.querySelectorAll('code')) {
    if (code.closest('pre') || (mode === 'github' && code.closest('a'))) continue;
    const before = code.previousSibling, after = code.nextSibling;
    if (before?.nodeType === Node.TEXT_NODE && after?.nodeType === Node.TEXT_NODE &&
        /(?<!\$)\$$/.test(before.textContent) && /^\$(?!\$)/.test(after.textContent)) {
      before.textContent = before.textContent.slice(0, -1);
      after.textContent = after.textContent.slice(1);
      const span = document.createElement('span');
      span.textContent = `$${code.textContent}$`;
      code.replaceWith(span);
    }
  }
}

export async function renderGithubMath(article) {
  // GitHub's Markdown API recognizes math within individual text nodes, not
  // across emphasis, HTML elements or hard breaks; links and code stay literal.
  const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.data.includes('$') && !node.parentElement.closest('a,pre,code,script,style,svg,math,mjx-container,.diagram,[data-mdv-tex]')) nodes.push(node);
  }
  const runtime = window.MathJax, input = runtime.startup.document.inputJax[0];
  // Keep Qiita's TeX delimiters out of GitHub recognition. Otherwise a literal
  // \(...\) pair can consume an enclosed dollar expression before we see it.
  const finder = new input.findTeX.constructor({...input.findTeX.options,
    inlineMath:[['$', '$']], displayMath:[['$$', '$$']]});
  for (const node of nodes) {
    const matches = finder.findMath([node.data]).filter(item =>
      item.open === '$$' || (item.open === '$' && !/[\r\n]/.test(item.math)));
    if (!matches.length) continue;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of matches) {
      fragment.append(node.data.slice(cursor, match.start.n));
      fragment.append(await runtime.tex2svgPromise(match.math, {display:match.display}));
      cursor = match.end.n;
    }
    fragment.append(node.data.slice(cursor));
    node.replaceWith(fragment);
  }
  // Direct conversion must install SVG layout and hidden assistive-MathML CSS.
  runtime.startup.document.clear();
  runtime.startup.document.updateDocument();
}

export function prepareQiitaMathScope(article) {
  for (const node of article.querySelectorAll('a,h1,h2,h3,h4,h5,h6')) node.classList.add('mdv-math-ignore');
}
