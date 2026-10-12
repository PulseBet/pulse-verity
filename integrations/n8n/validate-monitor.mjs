// Executes the exported graph and exact Code/expressions with synthetic MCP,
// in-memory Data Tables and a Slack stub. Not an n8n runtime/UI test.
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';
import { verify } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
const workflow=JSON.parse(readFileSync(new URL('./pulse-verity-quality-monitor.json',import.meta.url)));
const fixture=JSON.parse(readFileSync(new URL('../../fixtures/verity-agent-print.json',import.meta.url)));
const copy=x=>JSON.parse(JSON.stringify(x));
const nodes=new Map(workflow.nodes.map(n=>[n.name,n]));
const mcp='@n8n/n8n-nodes-langchain.mcpClient';
const verified = p => {
 const bytes=['pulse-index-v1',p.symbol,p.priceText??String(p.price),p.at,p.grade].join('\n');
 const check=(b,s)=>verify('sha256',Buffer.from(b),{key:fixture.publicKeyPem,dsaEncoding:'ieee-p1363'},Buffer.from(s,'base64'));
 const valid=p.kid===fixture.print.kid && check(bytes,p.signature);
 if (!p.v2) return {valid,recordValid:false};
 const signedFields=Object.fromEntries(p.v2.canonical.split('\n').slice(1).map(s=>{const i=s.indexOf('=');return [s.slice(0,i),JSON.parse(s.slice(i+1))];}));
 const mismatches=Object.entries(signedFields).filter(([k,v])=>k.split('.').reduce((o,k)=>o?.[k],p)!==v).map(([k])=>k);
 const signatureValid=p.v2.kid===fixture.print.v2.kid && check(p.v2.canonical,p.v2.signature);
 const full=valid && signatureValid && !mismatches.length;
 return {valid,recordValid:full,metadataSigned:full,verificationScope:full?'full-record':'invalid',checked:bytes,verifiedWithKid:p.kid,
 v2:{valid:signatureValid&&!mismatches.length,signatureValid,fieldsMatch:!mismatches.length,mismatches,signedFields,verifiedWithKid:p.v2.kid}};
};
const baselineConfig = Object.fromEntries(nodes.get('Monitor settings').parameters.assignments.assignments.map(a=>[a.name,a.value]));
// Policy deliberately relaxed for this public synthetic fixture, not production recommendations.
const fixtureConfig = {...baselineConfig,allowedGrades:fixture.print.grade,minConfidence:0,maxDispersionBps:10000,minSources:1};
const t=Date.parse(fixture.print.at)+1000;
function run(opts={}) {
 const state=opts.state??[]; const audits=[];const alerts=[];const calls=[];const visited=[];const results=new Map();
 const transportErrors=opts.transportErrors??[];
 let input=[{json:{}}], current=opts.trigger??'Run manually';
 const evalExpr=(s,ctx)=>typeof s==='string'&&s.startsWith('={{')?copy(new Script('('+s.slice(3,-2).trim()+')').runInContext(ctx,{timeout:500})):s;
 let stopped;
 try {
 for(let step=0; current && step<40;step++) {
  const n=nodes.get(current);assert.ok(n);visited.push(current);let output=0;
  const now=opts.now??t;
  class Clock extends Date {constructor(...a){super(...(a.length?a:[now]));} static now(){return now;}}
  const ctx=createContext({$input:{all:()=>copy(input)},$json:copy(input[0]?.json),$:name=>({first:()=>copy(results.get(name)?.[0])}),$workflow:{id:'synthetic-monitor'},$execution:{id:'synthetic-execution'},Date:Clock});
  try {
   if(opts.failAt===current) throw new Error('Synthetic dependency failure');
   if(n.type.endsWith('.set')) input=[{json:{...fixtureConfig,...opts.config}}];
   else if(n.type.endsWith('.code')) {
    if(opts.policyPrint && current==='Apply consumer policy') {
     // Test the consumer policy in isolation from signature tests. Never claim these modified fixture bytes were signed.
     input[0].json.signedPrint={...input[0].json.signedPrint,...opts.policyPrint};
     ctx.$input={all:()=>copy(input)};
    }
    input=copy(new Script('(function(){'+n.parameters.jsCode+'\n})()').runInContext(ctx,{timeout:500}));
   } else if(n.type===mcp) {
    const args=evalExpr(n.parameters.jsonInput,ctx);const tool=n.parameters.tool.value;calls.push({tool,args});
    if(transportErrors.includes(tool)) throw new Error('Synthetic transport error secret-token SHOULD_NOT_LEAK');
    const response=tool==='get_index_price'?copy(opts.print??fixture.print):verified(args);
    if(tool==='verify_print') assert.deepEqual(args,opts.print??fixture.print);
    let body=tool==='verify_print' && opts.verification?opts.verification(response):response;
    input=[{json:opts.format==='text'?{content:[{type:'text',text:JSON.stringify(body)}]}:{structuredContent:body}}];
   } else if(n.type.endsWith('.dataTable')) {
    const p=n.parameters;
    if(p.operation==='insert') {
     const row=Object.fromEntries(Object.entries(p.columns.value).map(([k,v])=>[k,evalExpr(v,ctx)]));audits.push(row);input=[{json:{id:audits.length,...row}}];
    } else if(p.operation==='get') {
     const key=evalExpr(p.filters.conditions[0].keyValue,ctx);
     const rows=state.filter(r=>r.monitorKey===key).slice(0,p.limit);input=rows.length?rows.map(json=>({json:copy(json)})):[{json:{}}];
    } else if(p.operation==='upsert') {
     const row=Object.fromEntries(Object.entries(p.columns.value).map(([k,v])=>[k,evalExpr(v,ctx)]));
     const key=evalExpr(p.filters.conditions[0].keyValue,ctx);assert.equal(key,row.monitorKey);
     const i=state.findIndex(r=>r.monitorKey===key);if(i<0)state.push(row);else state[i]=row;input=[{json:copy(row)}];
    }
   } else if(n.type.endsWith('.if')) output=evalExpr(n.parameters.conditions.conditions[0].leftValue,ctx)===true?0:1;
   else if(n.type.endsWith('.slack')) {alerts.push(evalExpr(n.parameters.text,ctx));input=[{json:{ok:true,ts:'synthetic'}}];}
  } catch(e) {if(n.onError!=='continueErrorOutput')throw e; output=1;input=[{json:{error:e.message}}];}
  results.set(current,copy(input));current=workflow.connections[current]?.main?.[output]?.[0]?.node;
 }
 assert.equal(current,undefined,'graph must terminate');
 } catch(e) {stopped=e.message;}
 return {audits,alerts,calls,state,visited,stopped};
}

