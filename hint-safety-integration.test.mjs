import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {setTimeout as pause} from 'node:timers/promises';

const original='12와 18의 최대공약수는 무엇인가요?';
const safeHint='약수는 나누었을 때 나머지가 없는 수예요. 먼저 12를 나누어떨어지게 하는 수를 하나씩 적어 볼까요?';
async function listen(fn){const s=http.createServer(fn);await new Promise(r=>s.listen(0,'127.0.0.1',r));return s;}
async function close(s){await new Promise(r=>s.close(r));}
async function availablePort(){const s=await listen((_q,r)=>r.end());const p=s.address().port;await close(s);return p;}

test('private math answer and unsafe visible hints never leave the HTTP server or count toward unlocking',async t=>{
  let unsafe=true;
  const upstream=await listen(async(req,res)=>{
    for await (const _ of req) {};
    const draft={focus:'12와 18의 최대공약수 찾기',given_facts:['12','18'],child_intent:'ask_hint',verdict:'uncertain',
      private_final_answer:'6',answer_aliases:['여섯'],step_goal:'12의 약수 열거',hint:safeHint};
    const review={approved:true,focus:'12와 18의 최대공약수 찾기',safe_hint: unsafe ? '둘 모두를 나누는 가장 큰 수는 6이에요. 이제 답을 적어 볼까요?' : safeHint,
      verdict:'uncertain',private_final_answer:'6',answer_aliases:['여섯'],safe_to_show:true,contains_answer:false,contains_complete_solution:false};
    const chunks=[];
    // determine stage by which fields the generated system instructions request
    // (the mocked provider only sees the final request body)
    // Supply review on alternate calls: two stages per successful request.
    callIndex++;
    const result=callIndex % 2 === 0 ? review : draft;
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}));
  });
  let callIndex=0;
  const port=await availablePort();
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),
    env:{...process.env,NODE_ENV:'test',HOST:'127.0.0.1',PORT:String(port),FREELLMAPI_API_KEY:'fake-router-internal',
      FREELLMAPI_BASE_URL:`http://127.0.0.1:${upstream.address().port}/v1`},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{child.kill();await close(upstream);});
  const base=`http://127.0.0.1:${port}`;
  let ready=false;
  for(let i=0;i<60;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await pause(50);}
  assert.equal(ready,true);
  const ask=()=>fetch(base+'/api/tutor',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    provider:'freellmapi',model:'auto:smart',grade:'초5~6',subject:'수학',problem:original,
    problemId:'safety-case-id-1234567890',messages:[{role:'user',content:original}]
  })});
  const blocked=await ask();const blockedJSON=await blocked.json();
  assert.equal(blocked.status,502,JSON.stringify(blockedJSON));
  assert.equal(JSON.stringify(blockedJSON).includes('6이에요'),false);
  unsafe=false;
  const ok=await ask();const good=await ok.json();
  assert.equal(ok.status,200,JSON.stringify(good));
  assert.equal(good.hintCount,1,'failed hint may not unlock parent-only answer');
  assert.equal(good.hint,safeHint);
  assert.equal(JSON.stringify(good).includes('private_final_answer'),false);
  assert.equal(JSON.stringify(good).includes('fake-router-internal'),false);
});
