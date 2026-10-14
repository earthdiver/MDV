import { text as uiText } from './language.mjs';
export async function selectStyles(id, enabled) {
  const link = document.getElementById(id);
  if (!enabled) { link.disabled = true; return; }
  await new Promise((resolve, reject) => {
    const done = () => { link.removeEventListener('load', loaded); link.removeEventListener('error', failed); };
    const loaded = () => { done(); resolve(); };
    const failed = () => { done(); reject(new Error(`${uiText("書式を読み込めませんでした", "Unable to load styles")}: ${id}`)); };
    link.addEventListener('load', loaded); link.addEventListener('error', failed);
    link.disabled = false;
    if (link.sheet) loaded();
  });
}
