import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import http from 'node:http';
const question = '12와 18의 최대공약수를 어떻게 구해요?';
const body = {provider:'gemini',model:'gemini-3.8-flash',grade:'초5~6',subject:'수학',problem:question,messages:[{role:'user',content:question}]};
async function boot(t, scenario='quota-first', cooldown='500') {
  const temporary=http.createServer();await new Promise(r=>temporary.listen(0,'127.0.0.1',r));
  const port=temporary.address().port;await new Promise(r=>temporary.close(r));
  const server=spawn(process.execPath,['--import','./mock-gemini-switch.mjs','server.mjs'],{cwd:new URL('.',import.meta.url),
    env:{...process.env,HOST:'127.0.0.1',PORT:String(port),NODE_ENV:'test',APP_ACCESS_PIN:'',
      FREELLMAPI_FALLBACK:'0',GEMINI_API_KEY:'fake-key',GEMINI_TEST_CASE:scenario,
      GEMINI_TEST_COOLDOWN_MS:cooldown},
    stdio:['ignore','pipe','pipe']});
  const logs=[];for(const stream of [server.stdout,server.stderr])stream.on('data',c=>logs.push(String(c)));
  t.after(()=>server.kill());
  const base=`http://127.0.0.1:${port}`;
  for(let i=0;i<60;i++) {try {const r=await fetch(base+'/api/health');if(r.ok) return base;}catch {}await sleep(50);}
  throw new Error('mock did not start: '+logs.join(''));
}
async function ask(base) {const response=await fetch(base+'/api/tutor',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};}
test('3.5 quota 429 switches to 3.6, remains there during cooldown, then re-tests 3.5',async t=>{
  const base=await boot(t,'quota-first','160');
  const one=await ask(base);assert.equal(one.status,200,JSON.stringify(one.data));
  assert.equal(one.data.model,'gemini-3.5-flash-lite');
  assert.deepEqual(one.data.geminiRoute.models,['gemini-3.1-flash-lite','gemini-3.5-flash-lite','gemini-3.8-flash']);
  assert.equal(one.data.geminiRoute.fallbackActive,true);
  const two=await ask(base);assert.equal(two.status,200,JSON.stringify(two.data));
  assert.equal(two.data.model,'gemini-3.5-flash-lite');
  await sleep(200);
  const three=await ask(base);assert.equal(three.status,200,JSON.stringify(three.data));
  assert.equal(three.data.model,'gemini-3.1-flash-lite');
  assert.equal(three.data.geminiRoute.fallbackActive,false);
});
test('when primary works, only primary is used', async t=>{
  const base=await boot(t,'all-ok');const result=await ask(base);
  assert.equal(result.status,200,JSON.stringify(result.data));
  assert.equal(result.data.model,'gemini-3.1-flash-lite');
});
test('invalid key 401 is not sent to backup and is not auto retried', async t=>{
  const base=await boot(t,'auth');const r=await ask(base);
  assert.equal(r.status,401);assert.equal(r.data.retryable,false);
  const info=await (await fetch(base+'/api/provider-config')).json();
  assert.equal(info.geminiRoute.fallbackActive,false);
});
test('503 congestion still goes through normal reconnect, not quota rotation',async t=>{
  const base=await boot(t,'overload');const r=await ask(base);
  assert.equal(r.status,503);assert.equal(r.data.retryable,true);
  const info=await (await fetch(base+'/api/provider-config')).json();
  assert.equal(info.geminiRoute.fallbackActive,false);
});
test('all three models at quota return error, without endless retries',async t=>{
  const base=await boot(t,'all-quota');const r=await ask(base);
  assert.equal(r.status,429);assert.equal(r.data.retryable,false);
});

test('when first and second models reach 429, switch to 3.8', async t=>{
  const base=await boot(t,'two-quota');
  const r=await ask(base);
  assert.equal(r.status,200,JSON.stringify(r.data));
  assert.equal(r.data.model,'gemini-3.8-flash');
  assert.equal(r.data.geminiRoute.current,'gemini-3.8-flash');
  assert.equal(r.data.geminiRoute.paused.length,2);
});
test('removed Gemini TTS endpoint cannot be called',async t=>{
  const base=await boot(t,'all-ok');
  const r=await fetch(base+'/api/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.equal(r.status,405);
});
