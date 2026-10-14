import purify from 'dompurify';

// Filter authored label HTML before Mermaid inserts its measurement DOM.
export const diagramLabelSanitizer = {
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'img', 'image', 'video', 'audio', 'link'],
  FORBID_ATTR: ['src', 'srcset', 'href', 'xlink:href', 'style'],
};

export function cleanSvg(svg) {
  return purify.sanitize(svg, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true }, ADD_TAGS: ['foreignObject'],
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    FORBID_TAGS: ['a', 'script', 'iframe', 'object', 'embed', 'image', 'img', 'video', 'audio'], FORBID_ATTR: ['href', 'xlink:href'],
  });
}
