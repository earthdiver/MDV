export function resolveLanguage(preference, systemLanguage = globalThis.navigator?.language ?? 'en') {
  return preference === 'ja' || preference === 'en' ? preference : /^ja(?:-|$)/i.test(systemLanguage) ? 'ja' : 'en';
}
let language = resolveLanguage('auto');
export function setLanguage(preference) { language = resolveLanguage(preference); return language; }
export function text(japanese, english) { return language === 'ja' ? japanese : english; }
