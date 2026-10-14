import {Parser,Language,Query} from 'web-tree-sitter';
import runtime from 'web-tree-sitter/web-tree-sitter.wasm';
import javascript from 'tree-sitter-javascript/tree-sitter-javascript.wasm';
import typescript from 'tree-sitter-typescript/tree-sitter-typescript.wasm';
import css from 'tree-sitter-css/tree-sitter-css.wasm';
import cssQuery from 'tree-sitter-css/queries/highlights.scm';
import go from 'tree-sitter-go/tree-sitter-go.wasm';
import goQuery from 'tree-sitter-go/queries/highlights.scm';
import c from 'tree-sitter-c/tree-sitter-c.wasm';
import cQuery from 'tree-sitter-c/queries/highlights.scm';
import jsdoc from 'tree-sitter-jsdoc/tree-sitter-jsdoc.wasm';
import jsdocQuery from 'tree-sitter-jsdoc/queries/highlights.scm';
import typescriptQuery from 'tree-sitter-typescript/queries/highlights.scm';
import javascriptQuery from 'tree-sitter-javascript/queries/highlights.scm';

let initialized, commentParser;
const parsers=new Map();
const roles={variable:'--fgColor-default','variable.builtin':'--fgColor-default','variable.parameter':'--fgColor-default',
  property:'--prettylights-syntax-constant',function:'--prettylights-syntax-entity','function.method':'--prettylights-syntax-entity','function.builtin':'--prettylights-syntax-entity',
  constructor:'--prettylights-syntax-variable',constant:'--prettylights-syntax-constant','constant.builtin':'--prettylights-syntax-constant',
  comment:'--prettylights-syntax-comment',string:'--prettylights-syntax-string','string.special':'--prettylights-syntax-string',
  number:'--prettylights-syntax-constant',operator:'--prettylights-syntax-constant',keyword:'--prettylights-syntax-keyword',
  embedded:'--fgColor-default','punctuation.bracket':'--fgColor-default','punctuation.delimiter':'--fgColor-default','punctuation.special':'--fgColor-default',
  type:'--fgColor-default','type.builtin':'--fgColor-default',tag:'--prettylights-syntax-entityTag',attribute:'--prettylights-syntax-entity'};

