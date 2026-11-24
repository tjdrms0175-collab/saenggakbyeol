import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {setTimeout as pause} from 'node:timers/promises';
async function boot(t){
  const reserve=http.createServer();
  await new Promise(r=>reserve.listen(0,'127.0.0.1',r));
  const port=reserve.address().port;
  await new Promise(r=>reserve.close(r));
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'test',GEMINI_API_KEY:'test-only',SUPABASE_URL:'',SUPABASE_SECRET_KEY:''},stdio:'ignore'});
  t.after(()=>child.kill());
  const base=`http://127.0.0.1:${port}`;
  for(let n=0;n<100;n++){try{if((await fetch(base+'/api/health')).ok)return base;}catch{}await pause(40);}
  throw Error('Unable to start test server');
}
async function post(base,url,body,origin){
  const res=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
  return {status:res.status,body:await res.json()};
}
test('v39 UI has reporting affordance, first-use guardian fields and a privacy notice page',async t=>{
  const base=await boot(t);
  const html=await(await fetch(base+'/')).text();
  const js=await(await fetch(base+'/app.js')).text();
  const notice=await fetch(base+'/privacy.html');
  assert.equal(notice.status,200);
  assert.match(await notice.text(),/개인정보 처리 안내/);
  assert.match(html,/id="parentSetup"/);
  assert.match(html,/id="guardianConfirm"/);
  assert.match(html,/id="aiReportModal"/);
  assert.match(js,/이 답변 신고/);
  assert.doesNotMatch(html,/초기값은 <strong>0000/);
});
test('v39 report API validates origin and safe input and fails closed before SQL setup',async t=>{
  const base=await boot(t);
  const spoofed=await post(base,'/api/ai/report',{reason:'unsafe'},'https://attacker.example');
  assert.equal(spoofed.status,403);
  const bad=await post(base,'/api/ai/report',{reason:'other',answerExcerpt:'x'.repeat(601)});
  assert.equal(bad.status,400);
  const legitimate=await post(base,'/api/ai/report',{reason:'unsafe'});
  assert.equal(legitimate.status,503);
  assert.match(legitimate.body.error,/신고를 저장하지 못했어요/);
});
