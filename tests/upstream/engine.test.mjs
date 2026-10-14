import test from 'node:test';
import assert from 'node:assert/strict';
import { OriginalEngine } from '../../scripts/upstream/client.mjs';

test('original implementations retain their distinct behavior and request isolation', async () => {
  for (const mode of ['github', 'qiita']) {
    const engine = await OriginalEngine.start(mode);
    try {
      assert.equal(engine.metadata.mode, mode);
      assert.equal(engine.metadata.service_status, 'unverified');
      const [a, b] = await Promise.all([engine.render('# 日本語\n\na\nb\n'), engine.render('# 日本語\n\na\nb\n')]);
      assert.equal(a.html, b.html, 'heading IDs and context must not leak between documents');
      if (mode === 'github') {
        assert.match(a.html, /<p>a\nb<\/p>/);
        assert.equal(engine.metadata.gems.commonmarker, '2.8.2');
        assert.equal(engine.metadata.sources['github-markup'].revision, '84e47f9a64c993f8f3f91be639231f02aa4df730');
      } else {
        assert.match(a.html, /<p>a<br>\nb<\/p>/);
        assert.match(a.html, /id="日本語"/);
        assert.equal(engine.metadata.sources['qiita-markdown'].revision, 'e41466a43608c001f2b8be1a5cbe752d76698a7c');
        assert.equal(engine.metadata.sources.qiita_marker.revision, 'cb88c6062b43973c4508f568d1bce86de4a6acdb');
        const note = await engine.render(':::note warn\n注意\n:::\n\n```ruby:hello.rb\nputs 1\n```\n');
        assert.match(note.html, /class="note warn"/);
        assert.deepEqual(note.extracted.codes, [{ code: 'puts 1\n', filename: 'hello.rb', language: 'ruby' }]);
      }
      const diagrams = await engine.render('```mermaid\nflowchart LR\n A --> B\n```\n');
      assert.match(diagrams.html, /(?:data-lang|lang)="mermaid"/);
      assert.match(diagrams.html, /A --&gt; B/);
      await assert.rejects(engine.render(null), /Markdown must/);
      await assert.rejects(engine.render('a'.repeat(4 * 1024 * 1024 + 1)), /Markdown must/);
      assert.match((await engine.render('still alive')).html, /still alive/);
    } finally { engine.close(); }
    await assert.rejects(engine.render('closed'), /closed/);
  }
});

test('unavailable engines and process crashes fail without switching parsers', async () => {
  await assert.rejects(OriginalEngine.start('other'), /Unknown engine/);
  await assert.rejects(OriginalEngine.start('github', { ruby: '/does-not-exist/mdv-ruby' }), /ENOENT/);
  const engine = await OriginalEngine.start('qiita');
  try {
    engine.process.kill();
    await assert.rejects(engine.render('do not fall back'), /exited|EPIPE|closed/);
  } finally { engine.close(); }
});

test('a stalled response times out and makes the worker unusable', async () => {
  const engine = await OriginalEngine.start('github');
  try {
    // Simulate a transport that stops delivering replies after successful startup.
    engine.process.stdout.pause();
    engine.timeoutMs = 30;
    await assert.rejects(engine.render('response cannot arrive'), /timed out/);
    await assert.rejects(engine.render('no fallback'), /closed/);
  } finally { engine.process.stdout.resume(); engine.close(); }
});

test('desktop Qiita accepts mixed-case language names without changing code or filename', async () => {
  const engine = await OriginalEngine.start('qiita', {desktop:true});
  try {
    for (const language of ['PowerShell','POWERSHELL','powershell']) {
      const result = await engine.render('```'+language+':MixedCase.ps1\nfunction Get-Example { $s.ToString() }\n```');
      assert.match(result.html, /class="nf">ToString/);
      assert.match(result.html, /MixedCase\.ps1/);
      assert.equal(result.extracted.codes[0].code, 'function Get-Example { $s.ToString() }\n');
    }
    const alias = await engine.render('```ZSH\necho "hello"\n```');
    assert.match(alias.html, /data-lang="bash"/);
    const unknown = await engine.render('```NotAKnownLanguage\n<raw>\n```');
    assert.match(unknown.html, /&lt;raw&gt;/);
  } finally {engine.close();}
});

test('desktop GitHub renders safe YAML frontmatter without changing public defaults', async () => {
  const desktop = await OriginalEngine.start('github',{desktop:true});
  const reference = await OriginalEngine.start('github');
  try {
    const source = '---\nname: "<img src=x>"\nempty: ""\nlabels: [bug, docs]\n---\n\n# Body';
    const result = await desktop.render(source);
    assert.match(result.html,/<table class="frontmatter">/);
    assert.match(result.html,/<td>&lt;img src=x&gt;<\/td>/);
    assert.match(result.html,/<td>\[&quot;bug&quot;,&quot;docs&quot;\]<\/td>/);
    assert.match(result.html,/<h1>Body<\/h1>/);
    assert.doesNotMatch((await reference.render(source)).html,/class="frontmatter"/);
    const unsafe = await desktop.render('---\nx: !ruby/object:Object {}\n---\n\nBody');
    assert.match(unsafe.html,/<pre>/);
    assert.match(unsafe.html,/<p>Body<\/p>/);
    assert.doesNotMatch((await desktop.render('# Ordinary')).html,/frontmatter/);
  } finally {desktop.close();reference.close();}
});

test('desktop GitHub leaves thematic-break-delimited Markdown as ordinary content', async()=>{
  const engine=await OriginalEngine.start('github',{desktop:true});
  try{const {html}=await engine.render('---\n**Advertisement :)**\n\n- Project\n\nDescription.\n\n---\n\n# Body');
    assert.equal((html.match(/<hr\s*\/?>/g)||[]).length,2);assert.match(html,/<strong>Advertisement :\)<\/strong>/);assert.doesNotMatch(html,/<pre>|frontmatter/);
  }finally{engine.close();}
});
