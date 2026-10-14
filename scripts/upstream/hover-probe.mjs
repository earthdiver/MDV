import {readFile,writeFile} from 'node:fs/promises';
import {PNG} from 'pngjs';
import {basename} from 'node:path';
import {comparePng} from '../compatibility/png-compare.mjs';

export const hoverPolicy='article-hover-v2';
const headingSelector='h1,h2,h3,h4,h5,h6';

// Chromium can rasterize the same inline SVG path differently depending on
// the surrounding document's paint context. For simple heading icons, paint
// the unchanged vector and its computed paints through one standalone SVG
// image pipeline on BOTH sides. Geometry and pointer checks still use the
// original DOM. Keep raw screenshots as diagnostics; never normalize text,
// icon fonts, pseudo-elements, complex SVGs, or the surrounding article.
async function normalizeHeadingSvg(element) {
  return element.evaluate(async heading=>{
    if(!heading.matches('h1,h2,h3,h4,h5,h6'))return false;
    const holder=heading.closest('.markdown-heading')||heading;
    const svg=holder.querySelector('a.anchor svg,a.mdv-heading-link svg');
    if(!svg||!svg.children.length||![...svg.children].every(n=>n.tagName.toLowerCase()==='path'&&!n.children.length))return false;
    for(const n of [holder,svg.parentElement,svg,...svg.children])for(const pseudo of ['::before','::after'])if(!['none','normal'].includes(getComputedStyle(n,pseudo).content))return false;
    const css=getComputedStyle(svg),matrix=svg.getScreenCTM();
    if(css.visibility!=='visible'||!matrix||matrix.a!==1||matrix.b!==0||matrix.c!==0||matrix.d!==1)return false;
    const bounds=svg.getBBox(),view=svg.viewBox.baseVal;
    if(!view.width||bounds.x<view.x||bounds.y<view.y||bounds.x+bounds.width>view.x+view.width||bounds.y+bounds.height>view.y+view.height)return false;
    let opacity=1;
    for(let n=svg;n;n=n.parentElement){const s=getComputedStyle(n);opacity*=Number(s.opacity);if(s.filter!=='none'||s.clipPath!=='none'||s.maskImage!=='none'||s.mixBlendMode!=='normal')return false;if(!n.matches('html,body,svg')&&(s.overflowX!=='visible'||s.overflowY!=='visible'))return false;}
    if(!opacity)return false;
    const rect=svg.getBoundingClientRect(),copy=svg.cloneNode(true);
    copy.setAttribute('xmlns','http://www.w3.org/2000/svg');
    copy.setAttribute('width',rect.width);copy.setAttribute('height',rect.height);
    const props=['color','fill','fill-rule','fill-opacity','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-miterlimit','stroke-dasharray','stroke-dashoffset','stroke-opacity','paint-order','shape-rendering','vector-effect','visibility'];
    for(const [index,node] of [svg,...svg.children].entries()) {
      const target=[copy,...copy.children][index],style=getComputedStyle(node);
      if(style.filter!=='none'||style.clipPath!=='none'||style.maskImage!=='none'||style.boxShadow!=='none'||style.outlineStyle!=='none'||style.backgroundColor!=='rgba(0, 0, 0, 0)'||parseFloat(style.borderTopWidth)||style.stroke!=='none')return false;
      for(const prop of props){const value=style.getPropertyValue(prop);if(/url\(|context-/.test(value))return false;target.style.setProperty(prop,value);}
      // Path transforms/opacity must retain their computed appearance.
      if(index){target.style.transform=style.transform;target.style.transformOrigin=style.transformOrigin;target.style.opacity=style.opacity;target.style.setProperty('d',style.getPropertyValue('d'));}
    }
    copy.style.opacity='1';copy.style.transform='none';
    const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(copy))));
    await image.decode();
    image.style.cssText=`position:fixed!important;left:${rect.x}px!important;top:${rect.y}px!important;width:${rect.width}px!important;height:${rect.height}px!important;max-width:none!important;margin:0!important;padding:0!important;border:0!important;pointer-events:none!important;opacity:${opacity}!important;z-index:2147483647!important`;
    const saved=svg.getAttribute('style');svg.style.setProperty('opacity','0','important');image.__mdvComparisonElement=true;document.body.append(image);
    heading.__mdvSvgRestore=()=>{image.remove();if(saved===null)svg.removeAttribute('style');else svg.setAttribute('style',saved);delete heading.__mdvSvgRestore;};
    return true;
  });
}

