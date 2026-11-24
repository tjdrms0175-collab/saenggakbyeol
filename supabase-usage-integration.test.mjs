import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {setTimeout as wait} from 'node:timers/promises';
const payload={provider:'gemini',grade:'초5~6',subject:'수학',problem:'12와 18의 최대공약수를 어떻게 구하나요?',messages:[{role:'user',content:'12와 18의 최대공약수를 어떻게 구하나요?'}]};
async function boot(t,mode=''){
  const tmp=http.createServer();await new Promise(r=>tmp.listen(0,'127.0.0.1',r));
  const port=tmp.address().port;await new Promise(r=>tmp.close(r));
  const proc=spawn(process.execPath,['--import','./mock-supabase-usage.mjs','--import','./mock-gemini-switch.mjs','server.mjs'],{
    cwd:new URL('.',import.meta.url),env:{...process.env,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'test',
      GEMINI_API_KEY:'gemini-fake',GEMINI_TEST_CASE:'all-ok',GEMINI_USAGE_LOG:'0',FREELLMAPI_FALLBACK:'0',
      SUPABASE_URL:'https://test-seoul-project.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_testingonly123',
      AI_GLOBAL_DAILY_LIMIT:'1', AI_CLIENT_DAILY_LIMIT:'5',GEMINI_DAILY_CALL_LIMIT:'5',
      USAGE_TEST_DB_DOWN: mode==='down'?'1':'0',USAGE_TEST_BLOCK:mode==='blocked'?'1':'0'},stdio:['ignore','pipe','pipe']});
  const logs=[];for(const stream of [proc.stdout,proc.stderr])stream.on('data',c=>logs.push(String(c)));
  t.after(()=>proc.kill());const url=`http://127.0.0.1:${port}`;
  for(let i=0;i<60;i++){try{if((await fetch(url+'/api/health')).ok)return url;}catch{} await wait(50);}
  throw Error('Server failed '+logs.join(''));
}
async function ask(base){const r=await fetch(base+'/api/tutor',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});return {status:r.status,json:await r.json()};}
test('v38: active Supabase store allows tutor once and enforces global persisted limit',async t=>{
  const base=await boot(t);
  const h=await (await fetch(base+'/api/health')).json();assert.equal(h.persistentUsage,true);
  const ok=await ask(base);assert.equal(ok.status,200,JSON.stringify(ok.json));
  const capped=await ask(base);assert.equal(capped.status,429);assert.equal(capped.json.code,'PUBLIC_USAGE_LIMIT');
});
test('v38: quota RPC denies and AI is never contacted',async t=>{
  const base=await boot(t,'blocked');const r=await ask(base);
  assert.equal(r.status,429);assert.equal(r.json.retryable,false);
});
test('v38: quota storage outage stops requests with non-retryable 503',async t=>{
  const base=await boot(t,'down');const r=await ask(base);
  assert.equal(r.status,503);assert.equal(r.json.code,'USAGE_STORAGE_UNAVAILABLE');assert.equal(r.json.retryable,false);
});
