// Preserve image dimensions without permitting resource URLs or page-level CSS.
export function imageDimensionStyle(style) {
  return String(style || '').split(';').flatMap(declaration => {
    const match = declaration.match(/^\s*(width|height)\s*:\s*(auto|(?:\d+(?:\.\d+)?|\.\d+)(?:px|em|rem|%|pt)?)(\s*!important)?\s*$/i);
    if (!match) return [];
    return [`${match[1].toLowerCase()}:${match[2].toLowerCase()}${match[3] ? ' !important' : ''}`];
  }).join(';');
}
