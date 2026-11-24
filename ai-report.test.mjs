import test from 'node:test';
import assert from 'node:assert/strict';
import {submitAiReport,ReportStorageError,REPORT_REASONS} from './ai-report.mjs';
const env={SUPABASE_URL:'https://abc-test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_a_b_c_123456789'};

test('v39 report reasons are closed allowlist, not arbitrary strings',()=>{
  assert.deepEqual([...REPORT_REASONS],['unsafe','offensive','incorrect','privacy','other']);
});
test('v39 a report contains only reason and explicit optional answer excerpt',async()=>{
  const calls=[];
  const fetcher=async(url,opts)=>{calls.push({url,opts});return {ok:true,status:201};};
  await submitAiReport({reason:'unsafe'},env,fetcher);
  assert.equal(calls[0].url,'https://abc-test.supabase.co/rest/v1/ai_reports');
  assert.equal(calls[0].opts.headers.apikey,env.SUPABASE_SECRET_KEY);
  assert.deepEqual(JSON.parse(calls[0].opts.body),{reason:'unsafe',answer_excerpt:null});
  await submitAiReport({reason:'incorrect',answerExcerpt:'그림자는 빛을 가리는 물체 때문에 생겨요.'},env,fetcher);
  assert.deepEqual(JSON.parse(calls[1].opts.body),{reason:'incorrect',answer_excerpt:'그림자는 빛을 가리는 물체 때문에 생겨요.'});
  for(const {opts} of calls){
    assert.ok(!/question|image|client|ip|cookie|photo/i.test(opts.body));
  }
});
test('v39 reports reject absent Supabase, invalid reason and oversize excerpts',async()=>{
  await assert.rejects(()=>submitAiReport({reason:'invalid'},env),TypeError);
  await assert.rejects(()=>submitAiReport({reason:'unsafe',answerExcerpt:'a'.repeat(601)},env),TypeError);
  await assert.rejects(()=>submitAiReport({reason:'unsafe'},{},async()=>({ok:true})),ReportStorageError);
  await assert.rejects(()=>submitAiReport({reason:'unsafe'},env,async()=>({ok:false,status:403})),ReportStorageError);
});
