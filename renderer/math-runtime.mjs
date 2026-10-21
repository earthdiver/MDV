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

// GitHub renders only parsed math nodes; Qiita typesets the sanitized Markdown DOM.
export function renderCustomMath(article, diagnostics, mode) {
  return queueMathRender(async () => {
    await mathRuntime(mode);
    window.MathJax.typesetClear(); window.MathJax.texReset();
    for (const node of article.querySelectorAll('[data-mdv-tex]')) {
      const source = node.dataset.mdvTex;
      try { node.replaceChildren(mode === 'qiita'
        ? await renderMathBlock(source,node,mode)
        : await window.MathJax.tex2svgPromise(source,{display:node.classList.contains('math-block')})); }
      catch (error) { node.textContent=source; node.classList.add('math-error'); diagnostics.push(`math: ${error.message}`); }
    }
    if (mode === 'qiita') {
      for (const code of article.querySelectorAll('code')) {
        if (code.closest('pre')) continue;
        const before=code.previousSibling, after=code.nextSibling;
        if (before?.nodeType===Node.TEXT_NODE && after?.nodeType===Node.TEXT_NODE && /(?<!\$)\$$/.test(before.textContent) && /^\$(?!\$)/.test(after.textContent)) {
          before.textContent=before.textContent.slice(0,-1); after.textContent=after.textContent.slice(1);
          const span=document.createElement('span'); span.textContent=`$${code.textContent}$`; code.replaceWith(span);
        }
      }
      prepareQiitaMathScope(article);
      await document.fonts.ready;
      await window.MathJax.typesetPromise([article]);
    } else {
      // Direct TeX-to-SVG conversion does not install document styles.
      // Include SVG layout and visually hidden assistive MathML styles.
      window.MathJax.startup.document.clear();
      window.MathJax.startup.document.updateDocument();
    }
    for (const error of article.querySelectorAll('[data-mjx-error]')) diagnostics.push(`math: ${error.getAttribute('data-mjx-error')}`);
    article.getBoundingClientRect(); // Start font loads before awaiting the current FontFaceSet.ready.
    await document.fonts.ready;
  });
}

export function prepareQiitaMathScope(article) {
  for (const node of article.querySelectorAll('a,h1,h2,h3,h4,h5,h6')) node.classList.add('mdv-math-ignore');
}