// Enumerate every visible target, without sampling away rare heading levels or
// links. Generated image links are exercised through their image target.
function inventory(root) {
  const excluded='.sr-only,.copy-code,.code-copy,clipboard-copy,.js-render-block-actions,.diagram,.diagram-print,mjx-container,.katex,.link-card';
  const visible=n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden'&&!n.closest(excluded);
  return [...root.querySelectorAll('h1,h2,h3,h4,h5,h6,a[href],img,summary')].filter(visible).filter(n=>{
    if(n.matches('img'))return !n.matches('.emoji');
    if(n.matches('a'))return !n.matches('.anchor,.mdv-heading-link,.heading-permalink')&&!n.querySelector('.fa-link')&&!(n.querySelector('img')&&!n.textContent.trim());
    return true;
  }).map((n,index)=>{
    n.dataset.mdvHoverTarget=String(index);
    const copy=n.cloneNode(true);copy.querySelectorAll('.anchor,.mdv-heading-link,.heading-permalink,a:has(.fa-link),svg').forEach(e=>e.remove());
    return {index,kind:n.tagName,text:(n.matches('img')?n.alt:copy.textContent).replace(/\s+/g,' ').trim()};
  });
}

// Keep native markup (e.g. GitHub's heading wrapper) out of the contract.
// Measure painted roles, including the icon's pseudo-elements, instead.
function snapshot(target) {
  const root=target.closest('[data-visual-root]'),origin=root.getBoundingClientRect();
  const round=n=>Math.round(n*100)/100;
  const props=['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','color','backgroundColor','textDecorationLine','textDecorationColor','textUnderlineOffset','boxShadow','borderRadius','borderTopWidth','borderTopStyle','borderTopColor','outlineWidth','outlineStyle','outlineColor','fill'];
  const painted=n=>{
    if(!n||!n.getClientRects().length)return false;
    for(let p=n;p&&p!==root.parentElement;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)return false;}
    return true;
  };
  const measure=n=>{
    if(!n)return {present:false};
    if(!painted(n))return {present:true,visible:false};
    const s=getComputedStyle(n),r=n.getBoundingClientRect();
    const pseudo=which=>{const p=getComputedStyle(n,which);return ['none','normal'].includes(p.content)?null:{content:p.content,css:Object.fromEntries([...props,'width','height','position','top','left','transform','zIndex'].map(k=>[k,p[k]]))};};
    return {present:true,visible:true,box:{x:round(r.x-origin.x),y:round(r.y-origin.y),width:round(r.width),height:round(r.height)},css:Object.fromEntries(props.map(k=>[k,s[k]])),before:pseudo('::before'),after:pseudo('::after')};
  };
  const heading=target.matches('h1,h2,h3,h4,h5,h6');
  const holder=heading?(target.closest('.markdown-heading')||target):target;
  const anchor=heading?holder.querySelector('a.anchor,a.mdv-heading-link,a.heading-permalink,a:has(.fa-link)'):null;
  return {target:measure(target),...(heading?{anchor:measure(anchor),icon:measure(anchor?.querySelector('.fa-link,svg'))}:{})};
}

function pointerInside(n) {
  const point=n.closest('[data-visual-root]').__mdvHoverPoint;
  const hit=point&&document.elementFromPoint(point.x,point.y);
  return !!hit&&(n===hit||n.contains(hit));
}

