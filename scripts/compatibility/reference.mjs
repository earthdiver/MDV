import mermaid from 'mermaid';

// An independent reference page: no MDV renderer, stylesheet, or SVG sanitizer.
window.compatReference = async ({ kind, code, theme, options, display, mathContext }) => {
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
      window.MathJax.texReset();
      if (mathContext) container.style.font = `${mathContext.fontSize}/${mathContext.lineHeight} ${mathContext.fontFamily}`;
      let mathParent = container;
      if (!display && mathContext) {
        // Compare the same paragraph context, not a bare inline SVG at the
        // top of a div. This is a declared harness setting, not copied MDV CSS.
        mathParent = document.createElement('p');
        mathParent.style.cssText = `margin:0;font:${mathContext.fontSize}/${mathContext.lineHeight} ${mathContext.fontFamily}`;
        container.append(mathParent);
      }
      mathParent.append(await window.MathJax.tex2svgPromise(code, { display: !!display }));
      // Conversion alone does not install the SVG/assistive-MathML styles.
      window.MathJax.startup.document.clear();
      window.MathJax.startup.document.updateDocument();
      const assistive = container.querySelector('mjx-assistive-mml');
      if (assistive && getComputedStyle(assistive).position !== 'absolute') throw new Error('MathJax assistive styles were not installed');
      if (container.querySelector('[data-mjx-error]')) throw new Error(container.textContent);
    } else throw new Error(`No reference renderer: ${kind}`);
    await document.fonts.ready;
    return { rendered: true };
  } catch (error) {
    container.textContent = code;
    return { rendered: false, error: String(error) };
  }
};
