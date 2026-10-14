// Observed on the public services on 2026-10-14. The Markdown converters
// do not supply the browser-side diagram engine; select it by service mode.
const runtimes = new Map();
export const mermaidVersion = mode => mode === 'qiita' ? '11.12.1' : '12.1.0';
export async function mermaidRuntime(mode) {
  const key = mode === 'qiita' ? 'qiita' : 'github';
  if (!runtimes.has(key)) runtimes.set(key, key === 'qiita' ? import('mermaid-qiita') : import('mermaid'));
  return (await runtimes.get(key)).default;
}
