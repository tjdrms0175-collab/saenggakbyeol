import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {setTimeout as wait} from 'node:timers/promises';
import {readFile} from 'node:fs/promises';

const problem = '12와 18의 최대공약수를 어떻게 구하나요?';
const input = {provider:'gemini',grade:'초5~6',subject:'수학',problem,
  problemId:'budget-test-problem-123',messages:[{role:'user',content:problem}]};
async function boot(t, vars={}) {
  const temp=http.createServer();
  await new Promise(r=>temp.listen(0,'127.0.0.1',r));
  const port=temp.address().port;
  await new Promise(r=>temp.close(r));
  const proc=spawn(process.execPath,['--import','./mock-gemini-switch.mjs','server.mjs'],{
    cwd:new URL('.',import.meta.url),
    env:{...process.env,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'test',
      GEMINI_API_KEY:'fake-key',GEMINI_USAGE_LOG:'0',FREELLMAPI_FALLBACK:'0',
      GEMINI_TEST_CASE:'all-ok',AI_GLOBAL_DAILY_LIMIT:'1000',AI_CLIENT_HOURLY_LIMIT:'1000',...vars},
    stdio:['ignore','pipe','pipe']
  });
  const logs=[];
  proc.stdout.on('data',b=>logs.push(String(b)));
  proc.stderr.on('data',b=>logs.push(String(b)));
  t.after(()=>proc.kill());
  const base=`http://127.0.0.1:${port}`;
  for(let i=0;i<75;i++) {
    try {if((await fetch(base+'/api/health')).ok)return base;}catch{}
    await wait(50);
  }
  throw Error('Server could not start '+logs.join(''));
}
async function ask(base,id='budget-request-id-12345') {
  const r=await fetch(base+'/api/tutor',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...input,retryRequestId:id})});
  return {status:r.status,data:await r.json()};
}

test('v37: already-completed request ID is not charged another client quota slot',async t=>{
  const base=await boot(t,{AI_CLIENT_HOURLY_LIMIT:'1',GEMINI_DAILY_CALL_LIMIT:'2'});
  const first=await ask(base,'completed-request-12345');
  assert.equal(first.status,200,JSON.stringify(first.data));
  const repeated=await ask(base,'completed-request-12345');
  assert.equal(repeated.status,200,JSON.stringify(repeated.data));
  assert.equal(repeated.data.hintCount,first.data.hintCount);
  const newCall=await ask(base,'next-request-12345678');
  assert.equal(newCall.status,429);
  assert.equal(newCall.data.code,'PUBLIC_USAGE_LIMIT');
  assert.equal(newCall.data.retryable,false);
});

test('v37: outgoing Gemini daily limit stops the next model stage, not retryable',async t=>{
  const base=await boot(t,{GEMINI_DAILY_CALL_LIMIT:'1'});
  const result=await ask(base,'daily-limit-request-123');
  assert.equal(result.status,429,JSON.stringify(result.data));
  assert.equal(result.data.code,'APP_BUDGET_LIMIT');
  assert.equal(result.data.retryable,false);
  const info=await (await fetch(base+'/api/provider-config')).json();
  assert.equal(info.geminiRoute.current,'gemini-3.1-flash-lite','must not mistake local limit for Google quota');
});

test('v37: maximum per-operation upstream attempts covers model fallbacks',async t=>{
  const base=await boot(t,{GEMINI_MAX_CALLS_PER_OPERATION:'2',GEMINI_TEST_CASE:'all-quota'});
  const result=await ask(base,'max-attempt-request-123');
  assert.equal(result.status,429);
  assert.equal(result.data.code,'APP_BUDGET_LIMIT');
  const info=await (await fetch(base+'/api/provider-config')).json();
  assert.equal(info.geminiRoute.paused.length,2,'third model should not be contacted');
});

test('v37: browser retry is strictly capped and quota 429 is not auto retried',async()=>{
  const script=await readFile(new URL('./app.js',import.meta.url),'utf8');
  assert.match(script,/const MAX_AUTO_RETRIES = 2;/);
  assert.match(script,/if \(failure\.status === 429\) throw failure;/);
  assert.match(script,/if \(retries >= MAX_AUTO_RETRIES\)/);
});
