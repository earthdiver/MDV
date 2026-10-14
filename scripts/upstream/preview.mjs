import { buildGithubAssets } from '../../scripts/build-github-assets.mjs';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, mkdir, writeFile, copyFile, cp } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { OriginalEngine, repositoryRoot } from './client.mjs';
import { escapeHtml } from '../../scripts/compatibility/compare.mjs';
import { inside } from '../../scripts/compatibility/corpus.mjs';

export async function startPreview({ reference = false, app = false } = {}) {
  const engines = {};
  let server;
  try {
    for (const mode of ['github', 'qiita']) engines[mode] = await OriginalEngine.start(mode, {desktop:app});
    const root = resolve(repositoryRoot, 'artifacts/original-engines/preview');
    await mkdir(root, { recursive: true });
    await build({ entryPoints: [resolve(repositoryRoot, 'scripts/upstream/preview-browser.mjs')], bundle: true, format: 'esm', splitting: true,
      loader: {'.svg':'text','.wasm':'binary','.scm':'text'}, outdir: root, entryNames: 'preview', chunkNames: 'chunks/[name]-[hash]', target: 'es2022', logLevel: 'silent' });
    await buildGithubAssets(root);
    await copyFile(resolve(repositoryRoot, 'renderer/github-host.css'), resolve(root, 'github-host.css'));
    await copyFile(resolve(repositoryRoot, 'renderer/qiita.css'), resolve(root, 'qiita.css'));
    await cp(resolve(repositoryRoot, 'third_party/font-awesome'), resolve(root, 'qiita/font-awesome'), { recursive: true });
    await copyFile(resolve(repositoryRoot, 'renderer/qiita-host.css'), resolve(root, 'qiita-host.css'));
    if (reference) {
      await build({ entryPoints: [resolve(repositoryRoot, 'scripts/compatibility/reference.mjs')], bundle: true, format: 'esm', splitting: true,
        outdir: root, entryNames: 'reference', chunkNames: 'reference-chunks/[name]-[hash]', target: 'es2022', logLevel: 'silent' });
      await writeFile(resolve(root, 'reference-config.js'), "window.MathJax={startup:{typeset:false},svg:{fontCache:'none'}};");
      await writeFile(resolve(root, 'reference.html'), `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;font:16px Arial,sans-serif}#reference{width:960px}svg{max-width:100%}</style>
<script src="/reference-config.js"></script><script defer src="/mathjax/tex-svg-full.js"></script><script type="module" src="/reference.js"></script>
</head><body><div id="reference"></div></body></html>`);
    }
    const token = randomBytes(24).toString('hex');
    const sample = await readFile(resolve(repositoryRoot, 'samples/welcome.md'), 'utf8');
    const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta name="upstream-token" content="${token}"><title>公開実装の検証 — MDV</title>
<style>body{font:16px system-ui;margin:2rem}header{margin-bottom:1rem}textarea{width:100%;height:18rem;box-sizing:border-box}main{display:grid;grid-template-columns:1fr 1fr;gap:2rem}section pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:1rem}#outline a{display:block}@media(max-width:800px){main{display:block}}</style>
<link id="github-primer" rel="stylesheet" href="/github/primer.css"><link id="github-host" rel="stylesheet" href="/github-host.css">
<link id="qiita-mdv" rel="stylesheet" href="/qiita.css" disabled><link id="qiita-icons" rel="stylesheet" href="/qiita/font-awesome/css/font-awesome.min.css" disabled><link id="qiita-host" rel="stylesheet" href="/qiita-host.css" disabled>
<script type="module" src="/preview.js"></script></head><body>
<header><h1>公開実装の検証</h1><p>公開実装のHTMLと、図・数式を加えた表示を確認できます。実サイトの見た目と部分的に照合していますが、完全一致は未確認です。</p>
<label>記法 <select id="mode"><option value="github">GitHub</option><option value="qiita">Qiita</option></select></label>
<label>表示 <select id="theme"><option value="light">ライト</option><option value="dark">ダーク</option></select></label>
<button id="render">変換</button> <span id="status" role="status">Markdownを入力して変換してください。</span></header>
<main><section><label for="source">Markdown</label><textarea id="source">${escapeHtml(sample)}</textarea>
<nav id="outline" aria-label="目次"></nav><details><summary>公開実装のHTML</summary><pre id="raw"></pre></details><details><summary>実行情報</summary><pre id="metadata"></pre></details></section>
<article id="preview"></article></main></body></html>`;
    const csp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.woff': 'font/woff', '.woff2': 'font/woff2' };
    server = createServer(async (request, response) => {
      response.setHeader('Content-Security-Policy', csp);
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Cache-Control', 'no-store');
      try {
        const origin = `http://127.0.0.1:${server.address().port}`;
        if (request.headers.host !== new URL(origin).host) { response.writeHead(403); response.end(); return; }
        const pathname = new URL(request.url, origin).pathname;
        if (request.method === 'POST' && pathname === '/render') {
          if (request.headers['x-mdv-upstream'] !== token || (request.headers.origin && request.headers.origin !== origin)) {
            response.writeHead(403); response.end(); return;
          }
          const chunks = []; let bytes = 0;
          for await (const chunk of request) {
            bytes += chunk.length;
            if (bytes > 24 * 1024 * 1024) throw new Error('Request exceeds 24 MiB');
            chunks.push(chunk);
          }
          const { mode, markdown } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!Object.hasOwn(engines, mode)) throw new Error('Unknown engine');
          const result = await engines[mode].render(markdown);
          response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ ...result, metadata: engines[mode].metadata })); return;
        }
        if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
        if (pathname === '/') {
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html); return;
        }
        const appPath = app && pathname.startsWith('/app/');
        const assetRoot = appPath ? resolve(repositoryRoot, 'src/Mdv.App/Renderer') : pathname.startsWith('/mathjax/') ? resolve(repositoryRoot, 'node_modules/mathjax/es5') : root;
        const relative = decodeURIComponent(appPath ? (pathname.slice(5) || 'index.html') : pathname.startsWith('/mathjax/') ? pathname.slice(9) : pathname.slice(1));
        const asset = inside(assetRoot, relative);
        const contents = await readFile(asset);
        response.writeHead(200, { 'Content-Type': mime[extname(asset)] || 'application/octet-stream' }); response.end(contents);
      } catch (error) {
        response.writeHead(request.method === 'POST' ? 400 : 404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: error.message }));
      }
    });
    await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await writeFile(resolve(root, 'runtime.json'), JSON.stringify({ origin, engines: Object.fromEntries(Object.entries(engines).map(([name, engine]) => [name, engine.metadata])) }, null, 2) + '\n');
    return { origin, engines, close: async () => {
      for (const engine of Object.values(engines)) engine.close();
      server.closeAllConnections();
      await new Promise(accept => server.close(accept));
    } };
  } catch (error) {
    for (const engine of Object.values(engines)) engine.close();
    server?.close(); throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const preview = await startPreview();
  console.log(`Original engine upstream: ${preview.origin}\nStop with Ctrl+C.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { preview.close().catch(console.error); });
}
