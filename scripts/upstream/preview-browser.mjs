import { selectStyles } from '../../renderer/service-styles.mjs';
import { renderOriginalDocument, followFragment } from '../../renderer/upstream-display.mjs';

const article = document.querySelector('#preview');
const status = document.querySelector('#status');
const button = document.querySelector('#render');
let current;
async function display(result, options = {}) {
  current = result;
  document.documentElement.dataset.colorMode = document.querySelector('#theme').value;
  document.documentElement.dataset.lightTheme = 'light';
  document.documentElement.dataset.darkTheme = 'dark';
  const qiita = result.metadata.mode === 'qiita';
  await Promise.all([
    ...['github-primer','github-host'].map(id => selectStyles(id, !qiita)),
    ...['qiita-mdv','qiita-icons','qiita-host'].map(id => selectStyles(id, qiita)),
  ]);
  const summary = await renderOriginalDocument(article, result, { theme: document.querySelector('#theme').value, articleClass: qiita ? 'it-MdContent' : 'markdown-body', ...options });
  document.querySelector('#raw').textContent = result.html;
  document.querySelector('#metadata').textContent = JSON.stringify({ metadata: result.metadata, extracted: result.extracted, ...summary }, null, 2);
  const outline = document.querySelector('#outline'); outline.replaceChildren();
  for (const heading of summary.outline) {
    const link = document.createElement('a'); link.href = `#${heading.id}`; link.textContent = heading.text;
    link.style.paddingLeft = `${(heading.level - 1) * 8}px`; outline.append(link);
  }
  window.upstreamResult = summary;
  status.textContent = `${result.metadata.mode} — 図 ${summary.diagrams}、数式 ${summary.math}、表示エラー ${summary.diagnostics.length}`;
  return summary;
}
for (const root of [article, document.querySelector('#outline')]) root.addEventListener('click', event => {
  const link = event.target.closest('a');
  if (link) { event.preventDefault(); followFragment(article, link.getAttribute('href')); }
});
button.addEventListener('click', async () => {
  button.disabled = true; status.textContent = '変換中…';
  try {
    const response = await fetch('/render', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MDV-Upstream': document.querySelector('meta[name=upstream-token]').content },
      body: JSON.stringify({ mode: document.querySelector('#mode').value, markdown: document.querySelector('#source').value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    await display(result);
  } catch (error) { status.textContent = String(error); }
  finally { button.disabled = false; }
});
document.querySelector('#theme').addEventListener('change', async () => { if (current) await display(current); });
window.upstreamPreview = { display };
