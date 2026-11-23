import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {setTimeout as wait} from 'node:timers/promises';

const q='12와 18의 공약수를 비교하는 방법을 알려 주세요.';
const hint='먼저 12의 약수를 하나씩 적어 보고, 18도 나누어떨어지는지 확인해 볼까요?';
const uid='test-request-1234567890';
const pid='problem-id-abcdef123456';
async function listen(fn){const server=http.createServer(fn);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return server;}
async function close(server){await new Promise(resolve=>server.close(resolve));}
function output(res,status,object,extra={}) {res.writeHead(status,{'Content-Type':'application/json',...extra});res.end(JSON.stringify(object));}
async function boot(t, mockHandler){
  const upstream=await listen(mockHandler);
  const temp=await listen((_,res)=>res.end());const port=temp.address().port;await close(temp);
  const processServer=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),
    env:{...process.env,NODE_ENV:'test',HOST:'127.0.0.1',PORT:String(port),APP_ACCESS_PIN:'',
      GEMINI_API_KEY:'',FREELLMAPI_FALLBACK:'0',FREELLMAPI_API_KEY:'mock-secret',FREELLMAPI_BASE_URL:`http://127.0.0.1:${upstream.address().port}/v1`},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{processServer.kill();await close(upstream);});
  for(let i=0;i<50;i++){try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok)break;}catch{} await wait(50);}
  return {base:`http://127.0.0.1:${port}`};
}
function request(base, requestId=uid) {return fetch(base+'/api/tutor', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
  provider:'freellmapi',model:'auto:smart',grade:'초5~6',subject:'수학',problem:q,
  problemId:pid,retryRequestId:requestId,messages:[{role:'user',content:q}]
})});}
function reply(raw){
  const ins=JSON.parse(raw).messages[0].content;
  return ins.includes('[독립 검토자 역할]')
    ? {approved:true,focus:'두 수의 공약수 비교',safe_hint:hint,verdict:'uncertain',reason:'원문 일치',private_final_answer:'6',answer_aliases:[],safe_to_show:true,contains_answer:false,contains_complete_solution:false}
    : {focus:'두 수의 공약수 비교',given_facts:['12와 18'],child_intent:'ask_hint',verdict:'uncertain',hint,private_final_answer:'6',answer_aliases:[],step_goal:'약수 알아보기'};
}
test('503 is preserved and marked retryable; same request recovers and is never counted twice',async t=>{
  let calls=0;
  const {base}=await boot(t,async(req,res)=>{
    calls++;let raw='';for await(const c of req)raw+=c;
    if(calls===1)return output(res,503,{error:{code:503}}, {'Retry-After':'2'});
    output(res,200,{choices:[{message:{content:JSON.stringify(reply(raw))}}]});
  });
  const first=await request(base);const firstData=await first.json();
  assert.equal(first.status,503);assert.equal(firstData.retryable,true);assert.equal(firstData.retryAfterSeconds,2);
  assert.doesNotMatch(JSON.stringify(firstData),/mock-secret/);
  const recovered=await request(base);const data=await recovered.json();
  assert.equal(recovered.status,200,JSON.stringify(data));assert.equal(data.hintCount,1);
  const again=await request(base);const cached=await again.json();
  assert.equal(cached.hintCount,1);assert.equal(calls,3,'one failed + two review calls, no duplicate stages');
  const next=await request(base,'another-request-123456789');const nextData=await next.json();
  assert.equal(nextData.hintCount,2);
});

test('401 is not retryable; 429 with short Retry-After is retryable',async t=>{
  let calls=0;
  const {base}=await boot(t,async(req,res)=>{
    calls++;for await(const _chunk of req){};
    if(calls===1)return output(res,401,{error:'bad key'});
    return output(res,429,{error:'rate limited'},{'Retry-After':'12'});
  });
  const one=await request(base,'auth-error-req-123456789');const a=await one.json();
  assert.equal(one.status,401);assert.equal(a.retryable,false);assert.match(a.error,/401/);
  const two=await request(base,'quota-retry-req-12345678');const b=await two.json();
  assert.equal(two.status,429);assert.equal(b.retryable,true);assert.equal(b.retryAfterSeconds,12);
});

test('simultaneous duplicate request IDs share one model computation and one hint',async t=>{
  let calls=0;
  const {base}=await boot(t,async(req,res)=>{
    calls++;let raw='';for await(const c of req)raw+=c;
    await wait(90);
    output(res,200,{choices:[{message:{content:JSON.stringify(reply(raw))}}]});
  });
  const [a,b]=await Promise.all([request(base,'concurrent-req-123456789'),request(base,'concurrent-req-123456789')]);
  assert.equal(a.status,200);assert.equal(b.status,200);
  assert.equal((await a.json()).hintCount,1);assert.equal((await b.json()).hintCount,1);
  assert.equal(calls,2);
});
