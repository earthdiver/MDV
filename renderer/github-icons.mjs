import link from '@primer/octicons/build/svg/link-16.svg';
import copy from '@primer/octicons/build/svg/copy-16.svg';
import check from '@primer/octicons/build/svg/check-16.svg';
import info from '@primer/octicons/build/svg/info-16.svg';
import tip from '@primer/octicons/build/svg/light-bulb-16.svg';
import important from '@primer/octicons/build/svg/report-16.svg';
import warning from '@primer/octicons/build/svg/alert-16.svg';
import caution from '@primer/octicons/build/svg/stop-16.svg';
const icons = {link,copy,check,info,tip,important,warning,caution};
export function githubIcon(name) {
  const template = document.createElement('template');
  template.innerHTML = icons[name];
  const svg = template.content.firstElementChild;
  svg.setAttribute('class', `octicon octicon-${name}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  return svg;
}
