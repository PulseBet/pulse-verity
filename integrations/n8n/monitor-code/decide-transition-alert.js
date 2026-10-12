const r = $('Prepare audit row').first().json;
const rows = $input.all().map(x => x.json).filter(x => Object.keys(x).length);
if (rows.length > 1) throw new Error('STATE_CONFLICT: duplicate monitor rows; resolve before continuing.');
const prior = rows[0];
if (prior && (prior.monitorKey !== r.monitorKey || !['ACCEPTED','REJECTED','UNAVAILABLE'].includes(prior.status) || typeof prior.reason !== 'string' || typeof prior.policyKey !== 'string')) throw new Error('STATE_INVALID');
// Repeated observations with the same status/reason/policy are quiet. The initial
// healthy observation establishes a baseline. Initial failures and recoveries alert.
const changed = !prior || prior.status !== r.status || prior.reason !== r.reason || prior.policyKey !== r.policyKey;
const notify = changed && (Boolean(prior) || r.status !== 'ACCEPTED');
const label = r.status === 'ACCEPTED' ? 'RECOVERED / POLICY PASS' : r.status;
const message = ['Pulse Verity Index monitor: '+r.symbol, label+' — '+r.reason,
 'Observed: '+r.observedAt, 'Previous state: '+(prior?.status ?? 'not established'),
 r.recordValid ? 'Full-record signature passed; consumer policy checked separately.' : 'No verified usable price. Do not substitute zero or a previous observation.',
 'Audit execution: '+r.executionId, 'An integrity check does not establish price correctness or settlement suitability.'].join('\n');
return [{json:{...r,notify,alertText:message},pairedItem:{item:0}}];
