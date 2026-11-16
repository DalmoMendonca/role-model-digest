import test from 'node:test';import assert from 'node:assert/strict';
process.env.SERPER_API_KEY='test-search';process.env.OPENAI_API_KEY='test-ai';process.env.ALLOW_WIKIDATA_LOOKUP='true';
const {validateRoleModel}=await import('../agents/roleModelValidator.js');
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const human={P31:[{mainsnak:{datavalue:{value:{id:'Q5'}}}}]};
function wikiMock(name,claims){return async url=>{if(String(url).includes('wbsearchentities'))return json({search:[{id:'Q1',label:name}]});if(String(url).includes('EntityData'))return json({entities:{Q1:{claims}}});throw new Error('Paid search must not be needed');};}

test('a verified living person can be selected without paid search availability',async t=>{
 t.mock.method(globalThis,'fetch',wikiMock('Jane Example',human));
 const result=await validateRoleModel({name:'Jane Example'});assert.equal(result.ok,true);assert.equal(result.signals.verifiedBy,'wikidata-human');
});
test('known deceased people remain ineligible when paid search is down',async t=>{
 t.mock.method(globalThis,'fetch',wikiMock('Jane Example',{...human,P570:[{mainsnak:{datavalue:{value:{time:'+2000-01-01T00:00:00Z'}}}}]}));
 assert.equal((await validateRoleModel({name:'Jane Example'})).ok,false);
});
test('organizations cannot pass the independent human identity check',async t=>{
 t.mock.method(globalThis,'fetch',wikiMock('Example Company',{P31:[{mainsnak:{datavalue:{value:{id:'Q783794'}}}}]}));
 const result=await validateRoleModel({name:'Example Company'});assert.equal(result.ok,false);assert.match(result.reason,/living person/);
});
test('a person without a Wikidata entry can be verified from public primary evidence despite exhausted search credits',async t=>{
 const quote='Jane Example is a writer and public speaker who publishes weekly essays.';
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  if(String(url).includes('wbsearchentities'))return json({search:[]});
  if(String(url).includes('google.serper.dev'))return json({message:'Not enough credits'},400);
  if(String(url)==='https://person.example')return new Response(`<html>${quote}</html>`);
  const body=JSON.parse(options.body);
  const value=body.tools?{status:'completed',output:[{type:'web_search_call',status:'completed',action:{sources:[{url:'https://person.example'}]}},{content:[{type:'output_text',text:quote}]}]}:{status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(body.text.format.name==='person_identity'?{isPerson:true,isLiving:true,hasPublicPresence:true,evidenceUrl:'https://person.example',evidenceQuote:quote}:{sources:[{url:'https://person.example',label:'Jane Example',kind:'website',reason:quote}]})}]}]};
  return json(value);
 });
 const result=await validateRoleModel({name:'Jane Example'});assert.equal(result.ok,true);assert.equal(result.signals.verifiedBy,'public-primary-sources');
});
test('a complete verification outage does not silently accept an unverified person',async t=>{
 t.mock.method(globalThis,'fetch',async url=>String(url).includes('wbsearchentities')?json({search:[]}):json({},503));
 await assert.rejects(validateRoleModel({name:'Jane Example'}));
});
