import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLanguage } from '../language.mjs';
import { renderMarkdown } from '../markdown.mjs';

test('language selection handles Japanese, other system languages, and explicit overrides', () => {
  for (const system of ['ja', 'ja-JP', 'en-US', 'de-DE', 'zh-CN', '']) {
    assert.equal(resolveLanguage('auto', system), system.startsWith('ja') ? 'ja' : 'en');
    assert.equal(resolveLanguage('en', system), 'en');
    assert.equal(resolveLanguage('ja', system), 'ja');
  }
});

test('language changes translate footnotes and diagnostics while preserving authored content', () => {
  const source = '# 日本語の本文\n\ntext[^a]\n\n[^a]: 注釈\n\n```plantuml\nexample\n```';
  for (const language of ['en', 'ja', 'en']) {
    const result = renderMarkdown(source, { language });
    assert.match(result.html, /日本語の本文/);
    assert.match(result.html, language === 'en' ? /Footnotes/ : /脚注/);
    assert.match(result.html, language === 'en' ? /Back to content/ : /本文に戻る/);
    assert.match(result.diagnostics[0], language === 'en' ? /unsupported/ : /未対応/);
  }
});