export async function captureHover(page,selector,prefix) {
  const root=page.locator(selector);
  const saved=await root.getAttribute('style');
  // The static article starts at x=0; a negative-left anchor would be clipped
  // and impossible to hover. Translate the whole article, preserving its width.
  await root.evaluate(n=>{
    n.style.setProperty('left','48px','important');n.style.setProperty('top','48px','important');
    n.__mdvHoverSpacer=document.createElement('div');n.__mdvHoverSpacer.__mdvComparisonElement=true;n.__mdvHoverSpacer.style.height=innerHeight+'px';n.after(n.__mdvHoverSpacer);
    n.__mdvHoverMove=e=>{n.__mdvHoverPoint={x:e.clientX,y:e.clientY};};
    window.addEventListener('mousemove',n.__mdvHoverMove,true);
  });
  const targets=await root.evaluate(inventory),states=[];
  const settle=()=>page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  const moveTo=async locator=>{
    const point=await locator.evaluate(n=>{
      const rect=[...n.getClientRects()].map(r=>({left:Math.max(0,r.left),right:Math.min(innerWidth,r.right),top:Math.max(0,r.top),bottom:Math.min(innerHeight,r.bottom)})).find(r=>r.right>r.left&&r.bottom>r.top);
      return rect?{x:(rect.left+rect.right)/2,y:(rect.top+rect.bottom)/2}:null;
    });
    if(!point)throw Error('Unverified hover: no visible hit target');
    await page.mouse.move(point.x,point.y);
  };
  try {
    for(const target of targets) {
      const element=root.locator(`[data-mdv-hover-target="${target.index}"]`);
      const heading=await element.evaluate((n,s)=>n.matches(s),headingSelector);
      let anchor;
      if(heading)anchor=element.locator('xpath=ancestor-or-self::*[contains(concat(" ",normalize-space(@class)," ")," markdown-heading ")][1]').locator('a.anchor');
      if(!heading||!await anchor.count())anchor=element.locator('a.anchor,a.mdv-heading-link,a.heading-permalink,a:has(.fa-link)');
      for(const state of heading?['normal','hover','anchor-hover']:['normal','hover']) {
        await element.scrollIntoViewIfNeeded();
        let exercised=true;
        const applyState=async()=>{
          await page.mouse.move(1060,880);
          if(state!=='normal')await moveTo(element);
          if(state==='anchor-hover') {
            if(await anchor.count()&&await anchor.isVisible()) {
              const icon=anchor.locator('.fa-link,svg');
              await moveTo(await icon.count()?icon:anchor);
            } else exercised=false;
          }
          await settle();
        };
        await applyState();
        const clip=await element.evaluate(n=>{const r=n.getBoundingClientRect(),a=n.closest('[data-visual-root]').getBoundingClientRect(),y=Math.max(0,Math.floor(r.y+scrollY-8));return {x:Math.max(0,Math.floor(a.x+scrollX-48)),y,width:Math.ceil(a.width+96),height:Math.ceil(r.bottom+scrollY+8)-y};});
        const raster=new PNG({width:clip.width,height:clip.height}),rawRaster=new PNG({width:clip.width,height:clip.height});
        let measurement,tiles=0;
        const viewports=[];let normalizedSvg=false;
        // Beyond-viewport screenshots can change scroll/hover state on live
        // pages. Capture viewport tiles and reapply a real mouse hover on each.
        for(let offset=0;offset<clip.height;) {
          await page.evaluate(y=>window.scrollTo({left:0,top:y,behavior:'instant'}),clip.y+offset);
          await settle();await applyState();
          measurement??=await element.evaluate(snapshot);
          const active=state==='anchor-hover'?anchor:element;
          if(state!=='normal'&&exercised&&!await active.evaluate(pointerInside))throw Error(`Unverified hover before capture: ${target.kind}/${target.index}/${state}`);
          const viewportClip=await page.evaluate(({clip,offset})=>({x:clip.x-scrollX,y:clip.y+offset-scrollY,width:clip.width,height:Math.min(clip.height-offset,innerHeight-(clip.y+offset-scrollY))}),{clip,offset});
          viewports.push(await element.evaluate(n=>({scrollY,box:n.getBoundingClientRect().toJSON()})));
          if(viewportClip.height<=0)throw Error('Unverified hover tile: outside viewport');
          const rawTile=PNG.sync.read(await page.screenshot({clip:viewportClip,animations:'disabled'}));
          let tile=rawTile;
          try {
            if(await normalizeHeadingSvg(element)){normalizedSvg=true;tile=PNG.sync.read(await page.screenshot({clip:viewportClip,animations:'disabled'}));}
          } finally {await element.evaluate(n=>n.__mdvSvgRestore?.());}
          if(state!=='normal'&&exercised&&!await active.evaluate(pointerInside))throw Error(`Unverified hover after capture: ${target.kind}/${target.index}/${state}`);
          PNG.bitblt(tile,raster,0,0,tile.width,tile.height,0,offset);
          PNG.bitblt(rawTile,rawRaster,0,0,rawTile.width,rawTile.height,0,offset);
          offset+=tile.height;tiles++;
        }
        await writeFile(`${prefix}-${target.index}-${state}.png`,PNG.sync.write(raster));
        await writeFile(`${prefix}-${target.index}-${state}-raw.png`,PNG.sync.write(rawRaster));
        states.push({target,state,exercised,measurement,tiles,viewports,normalizedSvg});
      }
    }
    return {policy:hoverPolicy,targets,states,coverage:'Every visible heading (body and anchor), authored text link, non-emoji image and summary; normal/hover rasters including 48px gutter, painted roles and pseudo-elements. No clicks.',excluded:'Site chrome, copy controls, link-card embeds, math/diagram internals, closed-details contents and keyboard focus. Focus behavior has separate app tests.'};
  } finally {
    await root.evaluate((n,s)=>{window.removeEventListener('mousemove',n.__mdvHoverMove,true);n.__mdvHoverSpacer.remove();delete n.__mdvHoverSpacer;delete n.__mdvHoverMove;delete n.__mdvHoverPoint;if(s===null)n.removeAttribute('style');else n.setAttribute('style',s);n.querySelectorAll('[data-mdv-hover-target]').forEach(e=>e.removeAttribute('data-mdv-hover-target'));},saved);
    await page.mouse.move(1060,880);await page.evaluate(()=>window.scrollTo(0,0));
  }
}

