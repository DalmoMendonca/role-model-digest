import test from 'node:test';import assert from 'node:assert/strict';
process.env.OPENAI_API_KEY='test-only';process.env.SERPER_API_KEY='test-only';process.env.SMTP_URL='smtp://test.invalid';process.env.ALLOW_WIKIDATA_LOOKUP='false';
const {parsePublisherFeed,parseOfficialSchedule,collectPrimarySources}=await import('../agents/primarySourcesAgent.js');
const {generateDigest}=await import('../agents/digestAgent.js');
const until=new Date('2026-11-16T14:00:00Z'),since=new Date('2026-07-27T00:00:00Z');
const response=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
const publication={title:'The politics conversation',url:'https://publisher.example/politics',snippet:'Jane Example and a colleague discuss nine perspectives on politics.',date:'2026-10-28',sourceType:'video',isOfficial:true,activityKind:'published'};

test('an author-specific feed recovers missed publications outside seven days without needing the name in the headline',()=>{
 const xml='<rss><channel><item><title>The politics conversation</title><link>https://publisher.example/politics</link><dc:creator><![CDATA[Jane Example]]></dc:creator><pubDate>Wed, 28 Oct 2026 21:42:22 +0000</pubDate><description><![CDATA[<p>Nine political perspectives.</p>]]></description><category><![CDATA[Video]]></category></item><item><title>Other author</title><link>https://publisher.example/other</link><dc:creator>Someone Else</dc:creator><pubDate>Wed, 28 Oct 2026 21:42:22 +0000</pubDate><description>Unrelated.</description></item></channel></rss>';
 const items=parsePublisherFeed(xml,{roleModelName:'Jane Example',since,until});
 assert.equal(items.length,1);assert.equal(items[0].date,'2026-10-28');assert.equal(items[0].sourceType,'video');assert.equal(items[0].isOfficial,true);
});

test('a public year/month/day schedule yields actual upcoming dates, not the past dates or the whole range',()=>{
 const text='Jane Example invites you to a live Q&A. Schedule: 11:00am - 12:30 pm (MT) 2026 Oct 11, 25 Nov 8, 22 Dec 13, 27 2027 Jan 10, 24';
 const items=parseOfficialSchedule(text,{roleModelName:'Jane Example',url:'https://example.com/schedule',until});
 assert.deepEqual(items.map(x=>x.date),['2026-11-22','2026-12-13']);assert.ok(items.every(x=>text.includes(x.evidenceQuote)));
});

test('a previously delivered source is not recycled just because every candidate is already known',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('should not request AI')});
 await assert.rejects(generateDigest({roleModelName:'Jane Example',weekStart:until,candidates:[publication],previousKeys:['url:https://publisher.example/politics']}),/Research incomplete/);
 assert.equal(calls,0);
});

test('the digest preserves author-feed metadata and clearly labels catch-up instead of inventing a fresh date',async t=>{
 t.mock.method(globalThis,'fetch',async()=>response({output_text:JSON.stringify({summaryText:'A useful catch-up',items:[{sourceUrl:publication.url,sourceTitle:'Invented title',sourceDate:'2026-11-16',summary:'Invented facts',sourceType:'news'}]})}));
 const d=await generateDigest({roleModelName:'Jane Example',weekStart:until,candidates:[publication],previousKeys:[]});
 assert.equal(d.items[0].sourceDate,'2026-10-28');assert.equal(d.items[0].sourceTitle,publication.title);assert.match(d.items[0].summary,/Catch-up \(published 2026-10-28\)/);assert.ok(d.items[0].summary.includes(publication.snippet));assert.ok(!d.items[0].summary.includes('Invented'));
});

test('current schedules are retained even when the editor returns no news items',async t=>{
 const event={...publication,title:'Upcoming Q&A',url:'https://example.com/schedule',date:'2026-11-22',sourceType:'web',activityKind:'upcoming'};
 t.mock.method(globalThis,'fetch',async()=>response({output_text:JSON.stringify({summaryText:'No news',items:[]})}));
 const d=await generateDigest({roleModelName:'Jane Example',weekStart:until,candidates:[event],previousKeys:[]});
 assert.equal(d.items.length,1);assert.equal(d.items[0].activityKind,'upcoming');assert.match(d.items[0].summary,/Upcoming 2026-11-22/);
});

test('unverifiable evidence quotes and invented links cannot become primary-source updates',async t=>{
 t.mock.method(globalThis,'fetch',async url=>String(url).includes('api.openai.com')?response({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({items:[{title:'Fake',url:'https://invented.example/',snippet:'Fake',date:'2026-11-22',sourceType:'web',activityKind:'upcoming',evidenceUrl:'https://example.com',evidenceQuote:'A sentence absent from the actual page'}]})}]}]}):new Response('<html><body>Jane Example writes essays.</body></html>'));
 const d=await collectPrimarySources({roleModelName:'Jane Example',sources:[{url:'https://example.com'}],since,until});
 assert.equal(d.successfulReads,1);assert.equal(d.items.length,0);
});


test('empty issues do not erase the undelivered backlog and same-week repairs preserve the prior boundary',async()=>{
 const {getCoverageStart}=await import('../utils/date.js');
 const start=getCoverageStart([{weekStart:'2026-07-27',items:[{}]},{weekStart:'2026-11-02',items:[]},{weekStart:'2026-11-09',items:[]},{weekStart:'2026-11-16',items:[{}]}],'2026-11-16',new Date('2026-11-16T14:00:00Z'));
 assert.equal(start.toISOString(),'2026-07-27T00:00:00.000Z');
});

test('a new subscription starts with recent work rather than a claim of a quiet week',async()=>{
 const {getCoverageStart}=await import('../utils/date.js');
 assert.equal(getCoverageStart([],'2026-11-16',new Date('2026-11-16T14:00:00Z')).toISOString(),'2026-10-17T14:00:00.000Z');
});


test('verified public social posts recover recent activity while rejecting another author and old pinned posts',async()=>{
 const {parsePublicXArchive}=await import('../agents/socialArchiveAgent.js');
 const post=(owner,id,body)=>`<div class="timeline-item" data-username="${owner}"><a class="tweet-link" href="/${owner}/status/${id}#m"></a><div class="tweet-content media-body">${body}</div></div>`;
 const html=post('jane','2122069685696901224','Jane published a substantive reflection about her latest work.')+post('other','2121691430376902713','An unrelated author whose post must not be attributed to Jane.')+post('jane','2021326138593742865','This pinned post is older than the reporting boundary.');
 const d=parsePublicXArchive(html,{handle:'jane',roleModelName:'Jane Example',since:new Date('2026-07-27'),until:new Date('2026-11-16T20:00:00Z')});
 assert.equal(d.length,1);assert.equal(d[0].date,'2026-11-15');assert.equal(d[0].url,'https://x.com/jane/status/2122069685696901224');
});

test('an entirely empty research result is a failure, never a successful quiet week',async t=>{
 const {collectSources}=await import('../agents/sourceAgent.js');
 t.mock.method(globalThis,'fetch',async url=>String(url).includes('news.google.com')?new Response('<rss><channel></channel></rss>'):String(url).includes('api.openai.com')?response({status:'completed',output:[{type:'web_search_call',status:'completed',action:{sources:[]}},{content:[{type:'output_text',text:'{"items":[]}'}]}]}):response({organic:[],news:[]}));
 await assert.rejects(collectSources({roleModelName:'Jane Example',weekStart:until}),/Research incomplete/);
});
