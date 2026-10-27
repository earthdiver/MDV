import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../markdown.mjs';

const render = (source, mode = 'github') => renderMarkdown(source, { mode });

test('Qiita heading suffixes cannot collide with authored numbered headings', () => {
  for (const titles of [['Example', 'Example-1', 'Example', 'Example-2', 'Example'], ['Example', 'Example', 'Example-1', 'Example']]) {
    const { outline } = render(titles.map(title => '# ' + title).join('\n\n'), 'qiita');
    assert.equal(new Set(outline.map(item => item.id)).size, titles.length);
  }
});

test('definitions immediately inside Qiita notes are visible throughout the document', () => {
  for (const blank of ['', '\n']) {
    const { html } = render(`Before [read][ref] and [nested][deep].\n\n:::note info\n${blank}[ref]: https://example.com/ref\n\nInside [read][ref].\n\n:::note warn\n[deep]: https://example.com/deep\n\nNested [read][ref].\n:::\n:::\n\n:::note alert\nSibling [nested][deep].\n:::\n\nAfter [read][ref].`, 'qiita');
    assert.equal((html.match(/href="https:\/\/example.com\/ref"/g) || []).length, 4);
    assert.equal((html.match(/href="https:\/\/example.com\/deep"/g) || []).length, 2);
    assert.doesNotMatch(html, /\[read\]|\[nested\]/);
  }
  const { html } = render('Outside[^x]\n\n:::note info\n[^x]: A note\n\nInside[^x]\n:::', 'qiita');
  assert.match(html, /id="mdv-content-user-content-fn-x"/);
  assert.equal((html.match(/data-footnote-ref/g) || []).length, 2);
});

