import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { OriginalEngine } from '../../../scripts/upstream/client.mjs';
const observations = Object.fromEntries(await Promise.all(['github','qiita'].map(async mode => [mode, JSON.parse(await readFile(`tests/compatibility/${mode}-presentation.json`, 'utf8'))])));
const markdown = `# Heading one

Paragraph with **strong**, [link](https://example.com), and \`inline\`.

## Heading two

Text[^one], again[^one], and another[^two].

### Heading three

Paragraph.

#### Heading four

Paragraph.

##### Heading five

Paragraph.

###### Heading six

> Quoted text

- First
- Second

1. First
2. Second

| Header | Other |
| --- | --- |
| One | Two |
| Three | Four |

:::note info
Information
:::

:::note warn
Warning
:::

:::note alert
Caution
:::

\`\`\`ruby:sample.rb
puts 'Hello'
\`\`\`

\`\`\`
plain code
\`\`\`

<details><summary>Details</summary>

Hidden text

</details>

[^one]: First footnote
[^two]: Second footnote
`;
for (const engine of ['legacy','original']) test.describe(`${engine} service presentation`, () => {
  test.skip(engine === 'original' && !process.env.MDV_RUBY, 'Real original engines require MDV_RUBY');
  let engines = {};
  test.beforeAll(async () => { if(engine==='original') for(const mode of ['github','qiita']) engines[mode]=await OriginalEngine.start(mode,{desktop:true}); });
  test.afterAll(() => Object.values(engines).forEach(e=>e.close()));
  async function render(page, mode, theme='light', source=markdown) {
    const markdown = source;
    const original=engine==='original'?{...await engines[mode].render(markdown),metadata:engines[mode].metadata}:undefined;
    await page.evaluate(options=>window.mdv.render(options),{engine,mode,theme,markdown,original});
  }
  test('github: emoji text and TextMate code colors preserve source and use Primer roles', async ({page}) => {
    const source=':wink: `:wink:`\n\n```js\nconst foo = function (bar) { return bar++; };\nconsole.log(foo(5));\n```';
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    for(const theme of ['light','dark']) {
      await render(page,'github',theme,source);
      await expect(page.locator('#document p')).toHaveText('😉 :wink:');
      await expect(page.locator('#document p code')).toHaveText(':wink:');
      await expect(page.locator('pre')).toHaveText('const foo = function (bar) { return bar++; };\nconsole.log(foo(5));\n');
      const colors=await page.locator('pre span').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.textContent.trim(),getComputedStyle(n).color])));
      const roles=await page.locator('#document').evaluate(n=>{const s=getComputedStyle(n);return ['keyword','entity','constant'].map(k=>s.getPropertyValue('--prettylights-syntax-'+k).trim());});
      const resolved=await page.evaluate(roles=>roles.map(color=>{const n=document.createElement('span');n.style.color=color;document.body.append(n);const result=getComputedStyle(n).color;n.remove();return result;}),roles);
      expect(colors.const).toBe(resolved[0]);expect(colors.foo).toBe(resolved[1]);expect(colors['++']).toBe(resolved[2]);
    }
  });
  test('github: properties, class names and regular expressions use service token roles',async({page})=>{
    const source='```js\nimport Widget from "widget";\nconst value = new Widget();\nconst handler = value.render;\nconst pattern = /a\\d+/;\nhandler();\n```';
    await page.goto('/');await page.waitForFunction(()=>window.mdv);await render(page,'github','light',source);
    const tokens=await page.locator('pre span').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,color:getComputedStyle(n).color})));
    for(const [text,color]of Object.entries({Widget:'rgb(149, 56, 0)',value:'rgb(31, 35, 40)',handler:'rgb(31, 35, 40)',render:'rgb(5, 80, 174)','\\d':'rgb(10, 48, 105)','+':'rgb(5, 80, 174)'})){
      const matches=tokens.filter(n=>n.text===text);expect(matches.length,text).toBeGreaterThan(0);expect(matches.every(n=>n.color===color)).toBe(true);
    }
  });
  test('qiita: quotes trim edge margins and images keep their native baseline and white backing',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    await render(page,'qiita','light','> Quoted paragraph\n\n<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" width="22" height="22">');
    await expect(page.locator('blockquote p')).toHaveCSS('margin-top','0px');await expect(page.locator('blockquote p')).toHaveCSS('margin-bottom','0px');
    await expect(page.locator('#document img')).toHaveCSS('vertical-align','baseline');await expect(page.locator('#document img')).toHaveCSS('background-color','rgb(255, 255, 255)');
    const bar=await page.locator('blockquote').evaluate(n=>{const s=getComputedStyle(n,'::before');return {top:s.top,height:s.height,quote:n.getBoundingClientRect().height};});
    expect(bar.top).toBe('0px');expect(Math.abs(parseFloat(bar.height)-bar.quote)).toBeLessThan(.1);
  });
  test('qiita: Japanese typesetting, horizontal rules and table stripes match the service',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    await render(page,'qiita','light','# 日本語APIの見出し\n\n日本語とAPIの本文。 `inline`\n\n---\n\n| Head | Other |\n| --- | --- |\n| First | A |\n| Second | B |');
    await expect(page.locator('#document')).toHaveCSS('text-autospace','normal');
    await expect(page.locator('#document h1')).toHaveCSS('font-feature-settings','"palt"');
    await expect(page.locator('#document code')).toHaveCSS('text-autospace','no-autospace');
    await expect(page.locator('#document hr')).toHaveCSS('height','1px');await expect(page.locator('#document hr')).toHaveCSS('margin-top','48px');
    await expect(page.locator('#document table')).toHaveCSS('display','inline-block');
    await expect(page.locator('#document tbody tr').first()).toHaveCSS('background-color','rgb(237, 238, 238)');
    await expect(page.locator('#document tbody tr').last()).toHaveCSS('background-color','rgb(255, 255, 255)');
    await expect(page.locator('#document td').first()).toHaveCSS('border-right-width','1px');
  });
  test('github: C and cc use their distinct service syntax rules',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    const code='int add(int a) { return a + 1; }\nres = add(1);\nif (res == NULL) { CHECK(true); }';
    await render(page,'github','light','```C\n'+code+'\n```\n\n```cc\n'+code+'\n```');
    const c=page.locator('pre').first(),cpp=page.locator('pre').last();
    await expect(c.locator('span').filter({hasText:/^int$/}).first()).toHaveCSS('color','rgb(31, 35, 40)');
    await expect(c.locator('span').filter({hasText:/^CHECK$/})).toHaveCSS('color','rgb(102, 57, 186)');
    await expect(cpp.locator('span').filter({hasText:/^int$/}).first()).toHaveCSS('color','rgb(207, 34, 46)');
    await expect(cpp.locator('span').filter({hasText:/^CHECK$/})).toHaveCSS('color','rgb(5, 80, 174)');
    await expect(cpp.locator('span').filter({hasText:/res = add\(/})).toHaveCSS('color','rgb(31, 35, 40)');
    expect(await c.textContent()).toBe(code);expect((await cpp.textContent()).trimEnd()).toBe(code);
  });
  test('github: JSONC fragments retain string roles and highlight invalid keys',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    await render(page,'github','light','```jsonc\n"outer": { approve: false, "valid": true } // Comment\n```');
    const invalid=page.locator('pre span').filter({hasText:/^approve$/});
    await expect(invalid).toHaveCSS('color','rgb(209, 36, 47)');await expect(invalid).toHaveCSS('font-style','normal');await expect(invalid).toHaveCSS('background-color','rgb(255, 235, 233)');
    await expect(page.locator('pre span').filter({hasText:/^outer$/})).toHaveCSS('color','rgb(10, 48, 105)');
    await expect(page.locator('pre span').filter({hasText:/^"valid"$/})).toHaveCSS('color','rgb(5, 80, 174)');
    await expect(page.locator('pre span').filter({hasText:/^\/\/$/})).toHaveCSS('color','rgb(89, 99, 110)');
  });
  test('github: code frontmatter and rejected links preserve service presentation',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    await render(page,'github','light','```md\n---\napplyTo: "**"\n---\n# Example\n```\n\nBefore [agent mode](vscode://example) after.\n\n## Last heading');
    await expect(page.locator('#document p')).toHaveText('Before agent mode after.');
    await expect(page.locator('#document p a')).toHaveCount(0);
    expect(await page.locator('#document p').evaluate(n=>n.childNodes.length)).toBe(1);
    await expect(page.locator('#document > h2')).toHaveCSS('margin-bottom','16px');
    const tokens=await page.locator('pre span').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,color:getComputedStyle(n).color})));
    expect(tokens.filter(t=>t.text==='---').map(t=>t.color)).toEqual(['rgb(10, 48, 105)','rgb(10, 48, 105)']);
    expect(tokens.find(t=>t.text==='applyTo').color).toBe('rgb(5, 80, 174)');
  });
  test('github: Markdown code examples distinguish delimiters, labels and URLs',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    await render(page,'github','light','```md\n`inline`\n[label](https://example.com)\n![picture](https://example.com/a.png)\n```');
    const tokens=await page.locator('pre span').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,color:getComputedStyle(n).color})));
    for(const [text,color]of Object.entries({'![':'rgb(10, 48, 105)',picture:'rgb(31, 35, 40)','https://example.com/a.png':'rgb(10, 48, 105)','`':'rgb(10, 48, 105)',inline:'rgb(5, 80, 174)','[':'rgb(10, 48, 105)',label:'rgb(31, 35, 40)',']':'rgb(10, 48, 105)','(':'rgb(10, 48, 105)','https://example.com':'rgb(10, 48, 105)',')':'rgb(10, 48, 105)'})){
      const matches=tokens.filter(n=>n.text===text);expect(matches.length,text).toBeGreaterThan(0);expect(matches.every(n=>n.color===color),text).toBe(true);
    }
  });
  test('github: Go declarations, selectors and trailing blank lines match service roles',async({page})=>{
    const code='package example\n\nimport "fmt"\n\ntype Options struct { URL string }\nfunc run(opts *Options) error { fmt.Print(opts.URL); return nil }';
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    await render(page,'github','light','```go\n'+code+'\n\n```');
    expect(await page.locator('pre').textContent()).toBe(code);
    const tokens=await page.locator('pre span').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,color:getComputedStyle(n).color})));
    for(const [text,color]of Object.entries({package:'rgb(207, 34, 46)',Options:'rgb(31, 35, 40)',run:'rgb(31, 35, 40)',URL:'rgb(5, 80, 174)',Print:'rgb(5, 80, 174)','*':'rgb(5, 80, 174)','"fmt"':'rgb(10, 48, 105)'})){
      const matches=tokens.filter(n=>n.text===text);expect(matches.length,text).toBeGreaterThan(0);expect(matches.every(n=>n.color===color),text).toBe(true);
    }
  });
  test('github: Ruby bound variables, calls, constants and hash keys match the service',async({page})=>{
    const source='```ruby\nprocessor = Demo::Processor.new(hostname: "example.com")\nprocessor.filters << HTML::Pipeline::ExampleFilter\nprocessor.call(markdown)\n```';
    await page.goto('/');await page.waitForFunction(()=>window.mdv);await render(page,'github','light',source);
    const tokens=await page.locator('pre span').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,color:getComputedStyle(n).color})));
    for(const [text,color]of Object.entries({processor:'rgb(31, 35, 40)',Demo:'rgb(149, 56, 0)',ExampleFilter:'rgb(149, 56, 0)',HTML:'rgb(5, 80, 174)',hostname:'rgb(10, 48, 105)',new:'rgb(102, 57, 186)',markdown:'rgb(102, 57, 186)','<<':'rgb(31, 35, 40)'})){
      const matches=tokens.filter(n=>n.text===text);expect(matches.length,text).toBeGreaterThan(0);expect(matches.every(n=>n.color===color)).toBe(true);
    }
  });
  test('github: shell command arguments and Ruby escapes retain native colors',async({page})=>{
    const source='```sh\npython3 -m venv .venv\nsource .venv/bin/activate\ncd script\n./bootstrap\nprintf 28\n```\n\n```ruby\n"a\\nb"\n```';
    await page.goto('/');await page.waitForFunction(()=>window.mdv);await render(page,'github','light',source);
    const lines=await page.locator('pre').first().locator('span').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,color:getComputedStyle(n).color})));
    expect(lines.find(n=>n.text.includes('python3')).color).toBe('rgb(31, 35, 40)');
    expect(lines.find(n=>n.text==='source').color).toBe('rgb(5, 80, 174)');
    expect(lines.find(n=>n.text.includes('./bootstrap')).color).toBe('rgb(31, 35, 40)');
    expect(lines.find(n=>n.text.includes('28')).color).toBe('rgb(31, 35, 40)');
    const escape=page.locator('pre').nth(1).locator('span').filter({hasText:/^\\n$/});await expect(escape).toHaveCSS('color','rgb(10, 48, 105)');
  });
  test('github: partial script examples retain keyword and identifier roles',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    await render(page,'github','light','```javascript\nfor part in order:\n    use(part)\n```\n\n```ts\nprivate getValue(): Value | undefined { return undefined; }\n```');
    await expect(page.locator('pre').first().locator('span').filter({hasText:/^for$/})).toHaveCSS('color','rgb(207, 34, 46)');
    await expect(page.locator('pre').first().locator('span').filter({hasText:/^order$/})).toHaveCSS('color','rgb(31, 35, 40)');
    await expect(page.locator('pre').last().locator('span').filter({hasText:/^private$/})).toHaveCSS('color','rgb(207, 34, 46)');
  });
  test('github: Python call names use the function color without coloring parentheses',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    await render(page,'github','light','```python\nif x < 10:\n    process()\nfinish()\n```');
    for(const name of ['process','finish'])await expect(page.locator('pre span').filter({hasText:new RegExp('^'+name+'$')})).toHaveCSS('color','rgb(102, 57, 186)');
    await expect(page.locator('pre span').filter({hasText:/^\(\)$/}).first()).toHaveCSS('color','rgb(31, 35, 40)');
  });
  test('github: nested metadata stays a table and uppercase constants use constant colors',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    const source='---\nname: Example\nmetadata:\n  tools: inspect\n  nested:\n    value: "<img src=x>"\n---\n\n```js\nconst RUN = "example";\nconsole.log(RUN);\n```';
    await render(page,'github','light',source);
    await expect(page.locator('table.frontmatter > tbody > tr').nth(1).locator('th').first()).toHaveText('metadata');
    await expect(page.locator('table table thead th').filter({hasText:/^tools$/})).toHaveCount(1);
    await expect(page.locator('table table table td')).toHaveText('<img src=x>');
    await expect(page.locator('#document img')).toHaveCount(0);
    await expect(page.locator('pre span').filter({hasText:/^RUN$/})).toHaveCount(2);
    for(const token of await page.locator('pre span').filter({hasText:/^RUN$/}).all())await expect(token).toHaveCSS('color','rgb(5, 80, 174)');
  });
  test('github: JSON member fragments color keys without requiring enclosing braces',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    await render(page,'github','light','```json\n"package": "file:../package"\n```');
    await expect(page.locator('pre span').filter({hasText:/^"package"$/})).toHaveCSS('color','rgb(5, 80, 174)');
    await expect(page.locator('pre span').filter({hasText:/^file:\.\.\/package$/})).toHaveCSS('color','rgb(10, 48, 105)');
  });
  test('github: task lists hide bullets and position disabled checkboxes like the service',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    await render(page,'github','light','- [ ] Pending\n- [x] Complete\n- Regular');
    await expect(page.locator('.task-list-item')).toHaveCount(2);
    for(const item of await page.locator('.task-list-item').all())await expect(item).toHaveCSS('list-style-type','none');
    const inputs=page.locator('.task-list-item-checkbox');await expect(inputs).toHaveCount(2);
    await expect(inputs.first()).toBeDisabled();await expect(inputs.last()).toBeChecked();
    await expect(inputs.first()).toHaveCSS('margin','0px 3.2px 4px -22.4px');
    await expect(page.locator('#document li').last()).toHaveCSS('list-style-type','disc');
  });
  test('github: TypeScript uses syntax roles under the offline CSP',async({page})=>{
    const source='interface Shape { readonly size: number; draw(): void; }\nconst item = new Shape();\nitem.draw();\n';
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    await render(page,'github','light','```ts\n'+source+'```');
    await expect(page.locator('pre')).toHaveText(source);
    await expect(page.locator('[data-mdv-highlighter="tree-sitter"]')).toHaveCount(1);
    const tokens=await page.locator('pre span').evaluateAll(ns=>ns.map(n=>({text:n.textContent,color:getComputedStyle(n).color})));
    expect(tokens.filter(n=>n.text==='Shape').map(n=>n.color)).toEqual(['rgb(31, 35, 40)','rgb(149, 56, 0)']);
    expect(tokens.filter(n=>n.text==='draw').map(n=>n.color)).toEqual(['rgb(5, 80, 174)','rgb(102, 57, 186)']);
    expect(tokens.find(n=>n.text==='void').color).toBe('rgb(207, 34, 46)');
    expect(tokens.find(n=>n.text==='size').color).toBe('rgb(5, 80, 174)');
    expect(tokens.find(n=>n.text==='number').color).toBe('rgb(31, 35, 40)');
  });
  test('github: shell continuations, YAML lists and KQL calls preserve service colors',async({page})=>{
    const source=['```sh','export DEMO="value" \\', '  command','```','','```yaml','exporters: [console, debug]','```','','```kql','customMetrics | summarize count() by name','```'].join('\n');
    await page.goto('/');await page.waitForFunction(()=>window.mdv);await render(page,'github','light',source);
    const blocks=await page.locator('pre').evaluateAll(nodes=>nodes.map(pre=>{const result=[];const walker=document.createTreeWalker(pre,NodeFilter.SHOW_TEXT);while(walker.nextNode())for(const char of walker.currentNode.textContent)result.push({char,color:getComputedStyle(walker.currentNode.parentElement).color});return result;}));
    expect(blocks[0].filter(n=>['=','\\'].includes(n.char)).map(n=>n.color)).toEqual(['rgb(31, 35, 40)','rgb(31, 35, 40)']);
    expect(blocks[1].filter(n=>['[',',',']'].includes(n.char)).every(n=>n.color==='rgb(10, 48, 105)')).toBe(true);
    expect(blocks[2].filter(n=>['(',')'].includes(n.char)).map(n=>n.color)).toEqual(['rgb(31, 35, 40)','rgb(31, 35, 40)']);
  });
  test('github: sequence diagrams use service padding without an inline baseline gap',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    await render(page,'github','light','Before\n\n```mermaid\nsequenceDiagram\nparticipant A\nparticipant B\nA->>B: Message\n```\n\nAfter');
    const diagram=page.locator('.diagram'),svg=page.locator('.diagram-screen svg');
    await expect(diagram).toHaveCSS('margin-top','16px');await expect(svg).toHaveCSS('display','block');
    const bounds=await svg.evaluate(n=>({viewBox:n.getAttribute('viewBox').split(' ').map(Number),width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height,parent:n.closest('.diagram').getBoundingClientRect().height}));
    expect(bounds.viewBox[1]).toBe(-40);expect(bounds.parent).toBeCloseTo(Math.max(bounds.viewBox[3]*Math.min(1,bounds.width/bounds.viewBox[2]),180),1);
  });
  test('github: standalone override recovery does not affect valid class methods',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    await render(page,'github','light','```ts\noverride dispose() { super.dispose(); }\nclass A { override dispose() {} }\n```');
    const tokens=await page.locator('pre span').evaluateAll(ns=>ns.map(n=>({text:n.textContent,color:getComputedStyle(n).color})));
    expect(tokens.filter(n=>n.text==='override').map(n=>n.color)).toEqual(['rgb(102, 57, 186)','rgb(207, 34, 46)']);
    expect(tokens.filter(n=>n.text==='dispose').map(n=>n.color)).toEqual(['rgb(31, 35, 40)','rgb(102, 57, 186)','rgb(102, 57, 186)']);
  });
  test('github: standalone CSS declarations use syntax roles without a selector',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    await render(page,'github','light','```css\npadding: var(--size) 8px;\n```');
    const tokens=await page.locator('pre span').evaluateAll(ns=>ns.map(n=>({text:n.textContent,color:getComputedStyle(n).color})));
    expect(tokens.find(n=>n.text==='padding').color).toBe('rgb(5, 80, 174)');
    expect(tokens.find(n=>n.text==='var').color).toBe('rgb(102, 57, 186)');
    expect(tokens.find(n=>n.text==='--size').color).toBe('rgb(31, 35, 40)');
    expect(tokens.find(n=>n.text==='8').color).toBe('rgb(5, 80, 174)');
    expect(tokens.find(n=>n.text==='px').color).toBe('rgb(31, 35, 40)');
  });
  test('github: JSDoc tags use injected syntax and partial readonly stays plain',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    await render(page,'github','light','```ts\n/** See {@link Foo} */\n// @param {string} value\nprivate readonly _sessions = this._register(new DisposableMap<string, Session>());\n```');
    const tokens=await page.locator('pre span').evaluateAll(ns=>ns.map(n=>({text:n.textContent,color:getComputedStyle(n).color})));
    expect(tokens.find(n=>n.text==='@link').color).toBe('rgb(207, 34, 46)');
    expect(tokens.find(n=>n.text==='@param').color).toBe('rgb(207, 34, 46)');
    expect(tokens.find(n=>n.text==='readonly').color).toBe('rgb(31, 35, 40)');
  });
  test('github: PowerShell operators retain keyword colors inside paths',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    await render(page,'github','light','```powershell\n& .\\scripts\\vhs-demo\\inspect.ps1 <demo.gif> <inspection-dir>\n```');
    const operators=await page.locator('pre span').evaluateAll(ns=>ns.filter(n=>n.textContent==='-'||n.textContent==='&').map(n=>getComputedStyle(n).color));
    expect(operators).toEqual(['rgb(207, 34, 46)','rgb(207, 34, 46)','rgb(207, 34, 46)']);
  });
  test('github: PowerShell preserves variable and comment token boundaries',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    await render(page,'github','light','```powershell\n& $bootstrap -Repo <vscode-repo-root> # note\n```');
    const tokens=await page.locator('pre span').allTextContents();
    expect(tokens).toContain('$bootstrap');expect(tokens).toContain('#');expect(tokens).toContain(' note');
    expect(tokens).not.toContain(' $bootstrap ');
  });
  test('github: script fences remove one trailing blank line, preserving internal blank lines',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    await render(page,'github','light','```ts\ninterface A {}\n\ninterface B {}\n\n```\n\n```js\nconst x=1;\n\n\n```');
    expect(await page.locator('pre').first().textContent()).toBe('interface A {}\n\ninterface B {}');
    expect(await page.locator('pre').last().textContent()).toBe('const x=1;\n');
  });
  test('github: single-line highlighted blocks reserve the native minimum height',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    await render(page,'github','light','```sh\nnpm install example\n```\n\nText');
    expect(await page.locator('pre').evaluate(n=>n.getBoundingClientRect().height)).toBe(52);
  });
  test('github: only service-wrapped emoji enlarge; checks and code retain their metrics',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    await render(page,'github','light','⚠️ ✅ :wink: :warning: :white_check_mark: `⚠️ :wink:`');
    await expect(page.locator('#document g-emoji')).toHaveCount(2);
    await expect(page.locator('#document g-emoji').first()).toHaveText('⚠️');
    await expect(page.locator('#document g-emoji').first()).toHaveCSS('font-size','20px');
    await expect(page.locator('#document g-emoji').first()).toHaveCSS('display','inline-block');
    await expect(page.locator('#document p')).toHaveText('⚠️ ✅ 😉 ⚠️ ✅ ⚠️ :wink:');
    await expect(page.locator('#document code')).toHaveText('⚠️ :wink:');
  });
  test('github: quoted headings retain spacing and localhost URLs link outside code',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    await render(page,'github','light','Paragraph\n\n> ### Heading\n>\n> Text\n\nOpen http://localhost:8080, `http://localhost:8080` and http://localhostevil.example');
    const gap=await page.locator('#document').evaluate(n=>n.querySelector('blockquote').getBoundingClientRect().top-n.querySelector('p').getBoundingClientRect().bottom);expect(gap).toBe(24);
    expect(await page.locator('#document p a').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')))).toEqual(['http://localhost:8080','http://localhostevil.example']);
    await expect(page.locator('code a')).toHaveCount(0);
  });
  test('qiita: image outline and legacy font colors match the live article', async ({page}) => {
    // The malformed <font/> closing tag is intentional: it appears in the source.
    const source = '- Feature <font color="red">New!<font/>\n- Another <font color="red">New!<font/>\n- Plain item\n\n![Screenshot](screen.png)';
    await page.goto('/'); await page.waitForFunction(()=>window.mdv);
    await render(page,'qiita','light',source);
    expect(await page.locator('font[color]').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).color))).toEqual(['rgb(255, 0, 0)','rgb(255, 0, 0)']);
    expect(await page.locator('#document li').last().evaluate(n=>getComputedStyle(n).color)).not.toBe('rgb(255, 0, 0)');
    expect(await page.locator('#document img').evaluate(n=>getComputedStyle(n).boxShadow)).toBe('rgba(0, 0, 0, 0.12) 0px 0px 0px 1px');
    await page.locator('#document img').evaluate(n=>n.classList.add('emoji'));
    expect(await page.locator('#document img').evaluate(n=>getComputedStyle(n).boxShadow)).toBe('none');
    await render(page,'github','light','![Screenshot](screen.png)');
    expect(await page.locator('#document img').evaluate(n=>getComputedStyle(n).boxShadow)).toBe('none');
  });
  test('github: Creative Commons icons preserve the 22px source height', async ({page}) => {
    const source = '<p>CC BY-SA 4.0' + ['cc','by','sa'].map(name =>
      `<img src="https://mirrors.creativecommons.org/presskit/icons/${name}.svg" alt="" style="height:22px!important;margin-left:3px;vertical-align:text-bottom;">`).join('') + '</p>';
    await page.route('https://mirrors.creativecommons.org/**', route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="48"/></svg>'}));
    await page.goto('/'); await page.waitForFunction(()=>window.mdv);
    const original=engine==='original'?{...await engines.github.render(source),metadata:engines.github.metadata}:undefined;
    await page.evaluate(options=>window.mdv.render(options),{engine,mode:'github',markdown:source,original,allowRemoteImages:true});
    await expect(page.locator('#document img')).toHaveCount(3);
    await page.waitForFunction(()=>[...document.querySelectorAll('#document img')].every(n=>n.complete&&n.naturalWidth));
    expect(await page.locator('#document img').evaluateAll(nodes=>nodes.map(n=>({width:n.getBoundingClientRect().width,height:n.getBoundingClientRect().height})))).toEqual(Array(3).fill({width:22,height:22}));
  });
  test('qiita: short AMS equations have no automatic tags or scrollbars', async ({page}) => {
    const source = '```math\n'+String.raw`\begin{align} x&=1 \\ y&=2 \end{align}`+'\n```\n\n```math\n'+String.raw`\begin{equation} x=1 \end{equation}`+'\n```';
    await page.goto('/'); await page.waitForFunction(()=>window.mdv);
    for (const width of [1080,375]) {
      await page.setViewportSize({width,height:900});
      await render(page,'qiita','light',source);
      await page.evaluate(()=>document.fonts.ready);
      await expect(page.locator('.eqn-num')).toHaveCount(0);
      const boxes = await page.locator('.math-container,.math-display').evaluateAll(nodes=>nodes.map(n=>({
        horizontal:n.scrollWidth>n.clientWidth,vertical:n.scrollHeight>n.clientHeight,
      })));
      expect(boxes).toEqual([{horizontal:false,vertical:false},{horizontal:false,vertical:false}]);
    }
  });
  test('github: heading anchors match service hit areas and stay reachable', async ({page}) => {
    await page.goto('/'); await page.waitForFunction(()=>window.mdv);
    await render(page,'github','light','## Setup\n\nText\n\n#### Linking');
    // Measured from the public GitHub article, including its 1px h2 border.
    for(const [tag,top] of [['h2',0.29375],['h4',-4]]) {
      const heading=page.locator('#document '+tag),anchor=heading.locator('.mdv-heading-link');
      await page.mouse.move(0,0);await expect(anchor).toHaveCSS('opacity','0');
      await anchor.hover();await expect(anchor).toHaveCSS('opacity','1');
      await heading.hover();await expect(anchor).toHaveCSS('opacity','1');
      const h=await heading.boundingBox(),a=await anchor.boundingBox(),icon=await anchor.locator('svg').boundingBox();
      expect(a.x-h.x).toBe(-28);expect(a.y-h.y).toBeCloseTo(top,2);
      expect([a.width,a.height,icon.width,icon.height].map(n=>Math.round(n*100)/100)).toEqual([28,28,16,16]);
      expect(icon.x-a.x).toBeCloseTo(4,2);expect(icon.y-a.y).toBeCloseTo(6,2);
      await anchor.hover();await expect(anchor).toHaveCSS('opacity','1');
      await page.mouse.move(0,0);await anchor.focus();await expect(anchor).toHaveCSS('opacity','1');
      await anchor.press('Enter');
      expect(await page.evaluate(id=>window.mdv.scrollToAnchor(id),await heading.getAttribute('id'))).toBe(true);
    }
  });
  test('github: alert titles use Primer medium weight', async ({page}) => {
    await page.goto('/'); await page.waitForFunction(()=>window.mdv);
    await render(page,'github','light','> [!NOTE]\n> A note.\n\n> [!IMPORTANT]\n> Important text.');
    const titles = page.locator('.markdown-alert-title');
    await expect(titles).toHaveCount(2);
    await expect(titles.first()).toHaveCSS('font-weight','500');
    await expect(titles.first()).toHaveCSS('line-height','16px');
    await expect(titles.locator('strong')).toHaveCount(0);
  });
  test('github: frontmatter remains a table before the document', async ({page}) => {
    await page.goto('/'); await page.waitForFunction(()=>window.mdv);
    await render(page,'github','light','---\nname: Bug report\nabout: "<b>literal</b>"\nempty: ""\n---\n\n# Body');
    await expect(page.locator('.frontmatter th')).toHaveText(['name','about','empty']);
    await expect(page.locator('.frontmatter td')).toHaveText(['Bug report','<b>literal</b>','']);
    await expect(page.locator('.frontmatter b')).toHaveCount(0);
    await expect(page.locator('#document h1')).toHaveText('Body');
  });
  test('qiita: note icons, first paragraphs and footnote links match service presentation',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    await render(page,'qiita','light',['info','warn','alert'].map(t=>`:::note ${t}\n**Title**\n- Item\n:::`).join('\n\n')+'\n\nText[^one].\n\n[^one]: Footnote.');
    const notes=page.locator('.note');await expect(notes).toHaveCount(3);
    await expect(page.locator('.footnotes')).toHaveCSS('border-top-width','1px');
    for(let i=0;i<3;i++) {
      const icon=notes.nth(i).locator(':scope > .fa');
      await expect(icon).toHaveCSS('font-size','21.25px');await expect(icon).toHaveCSS('margin-right','8px');
      await expect(icon).toHaveCSS('color',['rgb(53, 122, 0)','rgb(174, 136, 3)','rgb(189, 5, 5)'][i]);
      await expect(notes.nth(i).locator(':scope > div > p').first()).toHaveCSS('margin-top','0px');
      expect((await icon.boundingBox()).width).toBeCloseTo(27.3125,2);
    }
    for(const link of await page.locator('.qiita-footnote-ref,.footnotes a[href*="fnref"]').all()) {
      await expect(link).toHaveCSS('text-decoration-line','none');await link.hover();await expect(link).toHaveCSS('text-decoration-line','none');
    }
  });
  test('qiita: nested lists have no extra block margins',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    await render(page,'qiita','light','- Parent\n  - Child\n  - Child two\n- Next\n  1. Ordered child');
    const nested=page.locator('#document li > ul,#document li > ol');await expect(nested).toHaveCount(2);
    for(const list of await nested.all()) {await expect(list).toHaveCSS('margin-top','0px');await expect(list).toHaveCSS('margin-bottom','0px');}
  });
  test('math output and local fonts survive switching between Qiita and GitHub',async({page})=>{
    await page.goto('/');await page.waitForFunction(()=>window.mdv);
    const source='$x^2$\n\n```math\n\\frac{H/2}{\\tan(\\mathrm{fovy}/2)}\n```';
    for(const mode of ['qiita','github','qiita']) {
      await render(page,mode,'light',source);
      if(mode==='qiita') {
        await expect(page.locator('mjx-container[jax="CHTML"]')).toHaveCount(2);
        await expect(page.locator('mjx-math').first()).toHaveCSS('padding-left','2px');
        await expect(page.locator('mjx-container').first()).toHaveCSS('vertical-align','middle');
        expect(await page.evaluate(()=>document.fonts.check('16px MJXZERO')&&document.fonts.check('16px MJXTEX'))).toBe(true);
      } else if(engine==='original')await expect(page.locator('mjx-container[jax="SVG"]')).toHaveCount(2);
      else await expect(page.locator('.katex')).toHaveCount(2);
      await expect(page.locator('.math-error,[data-mjx-error]')).toHaveCount(0);
    }
  });
  test('qiita: math runs after Markdown and skips headings and bare TeX environments', async ({page}) => {
    await page.goto('/'); await page.waitForFunction(()=>window.mdv);
    const source = String.raw`## Heading(\\)

Plain \begin{align} x &= 1 \end{align}

$x^2$` + '\n\n```math:ignored\n'+String.raw`\displaylines{x=1 \\ y=2}`+'\n```';
    await render(page,'qiita','light',source);
    await expect(page.locator('#document h2')).toHaveText('Heading(\\)');
    await expect(page.locator('#document p').first()).toContainText(String.raw`\begin{align}`);
    await expect(page.locator('mjx-container')).toHaveCount(2);
    await expect(page.locator('[data-mjx-error],.math-error,.code-lang,figcaption')).toHaveCount(0);
  });
  test('qiita: math HTML commands cannot create authored links or styles', async ({page}) => {
    await page.goto('/'); await page.waitForFunction(()=>window.mdv);
    await render(page,'qiita','light','```math\n'+String.raw`\require{html}\href{javascript:alert(1)}{click}`+'\n```');
    await expect(page.locator('.math-container a,.math-display a')).toHaveCount(0);
    expect(await page.locator('.math-container,.math-display').count()).toBe(1);
  });
  test('qiita: all six heading anchors retain native icon geometry and hover decoration', async ({page}) => {
    await page.goto('/'); await page.waitForFunction(()=>window.mdv);
    await render(page,'qiita'); await page.evaluate(()=>document.fonts.ready);
    for(let level=1;level<=6;level++) {
      const heading=page.locator(`#document h${level}:not(.sr-only)`).first();
      const anchor=heading.locator('.mdv-heading-link'), icon=anchor.locator('.fa-link');
      await page.mouse.move(0,0); await expect(anchor).toHaveCSS('opacity','0');
      await heading.hover(); await expect(anchor).toHaveCSS('opacity','1');
      await expect(anchor).toHaveCSS('text-decoration-line','none');
      await expect(icon).toHaveCSS('font-size','18px');
      await expect(icon).toHaveCSS('font-family','FontAwesome');
      const geometry=await heading.evaluate(h=>{
        const a=h.querySelector('.mdv-heading-link'),i=a.querySelector('.fa-link');
        const hr=h.getBoundingClientRect(),ar=a.getBoundingClientRect(),ir=i.getBoundingClientRect();
        return {left:ar.left-hr.left,width:ar.width,iconHeight:ir.height,
          heightDelta:ar.height-(hr.height-parseFloat(getComputedStyle(h).borderBottomWidth)),
          centerDelta:(ir.top+ir.height/2)-(ar.top+ar.height/2),
          glyph:getComputedStyle(i,'::before').content};
      });
      expect(geometry.left).toBe(-33); expect(geometry.width).toBe(33);
      expect(geometry.iconHeight).toBe(18); expect(Math.abs(geometry.heightDelta)).toBeLessThan(.02);
      expect(Math.abs(geometry.centerDelta)).toBeLessThan(.02); expect(geometry.glyph).toBe('"\uf0c1"');
      await icon.hover();
      expect(await icon.evaluate(n=>{const s=getComputedStyle(n,'::after');return {content:s.content,width:s.width,height:s.height,radius:s.borderRadius,background:s.backgroundColor};}))
        .toEqual({content:'""',width:'34px',height:'34px',radius:'50%',background:'rgb(237, 238, 238)'});
      await page.mouse.move(0,0); await anchor.focus(); await expect(anchor).toHaveCSS('opacity','1');
      await anchor.evaluate(n=>n.blur());
    }
  });
  for(const mode of ['github','qiita']) {
    test(`${mode}: measured typography, code, tables, notes and details`, async ({page}) => {
      await page.goto('/');await page.waitForFunction(()=>window.mdv);await render(page,mode);
      if (mode === 'qiita') {
        await page.evaluate(() => document.fonts.ready);
        expect(await page.locator('.mdv-heading-link .fa').first().evaluate(n => ({
          glyph: getComputedStyle(n, '::before').content,
          family: getComputedStyle(n).fontFamily,
          loaded: document.fonts.check('17px FontAwesome'),
        }))).toEqual({glyph:'"\uf0c1"', family:'FontAwesome', loaded:true});
        await expect(page.locator('.footnotes p').first()).toHaveCSS('margin', '0px');
        expect(await page.locator('.highlight').first().evaluate(n => getComputedStyle(n, '::-webkit-scrollbar').height)).toBe('8px');
        expect(await page.evaluate(() => ['qiita-mdv','qiita-icons','qiita-host'].map(id => document.getElementById(id).disabled))).toEqual([false,false,false]);
        const scroll = await page.locator('.highlight').first().evaluate(n => {
          const code = n.querySelector('code'); const old = code.innerHTML;
          code.textContent = 'long line '.repeat(200); n.scrollLeft = 100;
          const result = {overflow:n.scrollWidth > n.clientWidth, left:n.scrollLeft};
          code.innerHTML = old; n.scrollLeft = 0; return result;
        });
        expect(scroll).toEqual({overflow:true,left:100});
      }
      await page.mouse.move(0, 0);
      await expect(page.locator('#document p a[href="https://example.com"]')).toHaveCSS('text-decoration-line','underline');
      const checks = [
        ['h1','h1',['fontSize','fontWeight','lineHeight','padding']],
        ['h2:not(.sr-only)','h2',['fontSize','fontWeight','lineHeight','padding']],
        ['h3','h3',['fontSize','fontWeight','lineHeight']],
        ['h4','h4',['fontSize','fontWeight','lineHeight']],
        ['h5','h5',['fontSize','lineHeight']],['h6','h6',['fontSize','lineHeight']],
        ['p','p',['fontSize','lineHeight','color']],
        ['blockquote','blockquote',['padding','margin','color','borderLeft']],
        ['td','td',['padding','borderBottom','borderLeft']],
        ['details','details',['padding','borderLeft','borderRadius']],
        ['summary','summary',['padding']],
        ['p > code','p > code',['fontSize','padding','backgroundColor']],
      ];
      if(mode==='qiita') checks.push(
        ['.code-frame','.code-frame',['backgroundColor','color','padding','borderRadius']],
        ['pre code','.highlight code',['fontSize','lineHeight','color','backgroundColor']],
        [engine==='original'?'.code-lang':'figcaption','.code-lang',['backgroundColor','color','fontSize','padding','borderRadius']],
        [engine==='original'?'.note.info':'.qiita-note-info','.note.info',['backgroundColor','padding','margin','borderLeft']],
        [engine==='original'?'.note.warn':'.qiita-note-warn','.note.warn',['backgroundColor']],
        [engine==='original'?'.note.alert':'.qiita-note-alert','.note.alert',['backgroundColor']],
        ['.footnotes','.footnotes',['fontSize','margin','padding','color']],
      );
      else checks.push(['pre','pre',['fontSize','lineHeight','backgroundColor']],['pre code','pre code',['fontSize','lineHeight','backgroundColor']]);
      if(mode==='qiita') await expect(page.locator('#document > h1')).toHaveCSS('margin-top','0px');
      if(mode==='qiita') for(const tag of ['h2','h3','h4','h5','h6']) {
        await expect(page.locator('#document '+tag+':not(.sr-only)').first()).toHaveCSS('margin',observations.qiita.headingProbe[tag].margin);
      }
      for(const [selector,reference,props] of checks) {
        const actual=await page.locator('#document '+selector).first().evaluate((n,props)=>{const s=getComputedStyle(n);return Object.fromEntries(props.map(p=>[p,s[p]]));},props);
        expect(actual,`${mode}/${engine}: ${selector}`).toEqual(Object.fromEntries(props.map(p=>[p,observations[mode].light[reference].css[p]])));
      }
    });
    test(`${mode}: heading hover/focus, footnote round trip, copy and details`, async({page})=>{
      await page.addInitScript(()=>{window.copied=[];window.chrome={webview:{postMessage:m=>window.copied.push(m),addEventListener:()=>{}}};});
      await page.goto('/');await page.waitForFunction(()=>window.mdv);await render(page,mode);
      const heading=page.locator('#document h2:not(.sr-only)').first(), anchor=heading.locator('.mdv-heading-link');
      await page.mouse.move(0,0);await expect(anchor).toHaveCSS('opacity','0');
      const before=await heading.boundingBox();await heading.hover();await expect(anchor).toHaveCSS('opacity','1');expect(await heading.boundingBox()).toEqual(before);
      await page.mouse.move(0,0);await anchor.focus();await expect(anchor).toHaveCSS('opacity','1');await anchor.press('Enter');
      expect(await page.evaluate(()=>window.mdv.scrollToAnchor('heading-two'))).toBe(true);
      const refs=page.locator('#document sup a');await expect(refs).toHaveCount(3);
      const brackets=await refs.first().evaluate(n=>[getComputedStyle(n,'::before').content,getComputedStyle(n,'::after').content]);
      expect(brackets).toEqual(['"["','"]"']);
      for(let i=0;i<3;i++) {
        const id=await refs.nth(i).getAttribute('href');expect(await page.evaluate(id=>window.mdv.scrollToAnchor(decodeURIComponent(id.slice(1))),id)).toBe(true);
      }
      await refs.first().click();await page.locator('#document .footnotes a').first().click();
      const frame=page.locator('#document pre').first();await frame.hover();const copy=frame.locator('.copy-code');await expect(copy).toHaveCSS('opacity','1');await copy.click();
      expect(await page.evaluate(()=>window.copied.findLast(m=>m.type==='copy').text)).toBe("puts 'Hello'\n");
      await expect(page.locator('#document details')).not.toHaveAttribute('open');await page.locator('#document summary').click();await expect(page.locator('#document details')).toHaveAttribute('open','');
      await page.screenshot({path:`artifacts/qiita-style/${mode}-${engine}.png`,fullPage:true});
    });
    test(`${mode}: dark/print and switching service leaves no presentation residue`, async({page})=>{
      await page.goto('/');await page.waitForFunction(()=>window.mdv);await render(page,mode,'dark');
      const background=await page.locator('#document pre').first().evaluate(n=>getComputedStyle(n.closest('.code-frame')||n).backgroundColor);
      expect(background).toBe(mode==='qiita'?'rgb(29, 32, 32)':'rgb(21, 27, 35)');
      await page.emulateMedia({media:'print'});
      await expect(page.locator('.mdv-heading-link').first()).toHaveCSS('display','none');await expect(page.locator('.copy-code').first()).toBeHidden();
      await page.emulateMedia({media:'screen'});await render(page,mode==='qiita'?'github':'qiita');
      const other=mode==='qiita'?'github':'qiita';await expect(page.locator('#document')).toHaveClass(new RegExp(other));
      const brackets=await page.locator('sup a').first().evaluate(n=>getComputedStyle(n,'::before').content);expect(brackets).toBe('"["');
    });
  }
});
