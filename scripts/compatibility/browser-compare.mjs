// These functions execute in a browser, on already-rendered DOM/PNG data.
export function diagramSnapshot(element) {
  const copy = element.cloneNode(true);
  // Alpha-rename diagram-generated IDs and all references together. Keep every
  // element, label, style, path, dimension and link. HTML anchors aren't processed.
  const elements = [copy, ...copy.querySelectorAll('*')];
  // Mermaid's explicit-container API adds an unused standard declaration.
  // Namespace declarations in use, hrefs and their targets remain significant.
  if (copy.getAttribute('xmlns:xlink') === 'http://www.w3.org/1999/xlink' &&
      !elements.some(node => [...node.attributes].some(attribute => attribute.name.startsWith('xlink:'))))
    copy.removeAttribute('xmlns:xlink');
  const rootId = copy.id;
  const ids = new Map(elements.filter(node => node.id).map((node, index) => [node.id, `diagram-id-${index}`]));
  const replace = value => {
    for (const [id, replacement] of [...ids].sort(([a], [b]) => b.length - a.length)) {
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      value = value.replace(new RegExp(`#${escaped}(?=[^a-zA-Z0-9_-]|$)`, 'g'), `#${replacement}`);
    }
    // Some Mermaid styles refer to optional, absent definitions such as
    // <root-id>-gradient. Preserve the suffix and dangling-reference semantics.
    if (rootId) value = value.replace(new RegExp(`#${rootId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-`, 'g'), `#${ids.get(rootId)}-`);
    return value;
  };
  for (const node of elements) {
    if (node.id) node.id = ids.get(node.id);
    for (const attribute of [...node.attributes]) {
      if (attribute.name === 'id') continue;
      node.setAttribute(attribute.name, attribute.name === 'data-id' && ids.has(attribute.value) ? ids.get(attribute.value) : attribute.name === 'data-id' && rootId && attribute.value.startsWith(`${rootId}-`) ? `${ids.get(rootId)}${attribute.value.slice(rootId.length)}` : /^aria-(labelledby|describedby)$/.test(attribute.name)
        ? attribute.value.split(/\s+/).map(value => ids.get(value) || value).join(' ')
        : replace(attribute.value));
    }
    if (node.localName === 'style') node.textContent = replace(node.textContent);
  }
  return copy.outerHTML;
}

export async function pixelDifference({ expected, actual, tolerance }) {
  const decode = async value => {
    const image = new Image(); image.src = value; await image.decode();
    if(image.width>32767||image.height>32767)throw Error('Image exceeds safe browser Canvas dimensions; use comparePng');
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    return { width: image.width, height: image.height, pixels: context.getImageData(0, 0, image.width, image.height).data };
  };
  const [a, b] = await Promise.all([decode(expected), decode(actual)]);
  const width = Math.max(a.width, b.width), height = Math.max(a.height, b.height);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d'), diff = context.createImageData(width, height);
  let changed = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const ai = (y * a.width + x) * 4, bi = (y * b.width + x) * 4, di = (y * width + x) * 4;
    const missing = x >= a.width || y >= a.height || x >= b.width || y >= b.height;
    const different = missing || [0, 1, 2, 3].some(channel => Math.abs(a.pixels[ai + channel] - b.pixels[bi + channel]) > tolerance);
    if (different) changed++;
    diff.data.set(different ? [255, 0, 90, 255] : [220, 220, 220, 255], di);
  }
  context.putImageData(diff, 0, 0);
  return { expectedSize: [a.width, a.height], actualSize: [b.width, b.height],
    sameSize: a.width === b.width && a.height === b.height, changedPixels: changed,
    totalPixels: width * height, ratio: changed / (width * height), diff: canvas.toDataURL('image/png') };
}

export async function verifyBrowserComparator(page) {
  const images = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
    const context = canvas.getContext('2d'); context.fillStyle = '#000'; context.fillRect(0, 0, 2, 2);
    const black = canvas.toDataURL(); context.fillStyle = '#fff'; context.fillRect(0, 0, 1, 1);
    return { black, changed: canvas.toDataURL() };
  });
  const same = await page.evaluate(pixelDifference, { expected: images.black, actual: images.black, tolerance: 16 });
  const changed = await page.evaluate(pixelDifference, { expected: images.black, actual: images.changed, tolerance: 16 });
  if (same.changedPixels !== 0 || changed.changedPixels !== 1 || changed.ratio !== 0.25)
    throw new Error('PNG comparator failed its positive/negative controls');
  await page.setContent('<svg id="one"><style>path{fill:url(#one-gradient)}</style><defs><marker id="arrow1"/></defs><path id="path1" data-id="one-edge" marker-end="url(#arrow1)" d="M0 0 L1 1"/></svg>');
  const a = await page.locator('svg').evaluate(diagramSnapshot);
  await page.setContent('<svg id="two" xmlns:xlink="http://www.w3.org/1999/xlink"><style>path{fill:url(#two-gradient)}</style><defs><marker id="arrow2"/></defs><path id="path2" data-id="two-edge" marker-end="url(#arrow2)" d="M0 0 L1 1"/></svg>');
  const b = await page.locator('svg').evaluate(diagramSnapshot);
  await page.locator('path').evaluate(node => node.setAttribute('d', 'M0 0 L2 2'));
  const c = await page.locator('svg').evaluate(diagramSnapshot);
  if (a !== b || a === c) throw new Error('SVG comparator failed its ID/geometry controls');
}
