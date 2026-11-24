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
test('v39 no default guardian PIN; first-use setup and later PIN change work', async t=>{
  const base=await boot(t);
  const config=await(await fetch(base+'/api/answer/config')).json();
  assert.equal(config.pinConfigured,false);
  const noDefault=await post(base,'/api/parent/verify',{pin:'0000'});
  assert.equal(noDefault.status,428);
  const weak=await post(base,'/api/parent/setup',{newPin:'123456',confirmPin:'123456',guardianConfirmed:true});
  assert.equal(weak.status,400);
  const withoutGuardian=await post(base,'/api/parent/setup',{newPin:'826493',confirmPin:'826493',guardianConfirmed:false});
  assert.equal(withoutGuardian.status,400);
  const setup=await post(base,'/api/parent/setup',{newPin:'826493',confirmPin:'826493',guardianConfirmed:true});
  assert.equal(setup.status,201);
  assert.match(setup.cookie||'',/sb_answer_pin=/);
  const cookie=setup.cookie.split(';')[0];
  const noOverwrite=await post(base,'/api/parent/setup',{newPin:'592637',confirmPin:'592637',guardianConfirmed:true},cookie);
  assert.equal(noOverwrite.status,409);
  const wrong=await post(base,'/api/parent/verify',{pin:'0000'},cookie);
  assert.equal(wrong.status,403);
  const good=await post(base,'/api/parent/verify',{pin:'826493'},cookie);
  assert.equal(good.status,200);
  assert.equal(good.body.verified,true);
  const changed=await post(base,'/api/answer/change-pin',{oldPin:'826493',newPin:'592637'},cookie);
  assert.equal(changed.status,200);
  const newCookie=changed.cookie.split(';')[0];
  const old=await post(base,'/api/parent/verify',{pin:'826493'},newCookie);
  assert.equal(old.status,403);
  const updated=await post(base,'/api/parent/verify',{pin:'592637'},newCookie);
  assert.equal(updated.status,200);
});
test('v39 parent authentication does not bypass five-hint answer server gate',async t=>{
  const base=await boot(t);
  const setup=await post(base,'/api/parent/setup',{newPin:'826493',confirmPin:'826493',guardianConfirmed:true});
  assert.equal(setup.status,201);
  const cookie=setup.cookie.split(';')[0];
  const answer=await post(base,'/api/answer/reveal',{pin:'826493',problemId:'not-yet-five',problem:'7 × 6은?',grade:'초3~4',subject:'수학'},cookie);
  assert.equal(answer.status,403);
  assert.match(answer.body.error,/힌트를 5번/);
});