export async function highlightGithubSyntax(source,language) {
  await(initialized??=Parser.init({wasmBinary:runtime}));
  const key=language==='c'?'c':['go','golang'].includes(language)?'go':language==='css'?'css':['ts','typescript'].includes(language)?'typescript':'javascript';
  if(!parsers.has(key))parsers.set(key,(async()=>{
    const grammar=await Language.load(key==='c'?c:key==='go'?go:key==='css'?css:key==='typescript'?typescript:javascript);
    const parser=new Parser();parser.setLanguage(grammar);
    // Follow the query order declared by the pinned TypeScript grammar.
    const modifiers='((identifier) @keyword (#match? @keyword "^(private|protected|public)$"))';
    const query=new Query(grammar,key==='c'?cQuery:key==='go'?goQuery:key==='css'?cssQuery:(key==='typescript'?typescriptQuery+'\n':'')+javascriptQuery+(key==='typescript'?'\n'+modifiers:''));
    return {parser,query};
  })());
  const {parser,query}=await parsers.get(key);
  const tree=parser.parse(source);
  try {
    const queried=query.captures(tree.rootNode).filter(c=>c.node.endIndex>c.node.startIndex&&!(key==='c'&&c.name==='delimiter'));
    // Inject the official JSDoc grammar into comments, including partial ones.
    // It distinguishes tags, type expressions and ordinary prose without regex
    // guesses about inline links, email addresses or successive tag arguments.
    for(const comment of queried.filter(c=>['javascript','typescript'].includes(key)&&c.name==='comment'&&c.node.text.includes('@'))){
      const {parser:docParser,query:docQuery}=await(commentParser??=(async()=>{
        const grammar=await Language.load(jsdoc),parser=new Parser();parser.setLanguage(grammar);
        return {parser,query:new Query(grammar,jsdocQuery)};
      })());
      const docTree=docParser.parse(comment.node.text);
      try{for(const capture of docQuery.captures(docTree.rootNode))queried.push({name:capture.name,patternIndex:capture.patternIndex,
        node:{startIndex:comment.node.startIndex+capture.node.startIndex,endIndex:comment.node.startIndex+capture.node.endIndex,type:capture.node.type,text:capture.node.text}});
      }finally{docTree.delete();}
    }
    const regexes=queried.filter(c=>c.name==='string.special'&&c.node.type==='regex');
    // Delegate complete regex literals; nested slash captures must not split
    // off their delimiters before the verified TextMate regex pass.
    const captures=queried.filter(c=>regexes.includes(c)||!regexes.some(r=>c.node.startIndex>=r.node.startIndex&&c.node.endIndex<=r.node.endIndex));
    const definitions=tree.rootNode.descendantsOfType('variable_declarator').map(node=>({name:node.childForFieldName('name'),value:node.childForFieldName('value')})).filter(d=>d.name?.type==='identifier');
    const scope=node=>{for(let parent=node.parent;parent;parent=parent.parent)if(['statement_block','function_expression','arrow_function','function_declaration','method_definition','program'].includes(parent.type))return parent;return tree.rootNode;};
    const isBoundValue=node=>{
      for(let parent=node;parent;parent=parent.parent){
        const found=definitions.find(d=>d.name.text===node.text&&d.name.startIndex<node.startIndex&&scope(d.name).id===parent.id);
        if(found)return !['function_expression','arrow_function'].includes(found.value?.type);
      }
      return false;
    };
    const events=new Map();
    const event=pos=>{if(!events.has(pos))events.set(pos,{start:[],end:[]});return events.get(pos);};
    captures.forEach((capture,id)=>{event(capture.node.startIndex).start.push(id);event(capture.node.endIndex).end.push(id);});
    event(0);event(source.length);
    const positions=[...events.keys()].sort((a,b)=>a-b),active=new Set(),segments=[];
    for(let i=0;i<positions.length-1;i++){
      const pos=positions[i];for(const id of events.get(pos).end)active.delete(id);for(const id of events.get(pos).start)active.add(id);
      const sorted=[...active].sort((a,b)=>{const x=captures[a],y=captures[b];return (y.node.endIndex-y.node.startIndex)-(x.node.endIndex-x.node.startIndex)||x.patternIndex-y.patternIndex;});
      const id=sorted.at(-1),text=source.slice(pos,positions[i+1]);
      if(segments.length&&segments.at(-1).id===id)segments.at(-1).text+=text;else segments.push({id,text});
    }
    const fragment=document.createDocumentFragment();
    for(const {id,text} of segments){
      if(id===undefined){fragment.append(text);continue;}
      const capture=captures[id];
      if(capture.name==='string.special'&&capture.node.type==='regex'){
        const {highlightGithubRegex}=await import('./github-highlighting.mjs');
        fragment.append(await highlightGithubRegex(text));continue;
      }
      const span=document.createElement('span');span.textContent=text;
      let role=capture.name==='type'&&capture.node.type==='identifier'?'--prettylights-syntax-variable':roles[capture.name]||'--fgColor-default';
      if(key==='css'&&capture.name==='property'&&capture.node.text.startsWith('--'))role='--fgColor-default';
      if(key==='c'&&capture.name==='label')role='--prettylights-syntax-constant';
      if(capture.name==='function'&&capture.node.type==='identifier'&&isBoundValue(capture.node))role='--fgColor-default';
      // The service recovers a standalone `override method()` as a call on
      // `override`; the pinned grammar inserts a missing optional-chain token.
      // Restrict this adjustment to that error node, never valid class methods.
      const member=capture.node.parent;
      if(key==='typescript'&&member?.type==='member_expression'&&member.parent?.type==='call_expression'
        &&member.childForFieldName('object')?.text==='override'
        &&member.namedChildren.some(n=>n.type==='optional_chain'&&n.hasError))
        role=capture.node.id===member.childForFieldName('object').id?'--prettylights-syntax-entity':'--fgColor-default';
      span.style.color=`var(${role})`;
      const legacyClass={'--prettylights-syntax-keyword':'hljs-keyword','--prettylights-syntax-string':'hljs-string','--prettylights-syntax-comment':'hljs-comment'}[role];
      if(legacyClass)span.className=legacyClass;fragment.append(span);
    }
    return fragment;
  } finally {tree.delete();}
}
