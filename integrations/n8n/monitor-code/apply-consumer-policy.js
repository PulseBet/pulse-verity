const v = $input.all();
if (v.length !== 1 || v[0].json.status !== 'VERIFIED' || v[0].json.verification?.recordValid !== true) throw new Error('UNVERIFIED');
const {symbol,policy,monitorKey,policyKey} = $('Validate monitor settings').first().json;
const p = v[0].json.signedPrint;
const now = Date.now();
const ageSeconds = (now - Date.parse(p.at)) / 1000;
let reason = 'POLICY_PASS';
if (!Number.isFinite(ageSeconds)) reason = 'TIMESTAMP_INVALID';
else if (ageSeconds < -policy.maxFutureSkewSeconds) reason = 'FUTURE_TIMESTAMP';
else if (ageSeconds > policy.maxAgeSeconds) reason = 'STALE';
else if (!policy.allowedGrades.includes(p.grade)) reason = 'GRADE_REJECTED';
else if (typeof p.confidence !== 'number' || !Number.isFinite(p.confidence) || p.confidence < 0 || p.confidence > 1
 || typeof p.dispersionBps !== 'number' || !Number.isFinite(p.dispersionBps) || p.dispersionBps < 0
 || !Number.isInteger(p.sources) || p.sources < 1) reason = 'QUALITY_MISSING';
else if (p.confidence < policy.minConfidence) reason = 'LOW_CONFIDENCE';
else if (p.dispersionBps > policy.maxDispersionBps) reason = 'WIDE_DISPERSION';
else if (p.sources < policy.minSources) reason = 'INSUFFICIENT_SOURCES';
const status = reason === 'POLICY_PASS' ? 'ACCEPTED' : 'REJECTED';
return [{json:{monitorKey,policyKey,symbol,observedAt:new Date(now).toISOString(),status,reason,recordValid:true,
 priceText:p.priceText ?? String(p.price),recordAt:p.at,grade:p.grade,ageSeconds:Number.isFinite(ageSeconds)?ageSeconds:null,
 evidenceJson:JSON.stringify({recordAt:p.at,grade:p.grade,confidence:p.confidence,dispersionBps:p.dispersionBps,sources:p.sources,verification:v[0].json.verification})},pairedItem:{item:0}}];
