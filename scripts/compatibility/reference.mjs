import mermaid from 'mermaid';

// An independent reference page: no MDV renderer, stylesheet, or SVG sanitizer.
window.compatReference = async ({ kind, code, theme, options, display, mathContext, mode }) => {
  const container = document.getElementById('reference');
  container.replaceChildren();
  document.documentElement.style.background = theme === 'dark' ? '#0d1117' : '#ffffff';
  document.documentElement.style.color = theme === 'dark' ? '#e6edf3' : '#1f2328';
  try {
    if (kind === 'mermaid') {
      mermaid.initialize({ ...options, theme: theme === 'dark' ? 'dark' : 'default', deterministicIDSeed: 'compatibility' });
      // Gantt and other responsive renderers measure the supplied container.
      // Measuring the page viewport and shrinking afterward is not equivalent.
      const result = await mermaid.render('reference-diagram', code, container);
      container.innerHTML = result.svg;
    } else if (kind === 'math') {
      await window.MathJax.startup.promise;
      const runtime = window.MathJax;
      if (mode === 'qiita') {
        runtime.startup.useOutput('chtml', true);
        runtime.startup.getComponents(); runtime.startup.makeMethods();
      }
      window.MathJax.texReset();
      if (mathContext) {
        container.style.font = `${mathContext.fontSize}/${mathContext.lineHeight} ${mathContext.fontFamily}`;
        document.documentElement.style.color = mathContext.color;
        document.documentElement.style.background = mathContext.background;
      }
      if (mode === 'qiita') {
        // Declared Qiita paint gutters; no product stylesheet or rendered math is copied.
        const style = document.createElement('style');
        style.textContent = '#reference mjx-container { vertical-align:middle; padding-block:1px; overflow-x:auto; overflow-y:hidden; } #reference mjx-container[display="true"][width="full"] {min-width:100% !important;} #reference mjx-math,#reference mjx-assistive-mml {line-height:.2; padding-inline:2px; max-width:100%; overflow-x:auto; overflow-y:hidden;}';
        document.head.append(style);
      }
      let mathParent = container;
      if (!display && mathContext) {
        // Compare the same paragraph context, not a bare inline SVG at the
        // top of a div. This is a declared harness setting, not copied MDV CSS.
        mathParent = document.createElement('p');
        mathParent.style.cssText = `margin:0;font:${mathContext.fontSize}/${mathContext.lineHeight} ${mathContext.fontFamily}`;
        container.append(mathParent);
      }
      await document.fonts.ready;
      mathParent.append(mode === 'qiita'
        ? await runtime.tex2chtmlPromise(code, {...runtime.getMetricsFor(mathParent, !!display), display:!!display})
        : await runtime.tex2svgPromise(code, { display: !!display }));
      // Conversion alone does not install the SVG/assistive-MathML styles.
      window.MathJax.startup.document.clear();
      window.MathJax.startup.document.updateDocument();
      const assistive = container.querySelector('mjx-assistive-mml');
      if (assistive && getComputedStyle(assistive).position !== 'absolute') throw new Error('MathJax assistive styles were not installed');
      if (container.querySelector('[data-mjx-error]')) throw new Error(container.textContent);
    } else throw new Error(`No reference renderer: ${kind}`);
    container.getBoundingClientRect();
    await document.fonts.ready;
    return { rendered: true };
  } catch (error) {
    container.textContent = code;
    return { rendered: false, error: String(error) };
  }
};
