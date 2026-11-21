import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTutorInput, hasUsefulHint, changesNumberUnit, runTutorFlow, TutorEngineError, makeDraftPrompt, makeReviewPrompt } from './tutor-engine.mjs';

const SCENARIOS = [
  {question:'국어, 수학, 과학 점수가 각각 80점, 90점, 85점이야. 세 점수를 모두 합친 뒤 어떤 수로 나누면 고른 점수가 될까?', focus:'세 과목의 총점을 평균으로 바꿀 때 나누는 수 찾기', hint:'세 과목의 점수가 80점, 90점, 85점이네요. 각각 하나씩 세어서 총점을 몇 개의 과목에 똑같이 나누는지 생각해 볼까요?'},
  {question:'12와 18의 공약수 중 가장 큰 수(최대공약수)는 무엇인가요?', focus:'12와 18의 최대공약수 찾기', hint:'최대공약수는 두 수를 모두 나눌 수 있는 약수 가운데 가장 큰 수예요. 먼저 12를 나누어떨어지게 하는 수를 하나씩 적어 볼까요?'},
  {question:'70분을 몇 시간 몇 분으로 나타낼까요?', focus:'70분을 시간과 분으로 표현하기', hint:'1시간은 60분이에요. 70분에서 60분짜리 묶음을 떼고 나면 몇 분이 남는지 생각해 볼까요?'},
  {question:'얼음이 녹으면 왜 물이 되나요?', focus:'얼음이 물로 바뀌는 모습 이해하기', hint:'차가운 얼음을 따뜻한 손바닥 위에 올려놓으면 점점 작아지는 모습을 볼 수 있어요. 얼음이 받는 것은 무엇일까요?'},
];

function makeInput(question, extra={}) {
  return { grade:'초5~6', subject:'수학', hintLevel:1, problem:question,
    messages:[{role:'user',content:question}], ...extra };
}
function stages({ focus, hint, draftIntent='ask_hint', draftVerdict='uncertain', reviewVerdict=draftVerdict, reviewHint=hint, reviewFocus=focus }) {
  const calls=[];
  return { calls, invokeModel: async p => {
    calls.push(p);
    return JSON.stringify(p.stage==='draft'
      ? {focus, given_facts:['원문에서 인용한 조건'], child_intent:draftIntent, verdict:draftVerdict, hint}
      : {approved:true,focus:reviewFocus,safe_hint:reviewHint,verdict:reviewVerdict,reason:'원문 내용과 일치'});
  }};
}
for(const [i,item] of SCENARIOS.entries()) {
  test(`AI-first scenario ${i+1}: ${item.focus}`,async()=>{
    const {calls,invokeModel}=stages(item);
    const result=await runTutorFlow(makeInput(item.question),invokeModel);
    assert.equal(calls.length,2);
    assert.equal(result.verdict,'uncertain');
    assert.equal(result.hint,item.hint);
    assert.equal(result.problemFocus,item.focus);
    assert.equal(calls[0].payload.original_problem_verbatim,item.question);
    assert.equal(calls[1].payload.original_problem_verbatim,item.question);
    assert.equal(calls[1].payload.draft_to_check.focus,item.focus);
  });
}

test('wrong score-story units are rejected even if both models approve',async()=>{
  const q=SCENARIOS[0].question;
  assert.equal(changesNumberUnit('80개를 90명에게 똑같이 나눠 볼까요?',q),true);
  assert.equal(changesNumberUnit(SCENARIOS[0].hint,q),false);
  assert.equal(hasUsefulHint('80개를 90명에게 똑같이 나눠 볼까요?',q),false);
  const {invokeModel}=stages({...SCENARIOS[0],hint:'80개를 90명에게 똑같이 나눈 그림을 그려 볼까요?'});
  await assert.rejects(()=>runTutorFlow(makeInput(q),invokeModel),e=>e instanceof TutorEngineError);
});

