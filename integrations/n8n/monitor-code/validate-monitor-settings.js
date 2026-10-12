const items = $input.all();
if (items.length !== 1) throw new Error('CONFIG_INVALID: run one monitor at a time.');
const c = items[0].json;
if (typeof c.symbol !== 'string' || !/^[A-Z0-9]{1,20}$/.test(c.symbol)) throw new Error('CONFIG_INVALID: symbol.');
const ranges = {maxAgeSeconds:[1,3600],maxFutureSkewSeconds:[0,60],minConfidence:[0,1],maxDispersionBps:[0,10000],minSources:[1,1000]};
for (const [key,[min,max]] of Object.entries(ranges)) {
 if (typeof c[key] !== 'number' || !Number.isFinite(c[key]) || c[key] < min || c[key] > max) throw new Error('CONFIG_INVALID: policy number.');
}
if (!Number.isInteger(c.minSources)) throw new Error('CONFIG_INVALID: minSources.');
const grades = typeof c.allowedGrades === 'string' ? c.allowedGrades.split(',').map(x => x.trim()) : [];
if (!grades.length || new Set(grades).size !== grades.length || grades.some(x => !['consensus','blended','composite','single-source','indicative'].includes(x))) throw new Error('CONFIG_INVALID: allowedGrades.');
const policy = Object.fromEntries(Object.keys(ranges).map(k => [k,c[k]]));
policy.allowedGrades = grades.sort();
const monitorKey = String($workflow.id) + ':' + c.symbol;
return [{json:{symbol:c.symbol, policy, monitorKey, policyKey:JSON.stringify(policy)},pairedItem:{item:0}}];
