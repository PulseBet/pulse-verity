const items = $input.all();
if (items.length !== 1) throw new Error('AUDIT_INVALID');
const r = items[0].json;
if (!['ACCEPTED','REJECTED','UNAVAILABLE'].includes(r.status) || typeof r.recordValid !== 'boolean') throw new Error('AUDIT_INVALID');
return [{json:{...r,executionId:String($execution.id)},pairedItem:{item:0}}];
