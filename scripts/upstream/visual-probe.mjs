import {readFile,writeFile} from 'node:fs/promises';
import {PNG} from 'pngjs';
import {comparePng,cropPng} from '../compatibility/png-compare.mjs';

// Normalize before service scripts measure the article. Embedded renderers cache
// their initial width; changing it only after load can leave clipped diagrams.
export async function installArticleWidthNormalization(page, selector, width=800) {
  await page.addInitScript(({selector,width})=>{
    const style=document.createElement('style');
    style.textContent=`${selector}{width:${width}px!important;max-width:none!important;min-width:0!important;box-sizing:border-box!important;margin:0!important;padding:0!important}`;
    const install=()=>{if(!document.documentElement)return false;document.documentElement.append(style);return true;};
    if(!install()){const observer=new MutationObserver(()=>{if(install())observer.disconnect();});observer.observe(document,{childList:true,subtree:true});}
  },{selector,width});
}

// GitHub renders Mermaid in a cross-origin frame. A loading indicator is not
// a reference diagram: fail closed unless the actual SVG and its fonts are ready.
export async function waitForServiceDiagrams(page, selector, timeout=30000) {
  const frames=page.locator(selector+' iframe.render-viewer[src^="https://viewscreen.githubusercontent.com/markdown/mermaid"]');
  for(let i=0;i<await frames.count();i++){
    await frames.nth(i).scrollIntoViewIfNeeded({timeout});
    const frame=frames.nth(i).contentFrame();
    await frame.locator('svg#diagram').waitFor({state:'visible',timeout});
    await frame.locator('svg#diagram').evaluate(async svg=>{
      await document.fonts.ready;
      document.querySelectorAll('.mermaid-viewer-control-panel').forEach(n=>n.style.display='none');
      if(!svg.querySelector('g')||!svg.getBoundingClientRect().width)throw Error('Unverified Mermaid diagram');
      // Cross-origin offscreen frames suspend requestAnimationFrame.
      // The service debounces its resize message by 200ms.
      await new Promise(r=>setTimeout(r,300));
    });
    await frames.nth(i).waitFor({state:'visible',timeout});
  }
}

