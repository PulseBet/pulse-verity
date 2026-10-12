// Deliberately discard raw provider errors, headers, bodies and credentials.
const c = $('Validate monitor settings').first().json;
return [{json:{monitorKey:c.monitorKey,policyKey:c.policyKey,symbol:c.symbol,observedAt:new Date().toISOString(),
 status:'UNAVAILABLE',reason:'READ_OR_VERIFICATION_FAILED',recordValid:false,priceText:'',recordAt:'',grade:'',ageSeconds:null,
 evidenceJson:JSON.stringify({recordValid:false,detail:'No usable fully verified record; inspect the failed stage in a controlled manual test.'})},pairedItem:{item:0}}];