for (const mode of ['github', 'qiita']) {
  test(`${mode}: CommonMark blocks, nested lists, literal code and escaped markers`, () => {
    const { html } = render('# H\n\n    <literal>\n\n1. one\n   - two\n\n\\*escaped\\*\n\n---', mode);
    for (const value of ['<h1', '<ol>', '<ul>', '*escaped*', '<hr>']) assert.ok(html.includes(value), value);
    assert.match(html, /&(?:lt;|#x3C;)literal>/);
  });
  test(`${mode}: GFM tables, tasks, autolinks and strikethrough`, () => {
    const { html } = render('| L | R |\n| :-- | --: |\n| a | b |\n\n- [x] yes\n- [ ] no\n\n~~deleted~~ https://example.com user@example.com', mode);
    for (const value of ['<table>', 'align="right"', 'type="checkbox"', 'checked', 'disabled', '<del>deleted</del>', 'href="https://example.com"', 'href="mailto:user@example.com"']) assert.ok(html.includes(value), value);
  });
  test(`${mode}: Japanese headings, duplicate slugs and footnotes`, () => {
    const result = render('# 日本語の見出し\n\n## 日本語の見出し\n\ntext[^x]\n\n[^x]: footnote', mode);
    assert.deepEqual(result.outline.map(h => h.anchor), ['日本語の見出し', '日本語の見出し-1']);
    assert.match(result.html, /id="mdv-content-user-content-fn-x"/);
    assert.match(result.html, /href="#user-content-fn-x"/);
    assert.match(result.html, /id="mdv-content-footnote-label"/);
    assert.match(result.html, /aria-describedby="mdv-content-footnote-label"/);
  });
  test(`${mode}: safe HTML remains; active content and dangerous URLs are removed`, () => {
    const { html } = render('<details open><summary>Details</summary>\n\n**bold**\n\n</details>\n\n<script>alert(1)</script><iframe src="https://evil.test"></iframe>\n\n<img src="x" onerror="alert(1)" style="position:fixed" srcset="https://evil.test 2x">\n\n[x](javascript:alert%281%29)\n\n<form><input type="password" name="document"></form>', mode);
    assert.match(html, /<details open>/);
    assert.match(html, /<strong>bold<\/strong>/);
    assert.doesNotMatch(html, /<script|<iframe|onerror|style=|srcset=|javascript:|<form|type="password"|name="document"/);
  });
  test(`${mode}: inline dollars, backtick math, fenced math and code isolation`, () => {
    const { html } = render('$x^2$ and $`y_1`$\n\n```math\n\\frac{1}{2}\n```\n\n`$not_math$`', mode);
    assert.equal((html.match(/data-mdv-tex=/g) || []).length, mode === 'github' ? 1 : 3);
    if (mode === 'github') assert.match(html, /\$x\^2\$ and \$<code>y_1<\/code>\$/);
    else assert.match(html, /data-mdv-tex="y_1"/);
    assert.doesNotMatch(html, /data-mdv-tex="`/);
    assert.match(html, /<code>\$not_math\$<\/code>/);
  });
  test(`${mode}: Mermaid is preserved for the offline diagram renderer`, () => {
    const { html } = render('```mermaid\nflowchart LR\n A-->B\n```', mode);
    assert.match(html, /class="mermaid-source"/);
    assert.match(html, /A--&#x3E;B|A--&gt;B|A-->B/);
  });
  test(`${mode}: emoji and mentions stay out of code and links`, () => {
    const { html } = render(':rocket: @alice\n\n`:rocket: @alice`\n\n[:rocket:](https://example.com)', mode);
    assert.match(html, /🚀/);
    if (mode === 'qiita') assert.ok(html.includes('href="https://qiita.com/alice"'));
    else assert.doesNotMatch(html, /href="https:\/\/github.com\/alice"/);
    assert.match(html, /<code>:rocket: @alice<\/code>/);
    assert.match(html, />:rocket:<\/a>/);
  });
  test(`${mode}: invalid math and unsupported diagrams retain readable source`, () => {
    const result = render('```math\n\\notacommand{x}\n```\n\n```plantuml\nAlice -> Bob\n```', mode);
    assert.equal(result.diagnostics.length, 1);
    assert.match(result.html, /notacommand/);
    assert.match(result.html, /Alice/);
  });
}

test('soft breaks and single-tilde behavior differ by mode', () => {
  assert.match(render('a\nb\n\n~x~').html, /<p>a\nb<\/p>/);
  assert.match(render('a\nb\n\n~x~').html, /<del>x<\/del>/);
  assert.match(render('a\nb\n\n~x~', 'qiita').html, /<p>a<br>\nb<\/p>/);
  assert.doesNotMatch(render('~x~', 'qiita').html, /<del>/);
});
test('all five GitHub alert types; Qiita preserves the quote text', () => {
  for (const type of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']) {
    const source = `> [!${type}]\n> **body**\n>\n> second paragraph`;
    assert.ok(render(source).html.includes(`markdown-alert-${type.toLowerCase()}`));
    assert.match(render(source).html, /<strong>body<\/strong>/);
    assert.doesNotMatch(render(source, 'qiita').html, /markdown-alert/);
  }
});
test('Qiita notes support lists, fenced code, nested notes, and all tones', () => {
  const source = ':::note\n**body**\n\n- first\n- second\n\n```text\n:::\n```\n\n:::note warn\nwarning\n:::\n:::\n\n:::note alert\nalert\n:::';
  const { html, diagnostics } = render(source, 'qiita');
  for (const tone of ['info', 'warn', 'alert']) assert.ok(html.includes(`qiita-note-${tone}`));
  assert.match(html, /<ul>/);
  assert.match(html, /<code class="language-text hljs">:::/);
  assert.equal(diagnostics.length, 0);
  assert.doesNotMatch(render(source).html, /qiita-note/);
});
test('Qiita fences in code and HTML are not interpreted', () => {
  for (const source of ['```text\n:::note warn\nx\n:::\n```', '    :::note info\n    x\n    :::', '<pre>\n:::note info\nx\n:::\n</pre>']) {
    assert.doesNotMatch(render(source, 'qiita').html, /class="qiita-note/);
  }
});
test('unclosed Qiita notes are readable and reported', () => {
  const result = render(':::note info\nbody', 'qiita');
  assert.match(result.html, /:::note info/);
  assert.equal(result.diagnostics.length, 1);
});
test('reference links and footnotes retain document-wide scope across Qiita notes', () => {
  const result = render('Before [label][ref]\n\n:::note info\nInside [label][ref] with footnote[^one]\n:::\n\n[ref]: https://example.com\n[^one]: Footnote', 'qiita');
  assert.equal((result.html.match(/href="https:\/\/example.com"/g) || []).length, 2);
  assert.match(result.html, /id="mdv-content-user-content-fn-one"/);
});
test('Qiita filenames are escaped; diff code highlights additions and removals', () => {
  const result = render('```diff_python:sample.py\n-print("old")\n+print("new")\n```\n\n```js:<img>\nx\n```', 'qiita');
  assert.match(result.html, /<figcaption>sample.py<\/figcaption>/);
  assert.match(result.html, /diff-add/);
  assert.match(result.html, /diff-remove/);
  assert.match(result.html, /<figcaption>&#x3C;img>|<figcaption>&lt;img>/);
  assert.doesNotMatch(render('```js:file.js\nx\n```').html, /figcaption/);
});
test('large Qiita diff blocks skip highlighting for the entire block', () => {
  const code = '+const number = 42;\n'.repeat(6000) + '-<script>literal</script>\n';
  const { html } = render('```diff_javascript:large.patch\n' + code + '```', 'qiita');
  assert.match(html, /<figcaption>large.patch<\/figcaption>/);
  assert.doesNotMatch(html, /diff-line|hljs-keyword|<script>/);
  assert.match(html, /const number = 42;/);
  assert.match(html, /literal/);
  assert.ok(html.length < code.length + 500);
});
test('frontmatter values are displayed without executing or expanding unsafe YAML', () => {
  const result = render('---\ntitle: "<script>evil</script>"\ntags: [one, two]\n---\n\n# Body');
  assert.match(result.html, /<th>title<\/th>/);
  assert.doesNotMatch(result.html, /<script>/);
  assert.equal(result.outline.length, 1);
});
test('Qiita standalone links are cards without fetching metadata', () => {
  assert.match(render('https://example.com', 'qiita').html, /class="link-card"/);
  assert.doesNotMatch(render('[label](https://example.com)', 'qiita').html, /class="link-card"/);
  assert.doesNotMatch(render('https://example.com').html, /class="link-card"/);
});
test('Qiita invalid standalone URLs remain ordinary links without losing the document', () => {
  for (const link of ['https://example.com:99999', '<http://>', '[http://](http://)']) {
    const { html, outline } = render(`# Before\n\n${link}\n\nAfter`, 'qiita');
    assert.match(html, /Before/);
    assert.match(html, /<p>After<\/p>/);
    assert.match(html, /<a href="https?:\/\//);
    assert.doesNotMatch(html, /class="link-card"/);
    assert.equal(outline.length, 1);
  }
});
test('mode and document size are validated', () => {
  assert.throws(() => renderMarkdown('x', { mode: 'unknown' }));
  assert.throws(() => renderMarkdown('x'.repeat(4 * 1024 * 1024 + 1)));
});

test('HTML headings retain explicit IDs as well as generated anchors in both modes', () => {
  for (const mode of ['github', 'qiita']) {
    const { html, outline } = render('[jump](#custom)\n\n<h2 id="custom">Title</h2>\n\n## Title', mode);
    assert.match(html, /id="mdv-content-custom"/);
    assert.match(html, /href="#custom"/);
    assert.match(html, /id="mdv-heading-title"/);
    assert.deepEqual(outline.map(item => item.anchor), ['title', 'title-1']);
    assert.deepEqual(outline.map(item => item.text), ['Title', 'Title']);
  }
});

test('authored HTML IDs cannot collide with generated heading IDs', () => {
  for (const mode of ['github', 'qiita']) {
    const { html, outline } = render('<a id="heading-target"></a>\n\n# Target\n\n<h2 id="heading-other">Other</h2>', mode);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(outline.map(item => item.id), ['mdv-heading-target', 'mdv-heading-other']);
  }
});

test('GitHub processes Markdown before finding dollar math', () => {
  for (const [source, html] of [
    [String.raw`$\(1\)$`, '<p>$(1)$</p>'],
    [String.raw`\$x$`, '<p>$x$</p>'],
    [String.raw`$x\$`, '<p>$x$</p>'],
    [String.raw`$\\{1\\}$`, String.raw`<p>$\{1\}$</p>`],
    ['$&#40;1&#x29;$', '<p>$(1)$</p>'],
    ['$$\n' + String.raw`\(1\)` + '\n$$', '<p>$$\n(1)\n$$</p>'],
    ['$``' + String.raw`\{1\}` + '``$', String.raw`<p>$<code>\{1\}</code>$</p>`],
    ['$`x +\ny`$', '<p>$<code>x + y</code>$</p>'],
    [String.raw`$\text{a *b* c}$`, String.raw`<p>$\text{a <em>b</em> c}$</p>`],
    ['$a<span>b</span>c$', '<p>$a<span>b</span>c$</p>'],
    ['$a' + '\\' + '\nb$', '<p>$a<br>\nb$</p>'],
  ]) {
    assert.equal(render(source, 'github').html, html, source);
  }
  assert.match(render('`' + String.raw`$\(1\)$` + '`', 'github').html, /<code>\$\\\(1\\\)\$<\/code>/);
  assert.ok(render(String.raw`$\(1\)$`, 'qiita').html.includes(String.raw`data-mdv-tex="\(1\)"`));
});

test('GitHub decodes references once and leaves encoded HTML as text', () => {
  for (const source of [String.raw`$\&lt;$`, '$&amp;lt;$'])
    assert.equal(render(source).html, '<p>$&#x26;lt;$</p>', source);
  assert.equal(render('$`&lt;`$').html, '<p>$<code>&#x26;lt;</code>$</p>');
  assert.ok(render('```math\n&lt;\n```').html.includes('data-mdv-tex="&#x26;lt;"'));
  const html = render('$&lt;img src=x onerror=alert(1)&gt;$').html;
  assert.equal(html, '<p>$&#x3C;img src=x onerror=alert(1)>$</p>');
});

test('math preserves AMS environments and explicit tags for MathJax', () => {
  const tex = String.raw`\begin{align} x&=1 \tag{A} \end{align}`;
  for (const mode of ['github', 'qiita']) {
    const result = render('```math\n'+tex+'\n```', mode);
    assert.match(result.html, /data-mdv-tex=/);
    assert.match(result.html, /\\begin\{align\}/);
    assert.match(result.html, /\\tag\{A\}/);
    assert.deepEqual(result.diagnostics, []);
  }
});

test('Qiita supports spaced note fences and escaped table pipes without altering code blocks', () => {
  assert.match(render('::: note info\nInformation\n:::', 'qiita').html, /qiita-note-info/);
  for (const count of [1,2,3,4]) {
    const cell = '`'+'\\'.repeat(count)+'|`';
    const table = render('| One | Two |\n| --- | --- |\n| '+cell+' | end |','qiita').html;
    assert.ok(table.includes('<td><code>'+'\\'.repeat(count-1)+'|</code></td>'),table);
    assert.match(table, /<td>end<\/td>/);
    const literal = render('```text\n| '+cell+' | end |\n```','qiita').html;
    assert.ok(literal.includes(cell));
  }
});

test('Qiita browser math preserves TeX for post-Markdown typesetting and drops math captions', () => {
  const result = renderMarkdown('```math:example\n\\begin{align} x&=1 \\end{align}\n```',{mode:'qiita',deferMath:true});
  assert.match(result.html,/data-mdv-tex=/);
  assert.doesNotMatch(result.html,/figcaption|katex/);
});

test('Qiita note closes immediately after a list and resets ordered list starts', () => {
  const {html} = render(':::note info\n- One\n- Two\n:::\n\n4. Four','qiita');
  assert.match(html,/qiita-note-info/);
  assert.doesNotMatch(html,/:::|start="4"/);
  assert.match(render('4. Four','github').html,/start="4"/);
});

test('Qiita three-space closing fence preserves the following anonymous block', () => {
  const {html} = render('   :::note warn\nWarning\n   :::\n\n:::note info\nLiteral note\n:::\n\nAfter','qiita');
  assert.match(html,/qiita-note-warn/);
  assert.doesNotMatch(html,/qiita-note-info/);
  assert.match(html,/:::note info/);
  assert.match(html,/<p>After<\/p>/);
});

test('Qiita notes inside list items retain the list, following items and references', () => {
  const source = '1. First\n\n   :::note info\n   [Inside][ref]\n   :::\n\n2. Second\n\n[ref]: https://example.com';
  const {html,diagnostics} = render(source,'qiita');
  assert.match(html,/<ol>[\s\S]*<li>[\s\S]*qiita-note-info[\s\S]*<\/li>[\s\S]*<li>[\s\S]*Second/);
  assert.match(html,/href="https:\/\/example.com"/);
  assert.doesNotMatch(html,/:::/); assert.deepEqual(diagnostics,[]);
  const literal = render('1. Step\n\n   ```text\n   :::note info\n   Literal\n   :::\n   ```','qiita').html;
  assert.doesNotMatch(literal,/class="qiita-note/);
  assert.match(literal,/:::note info/);
});

test('raw image dimensions survive sanitizing while unrelated and resource-bearing styles do not', () => {
  const {html} = render('<img src="icon.svg" style="height:22px!important;width:2em;margin-left:3px;position:fixed;background:url(https://example.com/track);">');
  assert.match(html, /style="height:22px !important;width:2em"/);
  assert.doesNotMatch(html, /margin-left|position|background|track/);
  for (const style of ['height:expression(alert(1))', 'height:var(--size)', 'height:url(https://example.com)', 'height:22px!important;background:url(x)', 'height:22px\\3b position:fixed']) {
    const result = render(`<img src="icon.svg" style="${style}">`).html;
    assert.doesNotMatch(result, /expression|var\(|url\(|position|background/);
  }
  assert.doesNotMatch(render('<div style="height:22px">text</div>').html, /style=/);
});

test('Qiita preserves legacy font colors without accepting active attributes or styles', () => {
  const source = '<font color="red" onclick="alert(1)" style="position:fixed" face="Example">New!<font/>';
  const html = render(source, 'qiita').html;
  assert.match(html, /<font color="red">New!/);
  assert.doesNotMatch(html, /onclick|style=|face=/);
  assert.doesNotMatch(render(source, 'github').html, /<font/);
  assert.doesNotMatch(render(source, 'github').html, /onclick|style=|face=/);
});

test('horizontal rules enclosing ordinary Markdown are not YAML metadata', () => {
  const source='---\n**Advertisement :)**\n\n- [Project](https://example.com)\n\nDescription.\n\n---\n\n# Body';
  const html=render(source).html;
  assert.equal((html.match(/<hr>/g)||[]).length,2);
  assert.match(html,/<strong>Advertisement :\)<\/strong>/);
  assert.match(html,/<ul>/);assert.doesNotMatch(html,/<pre>|frontmatter/);
});

test('GitHub outdented HTML ends a list and keeps its body literal',()=>{
  const source='1. Before\n<example>\n## Literal heading\n- **Literal item**\n</example>\n\nAfter';
  const {html}=render(source);
  assert.match(html,/<ol>\s*<li>Before<\/li>\s*<\/ol>/);
  assert.match(html,/## Literal heading/);assert.match(html,/- \*\*Literal item\*\*/);
  assert.doesNotMatch(html,/<h2|<strong|<example/);
  assert.match(render('Before\n<example>\n## Heading\n</example>').html,/<h2/);
  assert.match(render('- Before\n  <example>\n  ## Heading\n  </example>').html,/<h2/);
  assert.match(render('```html\n1. Before\n<example>\n## Heading\n```').html,/language-html/);
});

test('GitHub strips authored HTML text colors as the service does', () => {
  const html = render('<font color="red">Red</font><span style="color:blue">Blue</span>', 'github').html;
  assert.doesNotMatch(html, /<font|color=|style=/);
  assert.match(html, /Red/);
  assert.match(html, /Blue/);
});
