import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';

// Explicitly enabled comparison exception: reverse only GitHub's server-side
// issue/PR enrichment. Authored Markdown links and ordinary text stay intact.
export async function restoreAuthoredIssueReferences(page, selector, markdown, sourceUrl) {
  const url=new URL(sourceUrl),[owner,repo]=url.pathname.split('/').filter(Boolean);
  if(url.hostname!=='github.com')throw Error('GitHub issue context requires a GitHub source');
  const references=[];
  const tree=unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter,['yaml']).parse(markdown);
  function walk(node){
    if(['link','linkReference','image','imageReference','code','inlineCode'].includes(node.type))return;
    if(node.type==='text')for(const match of node.value.matchAll(/(?<![\w/])(?:[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?)?#\d+\b/g)){
      const [prefix,number]=match[0].split('#'),repository=!prefix?`${owner}/${repo}`:prefix.includes('/')?prefix:`${owner}/${prefix}`;
      references.push({key:`${repository}#${number}`.toLowerCase(),text:match[0]});
    }
    for(const child of node.children||[])walk(child);
  }
  walk(tree);
  return page.locator(selector).evaluate((root,references)=>{
    const queues=new Map();
    for(const reference of references){if(!queues.has(reference.key))queues.set(reference.key,[]);queues.get(reference.key).push(reference.text);}
    const changes=[],parents=new Set();
    for(const link of root.querySelectorAll('a.issue-link.js-issue-link')){
      const url=new URL(link.href),match=url.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)$/);
      if(url.hostname!=='github.com'||!match)throw Error('Unverified service issue reference');
      const key=`${match[1]}/${match[2]}#${match[3]}`.toLowerCase(),text=queues.get(key)?.shift();
      if(!text)throw Error('Cannot reconstruct authored service issue reference: '+key);
      changes.push({kind:'github-server-issue-reference',href:link.href,before:link.textContent,after:text,serviceHtml:link.outerHTML});
      parents.add(link.parentNode);link.replaceWith(document.createTextNode(text));
    }
    for(const parent of parents)parent.normalize();
    return changes;
  },references);
}
