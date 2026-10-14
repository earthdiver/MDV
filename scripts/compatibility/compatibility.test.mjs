import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { canonicalHtml, compareHtml, reportHtml, summarize } from './compare.mjs';
import { corpusRoot, inside, loadHtmlCorpus, parseGfm, parseQiita, readJson } from './corpus.mjs';

test('serialization normalization does not hide semantic or visual differences', () => {
  assert.equal(canonicalHtml('<p title="a" class="x">&amp;</p>\n'), canonicalHtml('<p class="x" title="a">&#38;</p>'));
  for (const [expected, actual] of [
    ['<pre><code>a  b\n</code></pre>', '<pre><code>a b\n</code></pre>'],
    ['<p>a <em>b</em></p>', '<p>a<em>b</em></p>'],
    ['<span>a</span> <span>b</span>', '<span>a</span><span>b</span>'],
    ['<a href="#x">go</a>', '<a href="#y">go</a>'],
    ['<span id="x"></span>', '<span id="y"></span>'],
    ['<code class="language-ruby">1</code>', '<code class="language-js">1</code>'],
    ['<script>bad()</script>', ''],
    ['<svg><path d="M0 0 L1 1"/></svg>', '<svg><path d="M0 0 L2 1"/></svg>'],
    ['<template><p>one</p></template>', '<template><p>two</p></template>'],
  ]) assert.equal(compareHtml(expected, actual).status, 'different', expected);
});

test('no expectation is unverified, and errors are counted separately', () => {
  assert.equal(compareHtml(null, '<p>a</p>').status, 'unverified');
  assert.deepEqual(summarize([{ status: 'match' }, { status: 'different' }, { status: 'unverified' }, { status: 'error' }]),
    { total: 4, match: 1, different: 1, unverified: 1, error: 1 });
  assert.throws(() => summarize([{ status: 'skipped' }]));
});

test('GFM import preserves tabs and blank lines and rejects malformed examples', () => {
  const fence = '`'.repeat(32);
  const cases = parseGfm(`# Test\n${fence} example\n→a\n\n.\n<pre><code>a\n\n</code></pre>\n${fence}\n`, {});
  assert.equal(cases[0].markdown, '\ta\n\n');
  assert.equal(cases[0].expectedHtml, '<pre><code>a\n\n</code></pre>\n');
  assert.throws(() => parseGfm(`${fence} example\na`, {}));
});

test('Qiita importer never treats partial or interpolated assertions as complete goldens', () => {
  const source = '    shared_examples_for "basic markdown syntax" do\n'
    + '      context "partial" do\n        let(:markdown) do\n          "a"\n        end\n        should include("a")\n      end\n'
    + '      context "dynamic" do\n        let(:markdown) do\n          "#{danger}"\n        end\n        should eq "<p>a</p>"\n      end\n'
    + '    shared_examples_for "script element"';
  const parsed = parseQiita(source, {});
  assert.equal(parsed.cases.length, 0); assert.equal(parsed.uncovered.length, 2);
});

test('pinned corpus contains every GFM example and real upstream equality expectations', async () => {
  const { cases, uncovered } = await loadHtmlCorpus();
  assert.equal(cases.filter(item => item.suite === 'gfm-spec').length, 672);
  assert.equal(cases.filter(item => item.suite === 'qiita-processor').length, 30);
  assert.equal(cases.length, new Set(cases.map(item => item.id)).size);
  assert.equal(uncovered.length, 36);
  const filename = cases.find(item => item.id === 'qiita-line-135');
  assert.equal(filename.markdown, '```example.rb\n1\n```\n');
  assert.match(filename.expectedHtml, /class="mi">1/);
  const note = cases.find(item => item.id === 'qiita-note-warn');
  assert.match(note.expectedHtml, /class="note warn"/);
  assert.doesNotMatch(note.expectedHtml, /data-metadata/);
  for (const item of cases) {
    assert.equal(typeof item.expectedHtml, 'string');
    assert.match(item.source.commit, /^[a-f0-9]{40}$/);
    assert.ok(item.source.url.includes(item.source.commit));
  }
});

test('browser coverage includes diagrams, math, themes, print, and explicit service gaps', async () => {
  const { cases, variants } = await readJson(resolve(corpusRoot, 'browser-cases.json'));
  assert.equal(cases.length, new Set(cases.map(item => item.id)).size);
  assert.ok(cases.filter(item => item.kind === 'mermaid').length >= 15);
  assert.ok(cases.some(item => item.kind === 'math'));
  for (const id of ['html-css', 'anchors', 'geojson', 'topojson', 'stl', 'plantuml', 'embed', 'references']) {
    assert.ok(cases.find(item => item.id === id)?.reason);
  }
  assert.ok(variants.some(item => item.media === 'print'));
  assert.ok(variants.some(item => item.theme === 'dark'));
  for (const item of cases) assert.match(item.id, /^[a-z0-9-]+$/);
  const profile = await readJson(resolve(corpusRoot, 'profiles.json'));
  assert.equal(profile.github.serviceMermaidVersion, null);
  assert.equal(profile.qiita.serviceMermaidVersion, null);
  assert.equal(profile.browserReference.kind, 'upstream-library');
});

test('comparison report escapes hostile fixture HTML rather than executing it', () => {
  const report = reportHtml({ description: '<script>bad()</script>', metadata: {}, summary: summarize([{ status: 'different' }]),
    results: [{ id: '<img src=x onerror=bad()>', status: 'different', expectedHtml: '<script>bad()</script>', actualHtml: '' }] });
  assert.doesNotMatch(report, /<script>|<img src=x/);
  assert.match(report, /&lt;script&gt;/);
});

test('corpus paths cannot escape their root', () => {
  assert.throws(() => inside(corpusRoot, '../secrets'));
  assert.throws(() => inside(corpusRoot, '/etc/passwd'));
});
