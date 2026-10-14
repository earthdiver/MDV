import {createHighlighterCore} from 'shiki/core';
import {createJavaScriptRegexEngine} from 'shiki/engine/javascript';
import {bundledLanguages} from 'shiki/langs';
import githubLight from '@shikijs/themes/github-light-default';

// TextMate scopes with GitHub's currently observed operator/parameter roles.
// Resolve palette roles through bundled Primer variables, including print/dark.
const theme={...githubLight,name:'mdv-github',tokenColors:[...githubLight.tokenColors,
  {scope:['source.cpp keyword.operator','entity.name.function.call.cpp'],settings:{foreground:'#1F2328'}},
  {scope:'entity.name.function.call.upper-case.cpp entity.name.function.call.cpp',settings:{foreground:'#0550AE'}},
  {scope:'meta.function-call.generic.python',settings:{foreground:'#8250DF'}},
  {scope:['assignment','arithmetic','increment','decrement','comparison','logical','bitwise'].map(kind=>`keyword.operator.${kind}.powershell`),settings:{foreground:'#CF222E'}},
  {scope:['keyword.operator.assignment','keyword.operator.arithmetic','keyword.operator.increment','keyword.operator.decrement','keyword.operator.comparison','keyword.operator.logical','keyword.operator.bitwise'],settings:{foreground:'#0550AE'}},
  {scope:['assignment','arithmetic','increment','decrement','comparison','logical','bitwise'].map(kind=>`keyword.operator.${kind}.cpp`),settings:{foreground:'#1F2328'}},
  {scope:['variable.parameter','variable.other.constant.js','punctuation.definition.template-expression'],settings:{foreground:'#1F2328'}},
  {scope:['variable.other.property.js','variable.other.object.property.js','string.regexp.js punctuation.definition.string.begin.js','string.regexp.js punctuation.definition.string.end.js','keyword.operator.quantifier.regexp','keyword.operator.or.regexp'],settings:{foreground:'#0550AE'}},
  {scope:['keyword.control.anchor.regexp','constant.character.escape.regexp','constant.character.escape.backslash.regexp','constant.other.character-class.regexp'],settings:{foreground:'#0A3069'}},
  {scope:['variable.ruby','punctuation.definition.constant.hashkey.ruby','keyword.operator.bitwise.ruby'],settings:{foreground:'#1F2328'}},
  {scope:['support.class.ruby','variable.other.constant.ruby'],settings:{foreground:'#953800'}},
  {scope:'keyword.other.special-method.ruby',settings:{foreground:'#8250DF'}},
  {scope:'constant.language.symbol.hashkey.ruby',settings:{foreground:'#0A3069'}},
  {scope:'constant.character.escape.ruby',settings:{foreground:'#0A3069'}},
  {scope:['entity.other.document.begin.yaml','entity.other.document.end.yaml'],settings:{foreground:'#1F2328'}},
  {scope:['punctuation.definition.begin.frontmatter','punctuation.definition.end.frontmatter'],settings:{foreground:'#0A3069'}},
  {scope:['meta.flow-sequence.yaml','punctuation.definition.sequence.begin.yaml','punctuation.definition.sequence.end.yaml','punctuation.separator.sequence.yaml'],settings:{foreground:'#0A3069'}},
  {scope:['punctuation.definition.raw.markdown','punctuation.definition.link.title.begin.markdown','punctuation.definition.link.title.end.markdown','punctuation.definition.metadata.markdown','markup.underline.link.markdown','markup.underline.link.image.markdown','punctuation.definition.link.description.begin.markdown','punctuation.definition.link.description.end.markdown'],settings:{foreground:'#0A3069'}},
  {scope:['string.other.link.title.markdown','string.other.link.description.markdown'],settings:{foreground:'#1F2328'}},
  {scope:['support.type.property-name.json.comments','constant.character.escape.json.comments'],settings:{foreground:'#0550AE'}},
  {scope:'invalid.illegal.expected-dictionary-separator.json.comments',settings:{foreground:'#D1242F',fontStyle:''}},
]};
const roles={'#D1242F':'--fgColor-danger','#1F2328':'--fgColor-default','#CF222E':'--prettylights-syntax-keyword','#8250DF':'--prettylights-syntax-entity','#0550AE':'--prettylights-syntax-constant','#0A3069':'--prettylights-syntax-string','#6E7781':'--prettylights-syntax-comment','#116329':'--prettylights-syntax-entityTag','#953800':'--prettylights-syntax-variable'};
let singleton;
const languages=new Map();
export async function applyGithubHighlighting(article,{textmateOnly=false}={}) {
  for(const pre of article.querySelectorAll('pre')){
    const code=pre.querySelector('code');
    const rawLanguage=(pre.getAttribute('lang')||[...(code?.classList||[])].find(c=>c.startsWith('language-'))?.slice(9)||'').toLowerCase();
    const language=({cc:'cpp','c++':'cpp',cxx:'cpp'})[rawLanguage]||rawLanguage;
    if(!textmateOnly&&['ts','typescript','js','javascript','css','go','golang','c'].includes(language)&&pre.textContent.length<=100000){
      const {highlightGithubSyntax}=await import('./github-syntax.mjs');
      // Native parser highlighting consumes the fence newline and one trailing blank line.
      const target=code||pre;target.replaceChildren(await highlightGithubSyntax(language==='css'?pre.textContent:pre.textContent.replace(/\n{1,2}$/, ''),language));target.dataset.mdvHighlighter='tree-sitter';continue;
    }
    if(['sh','bash','shell','shellscript','zsh','ksh'].includes(language)&&pre.textContent.length<=100000){
      const {highlightShell}=await import('./github-shell.mjs');
      const target=code||pre;target.replaceChildren(await highlightShell(pre.textContent));target.dataset.mdvHighlighter='textmate';continue;
    }
    const load=bundledLanguages[language];
    const source=pre.textContent;
    if(!load||language==='diff'||source.length>100000)continue;
    const highlighter=await (singleton??=createHighlighterCore({themes:[theme],langs:[],engine:createJavaScriptRegexEngine()}));
    if(!languages.has(language))languages.set(language,highlighter.loadLanguage(await load()));
    await languages.get(language);
    const javascript=['js','javascript','jsx'].includes(language),ruby=['ruby','rb'].includes(language),powershell=['powershell','ps1'].includes(language),scoped=javascript||ruby;
    const markdown=['markdown','md'].includes(language);
    const frontmatter=markdown&&source.match(/^---\n([\s\S]*?\n)---(?=\n|$)/);
    if(frontmatter&&!languages.has('yaml')){await highlighter.loadLanguage(await bundledLanguages.yaml());languages.set('yaml',Promise.resolve());}
    const lines=highlighter.codeToTokensBase(source,{lang:language,theme:'mdv-github',includeExplanation:scoped||powershell||markdown||language==='jsonc'});
    if(frontmatter){
      const yamlLines=highlighter.codeToTokensBase(frontmatter[1].slice(0,-1),{lang:'yaml',theme:'mdv-github'});
      const delimiter=[{content:'---',color:'#0A3069',fontStyle:0}];
      lines.splice(0,yamlLines.length+2,delimiter,...yamlLines,delimiter);
    }
    // GitHub distinguishes calls of locally bound values from named functions.
    const valueBindings=new Set();
    if(scoped)for(const line of lines)for(const token of line)for(const part of token.explanation||[])
      if(part.scopes.at(-1)?.scopeName===(ruby?'variable.ruby':'variable.other.constant.js'))valueBindings.add(part.content);
    const renderedLines=powershell?lines.map(line=>{
      const parts=[];
      for(const token of line)for(const part of token.explanation){
        const key=part.scopes.map(s=>s.scopeName).filter(s=>/^(?:keyword|string|variable|support|entity|constant|comment|punctuation.definition.(?:string|comment))/.test(s)).join(' ');
        const last=parts.at(-1);
        if(last&&last.key===key&&last.color===token.color)last.content+=part.content;
        else parts.push({...token,content:part.content,key});
      }
      return parts;
    }):scoped?lines.map(line=>{
      const parts=[];
      for(const token of line)for(const part of token.explanation||[{content:token.content,scopes:[]}]){
        const scopes=part.scopes.map(s=>s.scopeName),leaf=scopes.at(-1)||'';
        let color=token.color;
        if(ruby&&leaf.startsWith('keyword.operator.')&&['<<','>>'].includes(part.content))color='#1F2328';
        else if(ruby&&leaf==='source.ruby'&&/^[a-z_]\w*[!?]?$/.test(part.content)&&!valueBindings.has(part.content))color='#8250DF';
        else if(ruby&&['support.class.ruby','variable.other.constant.ruby'].includes(leaf)&&/^[A-Z_][A-Z_0-9]*$/.test(part.content))color='#0550AE';
        else if(javascript&&/^(?:variable\.|entity.name.function)/.test(leaf)&&/^[A-Z_][A-Z_0-9]+$/.test(part.content))color='#0550AE';
        else if(javascript&&/^(?:variable\.|entity.name.function)/.test(leaf)&&/^[A-Z]/.test(part.content))color='#953800';
        else if(leaf==='entity.name.function.js'&&valueBindings.has(part.content))color='#1F2328';
        const merge=scopes.some(s=>/^(?:comment|string)/.test(s))&&!scopes.some(s=>s==='string.regexp.js'||s==='meta.template.expression.js'||s==='constant.character.escape.ruby');
        const last=parts.at(-1);
        if(merge&&last?.merge&&last.color===color)last.content+=part.content;
        else if(scopes.includes('string.regexp.js')&&/^(?:string.regexp.js|meta.group.regexp)$/.test(leaf))for(const content of part.content)parts.push({...token,content,color,merge:false});
        else parts.push({...token,content:part.content,color,merge});
      }
      return parts;
    }):lines.map(line=>{
      const merged=[];
      const tokens=markdown?line.flatMap(token=>token.explanation?.some(p=>p.scopes.some(s=>['meta.link.inline.markdown','meta.image.inline.markdown','markup.inline.raw.string.markdown'].includes(s.scopeName)))
        ?token.explanation.map(part=>({...token,content:part.content,noMerge:true})):token):language==='jsonc'?line.flatMap(token=>token.explanation.map(part=>({...token,content:part.content,noMerge:part.scopes.some(s=>s.scopeName==='constant.character.escape.json.comments')}))):line;
      for(const originalToken of tokens){
        // GitHub recognizes JSON member fragments without enclosing braces.
        const token=language==='json'&&/^".*"$/.test(originalToken.content)&&/^\s*:/.test(source.slice(originalToken.offset+originalToken.content.length))
          ?{...originalToken,color:'#0550AE'}:originalToken;
        const last=merged.at(-1);if(last&&!last.noMerge&&!token.noMerge&&last.color===token.color&&last.fontStyle===token.fontStyle)last.content+=token.content;else merged.push({...token});}
      return merged.flatMap(token=>{
        if(['markdown','md'].includes(language)&&(token.fontStyle&2)&&/^#{1,6}\s/.test(token.content)){
          const prefix=token.content.match(/^#{1,6}\s+/)[0];return [{...token,content:prefix},{...token,content:token.content.slice(prefix.length)}];
        }
        if(['yaml','yml','markdown','md'].includes(language)&&token.color?.toUpperCase()==='#6E7781'&&token.content.startsWith('#'))
          return [{...token,content:'#'},{...token,content:token.content.slice(1)}];
        if(language==='jsonc'&&token.color?.toUpperCase()==='#6E7781'&&token.content.startsWith('//'))
          return [{...token,content:'//'},{...token,content:token.content.slice(2)}];
        if(!['kusto','kql'].includes(language)&&token.color?.toUpperCase()==='#0A3069'&&/^(["']).*\1$/.test(token.content)&&token.content.length>1)
          return [token.content[0],token.content.slice(1,-1),token.content.at(-1)].filter(Boolean).map(content=>({...token,content}));
        if(['kusto','kql'].includes(language)&&token.color?.toUpperCase()==='#0550AE'&&/^[a-z_]+\(\)$/i.test(token.content))
          return [{...token,content:token.content.slice(0,-2)},{...token,content:'()',color:'#1F2328'}];
        return [token];
      });
    });
    const fragment=document.createDocumentFragment();
    renderedLines.forEach((line,index)=>{
      if(index)fragment.append('\n');
      for(const token of line){const span=document.createElement('span');span.textContent=token.content;
        const role=roles[token.color?.toUpperCase()];span.style.color=role?`var(${role})`:token.color;
        const legacyClass={'--prettylights-syntax-keyword':'hljs-keyword','--prettylights-syntax-string':'hljs-string','--prettylights-syntax-comment':'hljs-comment'}[role];
        if(legacyClass)span.className=legacyClass;
        if(token.color?.toUpperCase()==='#D1242F')span.style.backgroundColor='var(--prettylights-syntax-invalidIllegal-bg)';
        if(token.fontStyle&1)span.style.fontStyle='italic';if(token.fontStyle&2)span.style.fontWeight='bold';if(token.fontStyle&4)span.style.textDecoration='underline';
        fragment.append(span);
      }
    });
    const target=code||pre;target.replaceChildren(fragment);target.dataset.mdvHighlighter='textmate';
  }
}

// Preserve the separately verified regular-expression tokenization inside
// Tree-sitter's regex nodes; no authored code is evaluated.
export async function highlightGithubRegex(source) {
  const article=document.createElement('div'),pre=document.createElement('pre'),code=document.createElement('code');
  code.className='language-js';code.textContent=source;pre.append(code);article.append(pre);
  await applyGithubHighlighting(article,{textmateOnly:true});
  const fragment=document.createDocumentFragment();fragment.append(...code.childNodes);return fragment;
}
