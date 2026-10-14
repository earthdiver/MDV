// Mermaid's dimensions are SVG user units. Measure without an inherited CSS
// zoom, then let the finished SVG scale with the document. Keep the same base
// typography as the service's separate diagram frame.
export function createDiagramMeasurement(article) {
  const measurement = document.createElement('div');
  const style = getComputedStyle(article);
  const width = article.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  measurement.className = 'mdv-diagram-measurement';
  measurement.style.cssText = `position:absolute;left:0;top:0;font:16px Arial,sans-serif;width:${width}px`;
  const zoom = document.body.currentCSSZoom || 1;
  measurement.style.zoom = String(1 / zoom);
  document.body.append(measurement);
  return measurement;
}
