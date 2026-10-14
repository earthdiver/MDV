import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';

export const corpusRoot = fileURLToPath(new URL('../../tests/compatibility/', import.meta.url));
export const hash = value => createHash('sha256').update(value).digest('hex');
export const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
export function inside(root, path) {
  const result = resolve(root, path);
  if (!result.startsWith(resolve(root) + sep)) throw new Error(`Path outside corpus: ${path}`);
  return result;
}

export async function verifySources() {
  const lock = await readJson(resolve(corpusRoot, 'sources.lock.json'));
  for (const source of lock.files) {
    if (!/^[a-f0-9]{40}$/.test(source.commit)) throw new Error(`Unpinned source: ${source.path}`);
    if (hash(await readFile(inside(corpusRoot, source.path))) !== source.sha256)
      throw new Error(`Reference source checksum mismatch: ${source.path}`);
  }
  return lock;
}

// GFM's published executable examples. No MDV output is involved in extraction.
export function parseGfm(source, provenance) {
  const lines = source.split('\n');
  const cases = [];
  let section = '';
  for (let i = 0; i < lines.length; i++) {
    if (/^#{1,6} /.test(lines[i])) section = lines[i].replace(/^#+ /, '');
    const fence = lines[i].match(/^(`{32}) example(?: .*)?$/)?.[1];
    if (!fence) continue;
    const start = i + 1;
    const markdown = [], html = [];
    while (++i < lines.length && lines[i] !== '.') markdown.push(lines[i]);
    if (i === lines.length) throw new Error(`Unclosed GFM example at ${start}`);
    while (++i < lines.length && lines[i] !== fence) html.push(lines[i]);
    if (i === lines.length) throw new Error(`Unclosed GFM HTML at ${start}`);
    const decode = items => items.length ? items.join('\n').replace(/→/g, '\t') + '\n' : '';
    cases.push({ id: `gfm-${String(cases.length + 1).padStart(3, '0')}`, mode: 'github',
      suite: 'gfm-spec', category: section, referenceKind: 'specification',
      source: { ...provenance, line: start }, markdown: decode(markdown), expectedHtml: decode(html) });
  }
  if (!cases.length) throw new Error('No GFM examples found');
  return cases;
}

function stripHeredoc(text) {
  const indents = text.split('\n').filter(line => line.trim()).map(line => line.match(/^ */)[0].length);
  const indent = Math.min(...indents);
  return text.split('\n').map(line => line.slice(Math.min(indent, line.match(/^ */)[0].length))).join('\n');
}
function literal(expression) {
  if (!expression || expression.includes('#{')) return null;
  const heredoc = expression.match(/^<<-([A-Z]+)\.strip_heredoc\n([\s\S]*?)^ *\1\s*$/m);
  if (heredoc) return heredoc[2].includes('\\') ? null : stripHeredoc(heredoc[2]);
  if (/^"(?:[^"\\]|\\["\\nrt])*"$/.test(expression)) return JSON.parse(expression);
  if (/^'(?:[^'\\]|\\['\\])*'$/.test(expression)) return expression.slice(1, -1).replace(/\\(['\\])/g, '$1');
  return null;
}

// Deliberately bounded extractor, NOT a Ruby interpreter. Dynamic/partial/inherited
// assertions are recorded as uncovered, never guessed or counted as a match.
export function parseQiita(source, provenance) {
  const basic = source.slice(source.indexOf('    shared_examples_for "basic markdown syntax"'),
    source.indexOf('    shared_examples_for "script element"'));
  const cases = [], uncovered = [];
  for (const match of basic.matchAll(/^      context "([^"]+)" do\n([\s\S]*?)^      end$/gm)) {
    const [block, title, body] = match;
    const line = source.slice(0, source.indexOf(block)).split('\n').length;
    const reject = reason => uncovered.push({ title, line, reason });
    if (/before do|let\(:context\)|^        context /m.test(body)) { reject('context-dependent assertion'); continue; }
    const input = body.match(/let\(:markdown\) do\n([\s\S]*?)^        end/m)?.[1].trim();
    const output = body.match(/(?:should eq |is_expected\.to eq |expect\(subject\)\.to eq )(<<-HTML\.strip_heredoc\n[\s\S]*?^ *HTML|"(?:[^"\\]|\\.)*")/m)?.[1];
    const markdown = literal(input), expectedHtml = literal(output);
    if (markdown === null || expectedHtml === null) { reject('not a complete static input/HTML equality'); continue; }
    cases.push({ id: `qiita-line-${line}`, mode: 'qiita', suite: 'qiita-processor', category: title,
      referenceKind: 'upstream-assertion', source: { ...provenance, line },
      context: { hostname: 'example.com', script: false, strict: false }, markdown, expectedHtml });
  }
  return { cases, uncovered };
}

export function parseQiitaNotes(source, provenance) {
  const notes = source.slice(source.indexOf('        context "when type is note"'));
  return ['empty', 'warn', 'alert'].map(subtype => {
    const block = notes.match(new RegExp(`          context "when subtype is ${subtype}" do\\n([\\s\\S]*?)^          end$`, 'm'));
    const output = block?.[1].match(/else[\s\S]*?should eq (<<-HTML\.strip_heredoc\n[\s\S]*?^ *HTML)/m)?.[1];
    const expectedHtml = literal(output);
    if (expectedHtml === null) throw new Error(`Cannot extract upstream note ${subtype}`);
    return { id: `qiita-note-${subtype}`, mode: 'qiita', suite: 'qiita-processor', category: 'custom block',
      referenceKind: 'upstream-assertion', source: { ...provenance, line: source.slice(0, source.indexOf(block[0])).split('\n').length },
      derivation: `Upstream shared example: type=note, subtype=${subtype === 'empty' ? '' : subtype}, allowed=false`,
      context: { hostname: 'example.com', script: false, strict: false },
      markdown: `:::note${subtype === 'empty' ? '' : ` ${subtype}`}\nSome kind of text is here.\n:::\n`, expectedHtml };
  });
}

export async function loadHtmlCorpus() {
  const lock = await verifySources();
  const get = async path => {
    const source = lock.files.find(file => file.path === path);
    if (!source) throw new Error(`Unregistered source: ${path}`);
    return { text: await readFile(inside(corpusRoot, path), 'utf8'), source };
  };
  const spec = await get('upstream/gfm/test/spec.txt');
  const qiita = await get('upstream/qiita/spec/qiita/markdown/processor_spec.rb');
  const parsed = parseQiita(qiita.text, qiita.source);
  const input = await get('upstream/github/test/markups/README.markdown');
  const output = await get('upstream/github/test/markups/README.markdown.html');
  return { lock, uncovered: parsed.uncovered, cases: [
    ...parseGfm(spec.text, spec.source), ...parsed.cases, ...parseQiitaNotes(qiita.text, qiita.source),
    { id: 'github-markup-list', mode: 'github', suite: 'github-markup', category: 'upstream fixture',
      referenceKind: 'upstream-assertion', source: output.source, markdown: input.text, expectedHtml: output.text },
  ] };
}
