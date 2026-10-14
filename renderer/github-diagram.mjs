// Match the service iframe's SVG viewport: keep the unscaled SVG height and
// clip its empty lower viewport to the width-scaled diagram. Using height:auto
// rounds the SVG scale differently and changes small text glyphs.
export function prepareGithubDiagramViewport(view) {
  const svg=view.querySelector('svg');
  const box=svg?.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if(!box||box.length!==4||!box.every(Number.isFinite)||box[2]<=0||box[3]<=0)return;
  const [, ,width,height]=box;
  svg.setAttribute('height',String(height));
  svg.setAttribute('preserveAspectRatio','xMinYMin');
  svg.style.height=height+'px';
  view.style.cssText=`width:100%;max-width:${width}px;aspect-ratio:${width}/${height};overflow:hidden;margin:0 auto`;
}
