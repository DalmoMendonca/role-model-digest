import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SERPER_API_KEY = 'test-search';
process.env.OPENAI_API_KEY = 'test-ai';
process.env.SMTP_URL = 'smtp://test.invalid';
process.env.ALLOW_WIKIDATA_LOOKUP = 'false';
const { collectSources } = await import('../agents/sourceAgent.js');
const { collectWebSources } = await import('../agents/webSearchAgent.js');
const { collectNewsFeed } = await import('../agents/newsFeedAgent.js');
const { generateDigest } = await import('../agents/digestAgent.js');
const json = (body, status = 200) => new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json'}});
const today = new Date().toISOString().slice(0,10);
const since = new Date(Date.now()-7*86400000);
const item = {title:'Jane Example launches a project',url:'https://example.com/update',snippet:'Jane Example announced a new project.',date:today,sourceType:'news'};
const web = (items = [item]) => json({status:'completed',output:[{type:'web_search_call',status:'completed',action:{sources:[{url:item.url}]}},{type:'message',content:[{type:'output_text',text:JSON.stringify({items})}]}]});

test('one failed Serper query preserves the other three results', async t => {
 t.mock.method(globalThis,'fetch',async (url,options) => {
  if (String(url).includes('google.serper.dev')) {
   if (String(url).endsWith('/news')) return json({},503);
   const q=JSON.parse(options.body).q;
   if (q.includes('interview')) return json({organic:[item,{...item,url:'https://example.com/2'},{...item,url:'https://example.com/3'}].map(x=>({...x,link:x.url}))});
   return json({organic:[]});
  }
  throw new Error('Unexpected fallback');
 });
 const items = await collectSources({roleModelName:'Jane Example',weekStart:new Date()});
 assert.equal(items.length,3);
});

test('exhausted paid search recovers from the public news feed', async t => {
 t.mock.method(globalThis,'fetch',async url => {
  if(String(url).includes('google.serper.dev')) return json({},400);
  if(String(url).includes('news.google.com')) return new Response(`<rss><channel><item><title>Jane Example launches &amp; teaches</title><link>https://example.com/update</link><pubDate>${new Date().toUTCString()}</pubDate><description>New project</description></item></channel></rss>`);
  return web([]);
 });
 const items=await collectSources({roleModelName:'Jane Example',weekStart:new Date()});
 assert.equal(items.length,1); assert.equal(items[0].title,'Jane Example launches & teaches');
});

test('total discovery outage rejects before creating or emailing a digest', async t => {
 t.mock.method(globalThis,'fetch',async () => json({},503));
 await assert.rejects(collectSources({roleModelName:'Jane Example',weekStart:new Date()}),/refusing to publish or email/);
});

test('web search accepts only observed URLs with dates in the reporting window', async t => {
 t.mock.method(globalThis,'fetch',async(url)=>String(url).includes('api.openai.com')?web([item,{...item,url:'https://invented.example/'}]):new Response(`<meta property="article:published_time" content="${today}T12:00:00Z">`));
 const items=await collectWebSources({roleModelName:'Jane Example',since});
 assert.equal(items.length,1);assert.equal(items[0].url,item.url);
});

test('RSS rejects old and future stories and invalid feed responses', async t=>{
 const mock=t.mock.method(globalThis,'fetch',async()=>new Response(`<rss><channel><item><title>Old</title><link>https://example.com/old</link><pubDate>Mon, 01 Jan 2001 00:00:00 GMT</pubDate></item><item><title>Future</title><link>https://example.com/future</link><pubDate>Thu, 01 Jan 2099 00:00:00 GMT</pubDate></item></channel></rss>`));
 assert.deepEqual(await collectNewsFeed({roleModelName:'Jane Example',since}),[]);
 mock.mock.mockImplementation(async()=>new Response('<html>Error</html>'));
 await assert.rejects(collectNewsFeed({roleModelName:'Jane Example',since}),/Invalid news feed/);
});

test('digest editor cannot invent a source URL',async t=>{
 t.mock.method(globalThis,'fetch',async()=>json({output_text:JSON.stringify({summaryText:'Invented',items:[{sourceTitle:'Fake',sourceUrl:'https://invented.example/'}]})}));
 const digest=await generateDigest({roleModelName:'Jane Example',weekStart:new Date(),candidates:[item],previousKeys:[]});
 assert.equal(digest.items.length,1);assert.equal(digest.items[0].sourceUrl,item.url);
});


test('discovery outage cannot persist a false quiet-week digest', async t => {
 t.mock.method(globalThis,'fetch',async () => json({},503));
 const {generateWeeklyDigest}=await import('../digestService.js');
 let writes=0;
 const ref={where(){return this},doc(){return this},collection(){return this},async get(){return {docs:[]}},async set(){writes++}};
 const db={collection(){return ref}};
 await assert.rejects(generateWeeklyDigest(db,{user:{weeklyEmailOptIn:true},roleModel:{id:'test',name:'Jane Example'}}),/refusing to publish or email/);
 assert.equal(writes,0);
});


test('a refreshed digest waits for the normal scheduled delivery and clears pending only after success',async t=>{
 const nodemailer=(await import('nodemailer')).default;
 const {generateWeeklyDigest}=await import('../digestService.js');
 const {getWeekStart,toIsoDate}=await import('../utils/date.js');
 const record={id:'existing',roleModelId:'test',weekStart:toIsoDate(getWeekStart(new Date())),emailPending:true,items:[{sourceTitle:item.title,sourceUrl:item.url,summary:item.snippet}],summaryText:'Real update'};
 let sent=0;
 t.mock.method(nodemailer,'createTransport',()=>({sendMail:async()=>{sent++;return {messageId:'test'}}}));
 const ref={where(){return this},doc(){return this},async get(){return {docs:[{id:'existing',data:()=>record}]}},async update(value){Object.assign(record,value)}};
 const db={collection(){return ref}};
 await generateWeeklyDigest(db,{user:{weeklyEmailOptIn:true,email:'test@example.invalid'},roleModel:{id:'test',name:'Jane Example'}});
 assert.equal(sent,1);assert.equal(record.emailPending,false);assert.ok(record.emailSentAt);
 await generateWeeklyDigest(db,{user:{weeklyEmailOptIn:true,email:'test@example.invalid'},roleModel:{id:'test',name:'Jane Example'}});
 assert.equal(sent,1);
});

test('failed email remains pending for the scheduler retry',async t=>{
 const nodemailer=(await import('nodemailer')).default;
 const {generateWeeklyDigest}=await import('../digestService.js');
 const {getWeekStart,toIsoDate}=await import('../utils/date.js');
 const record={id:'existing',weekStart:toIsoDate(getWeekStart(new Date())),emailPending:true,items:[{sourceTitle:item.title,sourceUrl:item.url}]};
 t.mock.method(nodemailer,'createTransport',()=>({sendMail:async()=>{throw new Error('SMTP unavailable')}}));
 const ref={where(){return this},doc(){return this},async get(){return {docs:[{id:'existing',data:()=>record}]}},async update(){assert.fail('must not mark failed mail as sent')}};
 await assert.rejects(generateWeeklyDigest({collection(){return ref}},{user:{weeklyEmailOptIn:true,email:'test@example.invalid'},roleModel:{id:'test',name:'Jane Example'}}),/SMTP unavailable/);
 assert.equal(record.emailPending,true);
});
