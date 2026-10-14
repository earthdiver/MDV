import {createHighlighterCore} from 'shiki/core';
import {createJavaScriptRegexEngine} from 'shiki/engine/javascript';
import githubLight from '@shikijs/themes/github-light-default';
import grammar from '../third_party/atom-shellscript/grammar.json';
let initialized;
const roles={'#1F2328':'--fgColor-default','#CF222E':'--prettylights-syntax-keyword','#8250DF':'--prettylights-syntax-entity','#0550AE':'--prettylights-syntax-constant','#0A3069':'--prettylights-syntax-string','#6E7781':'--prettylights-syntax-comment','#116329':'--prettylights-syntax-entityTag','#953800':'--prettylights-syntax-variable'};
export async function highlightShell(source) {
  const highlighter=await(initialized??=createHighlighterCore({themes:[githubLight],langs:[grammar],engine:createJavaScriptRegexEngine()}));
  const lines=highlighter.codeToTokensBase(source,{lang:'mdv-shell',theme:githubLight.name,includeExplanation:true});
  const fragment=document.createDocumentFragment();
  lines.forEach((line,index)=>{
    if(index)fragment.append('\n');
    const parts=[];
    for(const token of line)for(const part of token.explanation){
      // Match the service's painted scope boundaries. Structural meta scopes
      // and variable delimiters do not create separate visible spans.
      const scopes=part.scopes.map(s=>s.scopeName).filter(s=>/^(?:keyword|string|variable|support|entity|constant|comment|punctuation.definition.(?:string|comment))/.test(s));
      const key=scopes.join(' '),last=parts.at(-1);
      if(last&&last.key===key&&last.color===token.color)last.text+=part.content;
      else parts.push({key,text:part.content,color:token.color,fontStyle:token.fontStyle});
    }
    for(const part of parts){
      const span=document.createElement('span');span.textContent=part.text;
      span.style.color=`var(${roles[part.color?.toUpperCase()]||'--fgColor-default'})`;
      if(part.fontStyle&1)span.style.fontStyle='italic';if(part.fontStyle&2)span.style.fontWeight='bold';
      fragment.append(span);
    }
  });
  return fragment;
}