export async function compareHover(expected,actual,expectedPrefix,actualPrefix) {
  if(expected?.policy!==hoverPolicy||actual?.policy!==hoverPolicy)throw Error('Hover capture policy changed: refresh required');
  const targetsMatch=JSON.stringify(expected.targets)===JSON.stringify(actual.targets),differences=[],rawDifferences=[];
  for(let index=0;index<Math.max(expected.states.length,actual.states.length);index++) {
    const a=expected.states[index],b=actual.states[index];
    if(!a||!b||JSON.stringify(a.target)!==JSON.stringify(b.target)||a.state!==b.state){differences.push({index,kind:'missing-or-different-target',expected:a?.target,actual:b?.target});continue;}
    const suffix=`-${a.target.index}-${a.state}`;
    const raster=comparePng(await readFile(expectedPrefix+suffix+'.png'),await readFile(actualPrefix+suffix+'.png'),16);
    const {diff,...pixels}=raster;
    const {diff:rawDiff,...rawPixels}=comparePng(await readFile(expectedPrefix+suffix+'-raw.png'),await readFile(actualPrefix+suffix+'-raw.png'),16);
    if(rawPixels.changedPixels)rawDifferences.push({target:a.target,state:a.state,raster:rawPixels,expectedNormalized:!!a.normalizedSvg,actualNormalized:!!b.normalizedSvg,
      images:{reference:basename(expectedPrefix+suffix+'-raw.png'),actual:basename(actualPrefix+suffix+'-raw.png')}});
    // Raster comparison gates visual appearance. CSS is diagnostic because
    // invisible decorations and equivalent SVG/font wrappers legitimately differ.
    const cssMatch=JSON.stringify(a.measurement)===JSON.stringify(b.measurement);
    const geometry=m=>Object.fromEntries(Object.entries(m).map(([key,value])=>[key,{present:value.present,box:value.box}]));
    const geometryMatch=JSON.stringify(geometry(a.measurement))===JSON.stringify(geometry(b.measurement));
    const status=a.exercised&&b.exercised&&geometryMatch&&pixels.sameSize&&pixels.changedPixels===0?'match':'different';
    if(status!=='match') {
      await writeFile(actualPrefix+suffix+'-diff.png',diff);
      differences.push({index,target:a.target,state:a.state,status,raster:pixels,expectedExercised:a.exercised,actualExercised:b.exercised,cssMatch,geometryMatch,expected:a.measurement,actual:b.measurement,
        images:{reference:basename(expectedPrefix+suffix+'.png'),actual:basename(actualPrefix+suffix+'.png'),difference:basename(actualPrefix+suffix+'-diff.png')}});
    }
  }
  return {status:targetsMatch&&!differences.length?'match':'different',policy:hoverPolicy,targetsMatch,states:expected.states.length,differences,rawDifferences,
    images:Object.fromEntries(differences.flatMap(d=>Object.entries(d.images||{}).map(([kind,path])=>[`${d.target.index}: ${d.target.text} (${d.state}, ${kind})`,path]))),
    criteria:'All targets/states must exist and be exercised; target/anchor/icon geometry must match; zero normalized raster pixels at channel tolerance 16 with no area allowance. Simple heading SVGs use the same standalone image rasterization with original vector paths and computed paints on both sides. Raw screenshots/differences are retained. Other CSS/pseudo-element diagnostics accompany differences.'};
}
