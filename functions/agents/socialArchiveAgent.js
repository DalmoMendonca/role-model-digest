import { cleanText } from './primarySourcesAgent.js';

export function parsePublicXArchive(html, { handle, roleModelName, since, until = new Date(), archiveOrigin = 'https://teapawt.net' }) {
 const items=[];
 const blocks=html.split(/(?=<div\b[^>]*class="[^"]*timeline-item\b)/i);
 for(const block of blocks){
  const owner=(block.match(/data-username="([^"]+)"/)||[])[1];
  if(owner?.toLowerCase()!==handle.toLowerCase())continue;
  const path=(block.match(/class="tweet-link"[^>]*href="([^"]+)"/)||[])[1];
  const match=path?.match(/^\/([^/]+)\/status\/(\d+)/);
  if(!match||match[1].toLowerCase()!==handle.toLowerCase())continue;
  const date=new Date(Number((BigInt(match[2])>>22n)+1288834974657n));
  if(!Number.isFinite(date.getTime())||date<since||date>until)continue;
  const content=cleanText((block.match(/<div\b[^>]*class="[^"]*tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i)||[])[1]||'');
  if(content.length<40||/^\*/.test(content))continue;
  const url=`https://x.com/${handle}/status/${match[2]}`;
  items.push({title:`${roleModelName}: ${content.slice(0,110)}${content.length>110?'...':''}`,url,snippet:content,date:date.toISOString().slice(0,10),sourceType:'social',isOfficial:true,activityKind:'published',discoveryProvider:'public-social-archive',evidenceUrl:`${archiveOrigin}/${handle}/status/${match[2]}`,evidenceQuote:content});
 }
 return [...new Map(items.map((item)=>[item.url,item])).values()].slice(0,12);
}

export async function collectPublicXArchive({ handle, roleModelName, since, until = new Date() }) {
 if(!/^[A-Za-z0-9_]{1,15}$/.test(handle||''))return [];
 const r=await fetch(`https://teapawt.net/${encodeURIComponent(handle)}`,{signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw new Error(`Public social archive HTTP ${r.status}`);
 const html=await r.text();
 if(!html.includes(`https://x.com/${handle}`))throw new Error('Archive identity did not match the official account');
 return parsePublicXArchive(html,{handle,roleModelName,since,until});
}
