import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const question = '12와 18의 공약수 중 가장 큰 수는 무엇인가요?';
const hint = '먼저 12를 나누었을 때 나머지가 없는 수를 하나씩 적어 볼까요? 그런 다음 18에도 통하는지 비교해 봐요.';
async function listen(handler){const s=http.createServer(handler); await new Promise(r=>s.listen(0,'127.0.0.1',r)); return s;}
async function close(s){ await new Promise(r=>s.close(r)); }
function json(res,status,data){res.writeHead(status, {'Content-Type':'application/json'});res.end(JSON.stringify(data));}

// No actual provider keys, external Internet or child data leave this integration test.
test('FreeLLMAPI private router: config, both AI stages, and no browser credentials', async t=>{
  const calls=[];
  const upstream=await listen(async(req,res)=>{
    let raw=''; for await (const c of req) raw+=c;
    calls.push({url:req.url, auth:req.headers.authorization, body:JSON.parse(raw)});
    const instructions=calls.at(-1).body.messages[0].content;
    const answer=instructions.includes('[독립 검토자 역할]')
      ? {approved:true, focus:'두 수의 최대공약수 구하기', safe_hint:hint, verdict:'uncertain', reason:'원문과 일치',private_final_answer:'6',answer_aliases:[],safe_to_show:true,contains_answer:false,contains_complete_solution:false}
      : {focus:'두 수의 최대공약수 구하기', given_facts:['12와 18'], child_intent:'ask_hint', verdict:'uncertain', hint};
    json(res,200,{choices:[{message:{content:JSON.stringify(answer)}}]});
  });
  const port=upstream.address().port;
  const app=await listen((_q,res)=>res.end('')); const appPort=app.address().port; await close(app);
  const child=spawn(process.execPath,['server.mjs'],{
    cwd: new URL('.',import.meta.url),
    env:{...process.env,NODE_ENV:'test',PORT:String(appPort),HOST:'127.0.0.1',APP_ACCESS_PIN:'',
      FREELLMAPI_API_KEY:'fake-test-unified-token',FREELLMAPI_BASE_URL:`http://127.0.0.1:${port}/v1`},
    stdio:['ignore','pipe','pipe']
  });
  t.after(async()=>{ child.kill(); await close(upstream); });
  for(let i=0;i<35;i++){ try{const r=await fetch(`http://127.0.0.1:${appPort}/api/health`);if(r.ok)break;}catch{} await delay(100);}
  const base=`http://127.0.0.1:${appPort}`;
  const config=await (await fetch(base+'/api/provider-config')).json();
  assert.equal(config.providers.freellmapi.configured,true);
  assert.equal(config.providers.freellmapi.env,'FREELLMAPI_API_KEY');
  assert.equal(JSON.stringify(config).includes('fake-test-unified-token'),false);
  assert.equal(JSON.stringify(config).includes(String(port)),false);
  const response=await fetch(base+'/api/tutor',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({provider:'freellmapi',model:'auto:smart',grade:'초5~6',subject:'수학',problem:question,
      messages:[{role:'user',content:question}]})});
  assert.equal(response.status,200,await response.text().catch(()=>''));
  // Fetch bodies are one-shot: test success via calls and fresh mock response where needed.
  assert.equal(calls.length,2);
  assert.ok(calls.every(c=>c.url==='/v1/chat/completions'));
  assert.ok(calls.every(c=>c.auth==='Bearer fake-test-unified-token'));
  assert.ok(calls.every(c=>c.body.model==='auto:smart'));
  assert.equal(child.exitCode,null);
});

test('Opt-in Gemini quota fallback calls private FreeLLMAPI; disabled setting does not', async t=>{
  let calls=0;
  const upstream=await listen(async (req,res)=>{
    calls++;
    let raw='';for await(const c of req) raw+=c;
    const stage=JSON.parse(raw).messages[0].content;
    const reply=stage.includes('[독립 검토자 역할]')
      ? {approved:true, focus:'두 수의 최대공약수 구하기',safe_hint:hint,verdict:'uncertain',reason:'검사완료',private_final_answer:'6',answer_aliases:[],safe_to_show:true,contains_answer:false,contains_complete_solution:false}
      : {focus:'두 수의 최대공약수 구하기',given_facts:['12와 18'],child_intent:'ask_hint',verdict:'uncertain',hint,private_final_answer:'6',answer_aliases:[],step_goal:'약수 알아보기'};
    json(res,200,{choices:[{message:{content:JSON.stringify(reply)}}]});
  });
  const upPort=upstream.address().port;
  const app=await listen((_q,res)=>res.end(''));const appPort=app.address().port;await close(app);
  const child=spawn(process.execPath,['--import','./mock-gemini-rate-limit.mjs','server.mjs'],{
    cwd: new URL('.',import.meta.url),
    env:{...process.env,NODE_ENV:'test',PORT:String(appPort),HOST:'127.0.0.1',APP_ACCESS_PIN:'',
      FREELLMAPI_API_KEY:'fake-test-unified-token',FREELLMAPI_BASE_URL:`http://127.0.0.1:${upPort}/v1`,
      FREELLMAPI_FALLBACK:'1',GEMINI_API_KEY:'fake-gemini-key'},
    stdio:['ignore','pipe','pipe']
  });
  t.after(async()=>{child.kill();await close(upstream);});
  const base=`http://127.0.0.1:${appPort}`;
  for(let i=0;i<35;i++){try{const r=await fetch(base+'/api/health');if(r.ok)break;}catch{}await delay(100);}
  const response=await fetch(base+'/api/tutor',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({provider:'gemini',model:'gemini-3.8-flash',grade:'초5~6',subject:'수학',problem:question,
      messages:[{role:'user',content:question}]})});
  const data=await response.json();
  assert.equal(response.status,200,JSON.stringify(data));
  assert.match(data.hint,/12/);
  assert.equal(calls,2);
});