test('candidate that merely repeats question is rejected', async()=>{
  const q='70분을 몇 시간 몇 분으로 나타낼까요?';
  assert.equal(hasUsefulHint(q,q),false);
  const {invokeModel}=stages({focus:'시간 계산',hint:q});
  await assert.rejects(()=>runTutorFlow(makeInput(q),invokeModel),TutorEngineError);
});

test('agreed correct verdict praises child without revealing numeric answer',async()=>{
  const q=SCENARIOS[1].question;
  const f=stages({...SCENARIOS[1],draftIntent:'answer_attempt',draftVerdict:'correct'});
  const input=makeInput(q,{attemptText:'6',hintLevel:3,messages:[{role:'user',content:q},{role:'assistant',content:'먼저 약수를 써 봐요.'},{role:'user',content:'제 답은 6이에요.'}]});
  const result=await runTutorFlow(input,f.invokeModel);
  assert.equal(result.verdict,'correct');
  assert.match(result.hint,/정답/);
  assert.doesNotMatch(result.hint,/(?:정답은|답은)\s*6/);
});

test('incorrect answer gets helpful hint, not a solved answer',async()=>{
  const q=SCENARIOS[1].question;
  const f=stages({...SCENARIOS[1],draftIntent:'answer_attempt',draftVerdict:'incorrect'});
  const input=makeInput(q,{attemptText:'12',messages:[{role:'user',content:q},{role:'user',content:'12가 정답인가요?'}]});
  const result=await runTutorFlow(input,f.invokeModel);
  assert.equal(result.verdict,'incorrect');
  assert.match(result.hint,/좋은 시도/);
  assert.match(result.hint,/약수/);
});

test('disagreement between graders does not falsely mark correct', async()=>{
  const q=SCENARIOS[1].question;
  const f=stages({...SCENARIOS[1],draftIntent:'answer_attempt',draftVerdict:'correct',reviewVerdict:'uncertain'});
  const input=makeInput(q,{attemptText:'6',messages:[{role:'user',content:q},{role:'user',content:'6'}]});
  assert.equal((await runTutorFlow(input,f.invokeModel)).verdict,'uncertain');
});

test('a follow-up question is not incorrectly graded as an attempted answer',async()=>{
  const q=SCENARIOS[2].question;
  const f=stages({...SCENARIOS[2],draftIntent:'clarification',draftVerdict:'correct'});
  const input=makeInput(q,{attemptText:'왜 60으로 나눠요?',messages:[{role:'user',content:q},{role:'user',content:'왜 60으로 나눠요?'}]});
  assert.equal((await runTutorFlow(input,f.invokeModel)).verdict,'uncertain');
});

test('re-analysis flag, image indicator, high hint numbers survive into prompts',async()=>{
  const input=makeInput('문제 사진을 확인해 주세요',{recheck:true,hasPhoto:true,hintLevel:72});
  const clean=cleanTutorInput(input);
  assert.equal(clean.hintLevel,72);
  assert.equal(clean.recheck,true);
  assert.equal(makeDraftPrompt(clean).payload.image_attached,true);
  assert.equal(makeReviewPrompt(clean,{hint:'hello'}).payload.wants_problem_reanalysis,true);
});

test('bad JSON from either model fails closed instead of inventing a generic hint',async()=>{
  const q=SCENARIOS[1].question;
  await assert.rejects(()=>runTutorFlow(makeInput(q),async()=>'{not valid json'),TutorEngineError);
  const first={...SCENARIOS[1]};
  let count=0;
  await assert.rejects(()=>runTutorFlow(makeInput(q),async()=>{
    count++;return count===1 ? JSON.stringify({focus:first.focus,hint:first.hint,child_intent:'ask_hint',verdict:'uncertain'}):'invalid';
  }),TutorEngineError);
});


test('reviewer repairs a generic first-draft hint',async()=>{
  const q=SCENARIOS[0].question;
  const f=stages({...SCENARIOS[0], hint:'문제에 나온 숫자는 무엇인가요?',reviewHint:SCENARIOS[0].hint});
  const result=await runTutorFlow(makeInput(q),f.invokeModel);
  assert.equal(f.calls.length,2);
  assert.equal(result.hint,SCENARIOS[0].hint);
});
