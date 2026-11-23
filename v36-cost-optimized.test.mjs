import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import http from 'node:http';
import { cleanTutorInput, makeDraftPrompt, makeReviewPrompt } from './tutor-engine.mjs';

const ORIGINAL = '[사회] 민주주의에서 국민의 대표가 모여 중요한 결정을 내리는 곳은 어디인가요?';
const input = cleanTutorInput({grade:'초5~6', problem:ORIGINAL, hintLevel:2,
 messages:[{role:'user',content:ORIGINAL},{role:'assistant',content:'주변의 규칙을 함께 만드는 모습을 생각해 보세요.'},{role:'user',content:'힌트 더 주세요.'}]});
const draft = {focus:'법을 만드는 기관의 역할',hint:'규칙을 만들 때는 누가 의견을 모으는지 생각해 봐요. 나라의 법을 만드는 일을 맡는 역할은 무엇일까요?',given_facts:['국민의 대표가 모인다'],private_final_answer:'국회',identified_subject:'사회'};
test('v36: independent reviewer still checks answer safety and grade while avoiding duplicate long persona',()=>{
 const d=makeDraftPrompt(input),r=makeReviewPrompt(input,draft);
 assert.match(r.instructions,/독립 검토자/);
 assert.match(r.instructions,/선택지의 핵심 이유/);
 assert.match(r.instructions,/초5~6/);
 assert.match(r.instructions,/정답/);
 assert.ok(r.instructions.length<d.instructions.length,'review prompt should be shorter than draft');
 assert.equal(r.payload.draft_to_check.given_facts,undefined);
 assert.equal(r.payload.draft_to_check.private_final_answer,'국회');
});
test('v36: recent dialogue is capped without removing the last student turn',()=>{
 const text='가'.repeat(950);
 const long=cleanTutorInput({grade:'초3~4',problem:ORIGINAL,
  messages:Array.from({length:14},(_,i)=>({role:i%2?'assistant':'user',content:text})) .concat({role:'user',content:'다음 힌트 부탁해요'})});
 const out=makeDraftPrompt(long).payload.prior_dialogue;
 assert.ok(out.length<=6);
 assert.ok(out.every(x=>x.text.length<=420));
 assert.equal(out.at(-1).text,'다음 힌트 부탁해요');
});
async function server(t) {
 const socket=http.createServer(); await new Promise(r=>socket.listen(0,'127.0.0.1',r));
 const port=socket.address().port; await new Promise(r=>socket.close(r));
 const child=spawn(process.execPath,['--import','./mock-gemini-switch.mjs','server.mjs'],{
  cwd:new URL('.',import.meta.url),env:{...process.env,NODE_ENV:'test',GEMINI_TEST_CASE:'all-ok',PORT:String(port),HOST:'127.0.0.1',GEMINI_API_KEY:'fake-key',GEMINI_USAGE_LOG:'0',GEMINI_VALIDATE_COST:'1'},
  stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill());
 const base=`http://127.0.0.1:${port}`;
 for(let i=0;i<100;i++){try{const r=await fetch(base+'/api/health');if(r.ok)return base;}catch{}await delay(40)}
 throw Error('Server did not start');
}
test('v36: server advertises new 3.1 → 3.5 → 3.8 priority',async t=>{
 const base=await server(t);
 const cfg=await (await fetch(base+'/api/provider-config')).json();
 assert.deepEqual(cfg.geminiRoute.models,['gemini-3.1-flash-lite','gemini-3.5-flash-lite','gemini-3.8-flash']);
 const req=await fetch(base+'/api/tutor',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grade:'초5~6',provider:'gemini',problem:'12와 18의 최대공약수를 어떻게 구하나요?',messages:[{role:'user',content:'12와 18의 최대공약수를 어떻게 구하나요?'}]})});
 const out=await req.json();assert.equal(req.status,200,JSON.stringify(out));
 assert.equal(out.model,'gemini-3.1-flash-lite');
});
