import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {setTimeout as pause} from 'node:timers/promises';

async function boot(t){
  const reserve = http.createServer();
  await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));
  const port=reserve.address().port;
  await new Promise(resolve=>reserve.close(resolve));
  const app=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,NODE_ENV:'test',PORT:String(port),HOST:'127.0.0.1',GEMINI_API_KEY:'test-only'},stdio:'ignore'});
  t.after(()=>app.kill());
  const base=`http://127.0.0.1:${port}`;
  for(let i=0;i<60;i++){
    try{if((await fetch(`${base}/api/health`)).ok)return base;}catch{}
    await pause(60);
  }
  throw Error('test server did not start');
}
async function post(base,path,body,cookie=''){
  const res=await fetch(`${base}${path}`,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
  return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')};
}
test('v27 hides student settings and student answer button, parent login gate remains', async t=>{
  const base=await boot(t);
  const html=await (await fetch(base+'/')).text();
  assert.match(html, /id="settingsBtn"[^>]*hidden/);
  assert.ok(!html.includes('id="revealAnswerBtn"'));
  assert.ok(!html.includes('id="answerModal"'));
  assert.match(html, /id="parentGate"/);
  assert.match(html, /id="parentDashboard" hidden/);
  assert.match(html, /id="strengthInsight"/);
  assert.match(html, /id="growthInsight"/);
  assert.match(html, /id="parentRevealBtn"/);
});
test('v27 parent authentication is checked server-side and PIN change protects old PIN', async t=>{
  const base=await boot(t);
  const bad=await post(base,'/api/parent/verify',{pin:'1234'});
  assert.equal(bad.status,403);
  const good=await post(base,'/api/parent/verify',{pin:'0000'});
  assert.equal(good.status,200);
  assert.equal(good.body.verified,true);
  const changed=await post(base,'/api/answer/change-pin',{oldPin:'0000',newPin:'8264'});
  assert.equal(changed.status,200);
  assert.ok(changed.cookie?.includes('sb_answer_pin='));
  const cookie=changed.cookie.split(';')[0];
  const old=await post(base,'/api/parent/verify',{pin:'0000'},cookie);
  assert.equal(old.status,403);
  const updated=await post(base,'/api/parent/verify',{pin:'8264'},cookie);
  assert.equal(updated.status,200);
  assert.equal(updated.body.verified,true);
});
test('v27 parent authentication does not bypass five-hint answer server gate',async t=>{
  const base=await boot(t);
  const verify=await post(base,'/api/parent/verify',{pin:'0000'});
  assert.equal(verify.status,200);
  const answer=await post(base,'/api/answer/reveal',{pin:'0000',problemId:'not-yet-five',problem:'7 × 6은?',grade:'초3~4',subject:'수학'});
  assert.equal(answer.status,403);
  assert.match(answer.body.error,/힌트를 5번/);
});