test('export is inactive, bounded, credential-free and graph references resolve',()=>{
 assert.equal(workflow.active,false);assert.deepEqual(workflow.pinData,{});assert.equal(workflow.settings.executionTimeout,120);
 assert.equal(workflow.settings.saveDataErrorExecution,'none');assert.equal(workflow.settings.saveDataSuccessExecution,'none');assert.equal(workflow.settings.saveManualExecutions,false);
 assert.equal(nodes.size,workflow.nodes.length);
 for(const n of workflow.nodes){assert.ok(!n.credentials && !n.retryOnFail && !n.continueOnFail && !n.disabled);
  for(const branch of workflow.connections[n.name]?.main??[])for(const edge of branch)assert.ok(nodes.has(edge.node));
  if(n.type.endsWith('.code'))assert.doesNotMatch(n.parameters.jsCode,/\$env|require\(|process\.|fetch\(|eval\(/);
  if(n.type===mcp){assert.equal(n.parameters.endpointUrl,'https://mcp.thepulse.markets/api/index/mcp');assert.equal(n.parameters.options.timeout,20000);assert.equal(n.parameters.authentication,'bearerAuth');assert.equal(n.onError,'continueErrorOutput');}
 }
 assert.equal(nodes.get('Read previous state').parameters.limit,2);
 assert.equal(nodes.get('Read previous state').alwaysOutputData,true);
 assert.equal(nodes.get('Notify operations').parameters.channelId.value,'');
 assert.equal(nodes.get('Notify operations').onError,'stopWorkflow');
 assert.equal(nodes.get('Append decision audit').onError,'stopWorkflow');
 assert.equal(nodes.get('Every ten minutes').parameters.rule.interval[0].minutesInterval,10);
});
test('readable source files match exported new Code nodes',()=>{
 for(const n of workflow.nodes.filter(n=>n.type.endsWith('.code')&&!['Preserve signed print','Require verified record'].includes(n.name)))
 assert.equal(readFileSync(new URL('./monitor-code/'+n.id+'.js',import.meta.url),'utf8').trimEnd(),n.parameters.jsCode.trimEnd());
});
for(const format of ['structured','text'])test('healthy signed fixture creates quiet baseline: '+format,()=>{
 const r=run({format});assert.equal(r.stopped,undefined);assert.equal(r.audits[0].status,'ACCEPTED');assert.equal(r.audits[0].recordValid,true);assert.equal(r.alerts.length,0);assert.equal(r.state.length,1);assert.equal(r.calls.length,2);
});
test('scheduled and manual triggers share the same path',()=>assert.deepEqual(run({trigger:'Every ten minutes'}).audits,run().audits));
for(const [config,label] of [[{symbol:'BTC/USD'},'symbol'],[{maxAgeSeconds:0},'age'],[{minConfidence:'0.5'},'string number'],[{minSources:1.5},'fractional count'],[{allowedGrades:'unknown'},'grade'],[{allowedGrades:'blended,blended'},'duplicate grade']]) test('invalid '+label+' stops before network',()=>{const r=run({config});assert.match(r.stopped,/CONFIG_INVALID/);assert.equal(r.calls.length,0);assert.equal(r.audits.length,0);});
for(const [label,changes] of [ ['STALE',{now:t+121000}],['FUTURE_TIMESTAMP',{now:t-10000}],['GRADE_REJECTED',{config:{allowedGrades:'single-source'}}],['LOW_CONFIDENCE',{config:{minConfidence:1},policyPrint:{confidence:0.3}}],['WIDE_DISPERSION',{config:{maxDispersionBps:1},policyPrint:{dispersionBps:2}}],['INSUFFICIENT_SOURCES',{config:{minSources:2},policyPrint:{sources:1}}],['QUALITY_MISSING',{policyPrint:{confidence:null}}] ]) test('policy rejects '+label+' while preserving signature distinction',()=>{
 const r=run(changes);assert.equal(r.stopped,undefined);assert.equal(r.audits[0].status,'REJECTED');assert.equal(r.audits[0].reason,label);assert.equal(r.audits[0].recordValid,true);assert.equal(r.alerts.length,1);
});
for(const tool of ['get_index_price','verify_print'])test('transport failures are sanitized and never retried: '+tool,()=>{
 const r=run({transportErrors:[tool]});assert.equal(r.audits[0].status,'UNAVAILABLE');assert.equal(r.audits[0].priceText,'');assert.equal(r.audits[0].recordValid,false);assert.equal(r.alerts.length,1);assert.doesNotMatch(JSON.stringify([r.audits,r.alerts,r.state]),/SHOULD_NOT_LEAK|secret-token/);assert.equal(r.calls.filter(c=>c.tool===tool).length,1);
});
for(const [label,change] of [['price',p=>p.price++],['signature',p=>p.signature='A'.repeat(86)+'=='],['metadata',p=>p.confidence=0.01],['wrong symbol',p=>p.symbol='ETH'],['v2 missing',p=>delete p.v2]])test('tampered '+label+' cannot pass policy',()=>{
 const p=copy(fixture.print);change(p);const r=run({print:p});assert.equal(r.audits[0].status,'UNAVAILABLE');assert.ok(!r.visited.includes('Apply consumer policy'));
});
for(const [label,change] of [['string boolean',r=>({...r,recordValid:'true'})],['partial scope',r=>({...r,verificationScope:'price-only'})],['wrong kid',r=>({...r,v2:{...r.v2,verifiedWithKid:'different'}})],['missing fields',r=>({...r,v2:{...r.v2,signedFields:{}}})]])test('verification '+label+' fails closed',()=>{
 const r=run({verification:change});assert.equal(r.audits[0].status,'UNAVAILABLE');assert.ok(!r.visited.includes('Apply consumer policy'));
});
test('persistent state suppresses unchanged failures and alerts on recovery',()=>{
 const a=run({transportErrors:['get_index_price']});assert.equal(a.alerts.length,1);
 const b=run({transportErrors:['get_index_price'],state:a.state});assert.equal(b.alerts.length,0);assert.equal(b.audits.length,1);
 const c=run({state:b.state});assert.equal(c.alerts.length,1);assert.match(c.alerts[0],/RECOVERED/);
 const d=run({state:c.state});assert.equal(d.alerts.length,0);
});
test('changing failure reason or policy produces a notification',()=>{
 const a=run({now:t+121000});const b=run({now:t-10000,state:a.state});assert.equal(b.alerts.length,1);
 const c=run({state:b.state});const d=run({state:c.state,config:{maxAgeSeconds:121}});assert.equal(d.alerts.length,1);
});
test('duplicate state cannot silently select a row',()=>{
 const a=run();const r=run({state:[...a.state,...copy(a.state)]});assert.match(r.stopped,/STATE_CONFLICT/);assert.equal(r.alerts.length,0);
});
test('audit failure stops before notification or state write',()=>{
 const r=run({failAt:'Append decision audit',transportErrors:['get_index_price']});assert.ok(r.stopped);assert.equal(r.alerts.length,0);assert.equal(r.state.length,0);
});
test('Slack failure preserves previous state and existing audit',()=>{
 const a=run();const old=copy(a.state);const r=run({state:a.state,transportErrors:['get_index_price'],failAt:'Notify operations'});assert.ok(r.stopped);assert.deepEqual(r.state,old);assert.equal(r.audits.length,1);
});
test('state-write failure after Slack exposes duplicate-risk instead of claiming delivery atomicity',()=>{
 const r=run({transportErrors:['get_index_price'],failAt:'Save monitor state'});assert.ok(r.stopped);assert.equal(r.alerts.length,1);assert.equal(r.state.length,0);
});
test('bounded metadata timestamp policy checks future and exact age boundary',()=>{
 assert.equal(run({now:Date.parse(fixture.print.at)+120000}).audits[0].status,'ACCEPTED');
 assert.equal(run({now:Date.parse(fixture.print.at)+120001}).audits[0].reason,'STALE');
});