// Link-card frames load their metadata and thumbnail asynchronously. A blank
// thumbnail slot is not a completed reference, even if the parent has loaded.
export async function waitForServiceCards(page, selector, timeout=30000) {
  const cards=page.locator(selector+' iframe[src^="https://qiita.com/embed-contents/link-card"]');
  for(let i=0;i<await cards.count();i++) {
    const iframe=cards.nth(i);await iframe.scrollIntoViewIfNeeded({timeout});
    const frame=iframe.contentFrame();
    await frame.locator('a > div').waitFor({state:'visible',timeout});
    await frame.locator('body').evaluate(async body=>{
      await document.fonts.ready;
      await Promise.all([...body.querySelectorAll('img')].map(async image=>{
        await Promise.race([image.decode(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Card image timeout')),30000))]);
        if(!image.naturalWidth)throw Error('Unverified card thumbnail');
      }));
      await new Promise(r=>setTimeout(r,300));
    });
  }
}

// Only viewport/chrome are normalized. Never transplant the service's styles
// into MDV or hide article content, syntax tokens, images or authored colors.
export async function isolateArticle(page, selector, width=800) {
  await page.locator(selector).evaluate((root,width)=>{
    for(let node=root;node.parentElement;node=node.parentElement){
      for(const sibling of node.parentElement.children) if(sibling!==node && !['STYLE','SCRIPT','LINK'].includes(sibling.tagName)) sibling.style.setProperty('display','none','important');
      if(node!==root) for(const [key,value] of Object.entries({display:'block',position:'static',transform:'none',contain:'none',width:'auto',height:'auto',maxWidth:'none',minHeight:'0',margin:'0',padding:'0',border:'0',overflow:'visible'})) node.style[key]=value;
    }
    // Service promotions can arrive after the initial isolation pass. Keep
    // outside chrome hidden without touching any authored article descendant.
    root.__mdvChromeObserver?.disconnect();
    const hideOutside=node=>{
      if(!(node instanceof Element)||node.__mdvComparisonElement||node===root||root.contains(node)||node.contains(root)||['STYLE','SCRIPT','LINK'].includes(node.tagName))return;
      if(node.style.getPropertyValue('display')!=='none'||node.style.getPropertyPriority('display')!=='important')node.style.setProperty('display','none','important');
    };
    root.__mdvChromeObserver=new MutationObserver(records=>{
      for(const record of records) {
        if(record.type==='attributes')hideOutside(record.target);
        else for(const node of record.addedNodes)hideOutside(node);
      }
    });
    root.__mdvChromeObserver.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class']});
    root.dataset.visualRoot='true';
    for(const [key,value] of Object.entries({width:width+'px',maxWidth:'none',minWidth:'0',boxSizing:'border-box',margin:'0',padding:'0',position:'relative',left:'0',top:'0'}))root.style.setProperty(key.replace(/[A-Z]/g,m=>'-'+m.toLowerCase()),value,'important');
    // GitHub's clipboard button is site chrome, not Markdown content. MDV has
    // a hover-only button. Both are excluded from static article comparison.
    root.querySelectorAll('clipboard-copy,.copy-code,.code-copy,.js-render-block-actions').forEach(n=>n.style.setProperty('display','none','important'));
    for(const image of root.querySelectorAll('img')) image.loading='eager';
    window.scrollTo(0,0);
  },width);
  await waitForServiceDiagrams(page,selector);
  await waitForServiceCards(page,selector);
  await page.mouse.move(1050,850);
  await page.evaluate(()=>document.fonts.ready);
  const resources=await page.locator(selector).evaluate(async root=>{
    return Promise.all([...root.querySelectorAll('img')].map(async n=>{
      try {await Promise.race([n.decode(),new Promise((_,reject)=>setTimeout(()=>reject(Error('timeout')),15000))]);}catch{}
      return {src:n.currentSrc||n.src,loaded:n.complete&&n.naturalWidth>0,width:n.naturalWidth,height:n.naturalHeight,visible:n.getClientRects().length>0&&getComputedStyle(n).visibility!=='hidden'};
    }));
  });
  if(resources.some(n=>!n.loaded))throw Error('Unverified image resources: '+JSON.stringify(resources.filter(n=>!n.loaded)));
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
  return resources;
}

export function visualSnapshot(root) {
  const rect=root.getBoundingClientRect(), round=n=>Math.round(n*100)/100;
  const text=n=>(n.innerText??n.textContent).replace(/\s+/g,' ').trim();
  const props=['fontFamily','fontSize','fontWeight','fontStyle','fontFeatureSettings','textAutospace','textSpacingTrim','lineHeight','letterSpacing','color','backgroundColor','textDecorationLine','textDecorationColor','textUnderlineOffset','textAlign','verticalAlign','whiteSpace','wordBreak','overflowWrap','minHeight','paddingTop','paddingRight','paddingBottom','paddingLeft','marginTop','marginBottom','borderTopWidth','borderTopStyle','borderTopColor','borderRadius','boxShadow','listStyleType'];
  const visible=n=>{const s=getComputedStyle(n);return s.display!=='none'&&s.visibility!=='hidden'&&n.getClientRects().length>0&&!n.closest('.sr-only,.copy-code,.code-copy,clipboard-copy,.diagram-print');};
  const nodes=[...root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,pre,code,blockquote,table,th,td,img,hr,summary,font[color],strong,em,a[href]')].filter(visible).filter(n=>!n.closest('mjx-container,.katex,.diagram')&&!n.matches('.anchor,.mdv-heading-link,.reversefootnote')&&!n.matches('pre code')&&!(n.matches('a')&&!n.textContent.trim()&&n.querySelector('img')));
  const elements=nodes.map(n=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return {kind:n.tagName,text:text(n),box:{x:round(r.x-rect.x),y:round(r.y-rect.y),width:round(r.width),height:round(r.height)},css:Object.fromEntries(props.map(p=>[p,s[p]]))};});
  // Direct blocks include their child inline styles and all syntax tokens.
  const blocks=[...root.children].filter(visible).map((n,i)=>{n.dataset.visualBlock=String(i);const r=n.getBoundingClientRect();return {index:i,kind:n.tagName,text:text(n),box:{x:round(r.x-rect.x),y:round(r.y-rect.y),width:round(r.width),height:round(r.height)}};});
  return {width:round(rect.width),height:round(rect.height),elements,blocks};
}

export async function captureVisual(page,selector,prefix) {
  const snapshot=await page.locator(selector).evaluate(visualSnapshot);
  const png=await page.locator(selector).screenshot({path:prefix+'.png',animations:'disabled'});
  // Crop the SAME raster to avoid animation/scroll differences between shots.
  // Full-width strips also handle intrinsic tables inside full-width wrappers.
  const decoded=PNG.sync.read(png);
  await Promise.all(snapshot.blocks.map((block,i)=>writeFile(`${prefix}-block-${i}.png`,
    cropPng(decoded,Math.floor(block.box.y),Math.ceil(snapshot.blocks[i+1]?.box.y??decoded.height)))));
  return snapshot;
}

export async function compareVisual(control,expected,actual,expectedPrefix,actualPrefix) {
  const compare=async(a,b,prefix)=>{
    const result=comparePng(await readFile(a),await readFile(b),16);
    await writeFile(prefix+'-diff.png',result.diff);delete result.diff;return result;
  };
  const raster=await compare(expectedPrefix+'.png',actualPrefix+'.png',actualPrefix);
  const blocks=[];
  for(let i=0;i<Math.max(expected.blocks.length,actual.blocks.length);i++){
    if(!expected.blocks[i]||!actual.blocks[i]){blocks.push({index:i,status:'missing-block'});continue;}
    const result=await compare(`${expectedPrefix}-block-${i}.png`,`${actualPrefix}-block-${i}.png`,`${actualPrefix}-block-${i}`);
    blocks.push({index:i,text:expected.blocks[i].text.slice(0,100),...result});
  }
  const styles=[];
  for(let i=0;i<Math.max(expected.elements.length,actual.elements.length);i++){
    const a=expected.elements[i],b=actual.elements[i];
    if(!a||!b){styles.push({index:i,kind:'missing-element',expected:a,actual:b});continue;}
    if(a.kind!==b.kind||a.text!==b.text){styles.push({index:i,kind:'structure',expected:{kind:a.kind,text:a.text},actual:{kind:b.kind,text:b.text}});continue;}
    const css=Object.fromEntries(Object.keys(a.css).filter(k=>a.css[k]!==b.css[k]).map(k=>[k,{expected:a.css[k],actual:b.css[k]}]));
    const box=Object.fromEntries(Object.keys(a.box).filter(k=>Math.abs(a.box[k]-b.box[k])>.05).map(k=>[k,{expected:a.box[k],actual:b.box[k]}]));
    if(Object.keys(css).length||Object.keys(box).length)styles.push({index:i,kind:a.kind,text:a.text.slice(0,100),css,box});
  }
  // HTML wrappers and unpainted inherited CSS need not be identical. Keep
  // every diagnostic; gate painted properties as well as raster differences.
  const painted=['backgroundColor','boxShadow','borderTopWidth','borderTopStyle','borderRadius'];
  const textPaint=['fontFamily','fontSize','fontWeight','fontStyle','fontFeatureSettings','textAutospace','textSpacingTrim','lineHeight','letterSpacing','color','textDecorationLine'];
  const paintedStyleDifferences=styles.filter(n=>n.css&&Object.keys(n.css).some(k=>painted.includes(k)||(n.text&&textPaint.includes(k))||(k==='borderTopColor'&&expected.elements[n.index].css.borderTopWidth!=='0px'&&expected.elements[n.index].css.borderTopStyle!=='none')));
  return {status:raster.sameSize&&raster.changedPixels===0&&paintedStyleDifferences.length===0?'match':'different',raster,blocks,styles,paintedStyleDifferences,
    criteria:'Whole-article pixels (per-channel tolerance 16; no area allowance), painted computed styles, and separate semantic contracts. Wrapper geometry/unpainted CSS remain diagnostics. Block strips localize pixel differences.'};
}
