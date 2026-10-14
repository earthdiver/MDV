import {text as uiText} from './language.mjs';
let cardObserver;
// Saved metadata is untrusted: build text nodes and accept only the native archive image route.
export function applySavedQiitaCards(article, cards) {
  cardObserver?.disconnect();
  cardObserver=new ResizeObserver(entries=>{for(const {target} of entries)if(target.isConnected)target.parentElement.style.height=Math.round(target.getBoundingClientRect().height)+'px';});
  if (!cards || typeof cards !== 'object') return;
  for (const paragraph of article.querySelectorAll('.link-card')) {
    const link=paragraph.querySelector('a[href]');
    if (!link) continue;
    const card=Object.hasOwn(cards,link.href)?cards[link.href]:null;
    if (!card || typeof card.title!=='string' || typeof card.origin!=='string') continue;
    try { const origin=new URL(card.origin); if(!['http:','https:'].includes(origin.protocol)||origin.origin!==card.origin)continue; } catch {continue;}
    paragraph.classList.add('saved-link-card');
    const frame=document.createElement('span');frame.className='saved-card-frame';link.replaceWith(frame);frame.append(link);
    const content=document.createElement('span');content.className='saved-card-content';
    const title=document.createElement('span');title.className='saved-card-title';
    title.textContent=card.title?(card.title.length>70?card.title.slice(0,70)+'...':card.title):link.href;
    const origin=document.createElement('span');origin.className='saved-card-origin';origin.textContent=card.origin;
    content.append(title,origin);link.replaceChildren(content);
    if(typeof card.image==='string' && /^https:\/\/document\.mdv\.invalid\/qiita-card-image\/[a-f0-9]{64}$/.test(card.image)) {
      const image=document.createElement('img');image.alt='';image.width=220;image.height=110;image.src=card.image;
      image.addEventListener('error',()=>{image.hidden=true;paragraph.dataset.cardError='true';paragraph.title=uiText('保存したカード画像を読み込めません','Saved card image unavailable');});
      link.append(image);
    }
    // The service posts body.scrollHeight to an iframe: preserve its integer height.
    frame.style.height=Math.round(link.getBoundingClientRect().height)+'px';
    cardObserver.observe(link);
  }
}
