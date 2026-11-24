import test from 'node:test';
import assert from 'node:assert/strict';
import {makeUsageStore,clientQuotaId,storageConfig,UsageStorageError} from './supabase-usage.mjs';
const env={SUPABASE_URL:'https://test-seoul-project.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_testingonly123',TRUST_PROXY:'1'};

test('v38: secret key is sent server-side in apikey header only',async()=>{
  let observed;
  const store=makeUsageStore(env,async (url,config)=>{
    observed={url,config}; return new Response('true',{status:200,headers:{'Content-Type':'application/json'}});
  });
  const result=await store.reserve('ip_abcd','question',40);
  assert.equal(result,true);
  assert.equal(observed.url,'https://test-seoul-project.supabase.co/rest/v1/rpc/reserve_daily_usage');
  assert.equal(observed.config.headers.apikey,env.SUPABASE_SECRET_KEY);
  assert.equal(observed.config.headers.Authorization,undefined);
  assert.equal(observed.config.redirect,'error');
  assert.equal(JSON.stringify(JSON.parse(observed.config.body)),JSON.stringify({p_client_id:'ip_abcd',p_metric:'question',p_max:40}));
});

test('v38: database rejects a quota increment',async()=>{
  const store=makeUsageStore(env,async()=>new Response('false',{status:200}));
  assert.equal(await store.reserve('global_public','question',120),false);
});

test('v38: database outage fails closed rather than allowing paid Gemini calls',async()=>{
  const store=makeUsageStore(env,async()=>{throw Error('connection refused: do not disclose');});
  await assert.rejects(store.reserve('global_gemini','api',240),e=>e instanceof UsageStorageError && e.code==='USAGE_STORAGE_UNAVAILABLE' && !e.message.includes('connection refused'));
});

test('v38: missing key, unsafe URL, or malformed RPC response fail closed',async()=>{
  assert.throws(()=>storageConfig({SUPABASE_URL:'https://test-seoul-project.supabase.co'}),UsageStorageError);
  assert.throws(()=>storageConfig({...env,SUPABASE_URL:'http://localhost:8080'}),UsageStorageError);
  assert.throws(()=>storageConfig({...env,SUPABASE_URL:'https://wrong.site'}),UsageStorageError);
  const store=makeUsageStore(env,async()=>new Response('{"error":"misconfigured"}',{status:200}));
  await assert.rejects(store.reserve('global_public','question',120),UsageStorageError);
});

test('v38: anonymized client ID is deterministic and raw address is not stored',()=>{
  const req={headers:{'x-forwarded-for':'203.0.113.12, 127.0.0.1'},socket:{remoteAddress:'127.0.0.1'}};
  const id=clientQuotaId(req,env.SUPABASE_SECRET_KEY,true);
  assert.match(id,/^ip_[a-f0-9]{64}$/);
  assert.equal(id,clientQuotaId(req,env.SUPABASE_SECRET_KEY,true));
  assert.notEqual(id,clientQuotaId(req,env.SUPABASE_SECRET_KEY,false));
  assert.equal(id.includes('203.0.113.12'),false);
});
