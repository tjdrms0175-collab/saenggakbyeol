import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTutorInput, hasUsefulHint, changesNumberUnit, runTutorFlow, TutorEngineError, makeDraftPrompt, makeReviewPrompt } from './tutor-engine.mjs';

const SCENARIOS = [
  {question:'국어, 수학, 과학 점수가 각각 80점, 90점, 85점이야. 세 점수를 모두 합친 뒤 어떤 수로 나누면 고른 점수가 될까?', focus:'과목별 점수의 평균을 구할 때 나누는 수 찾기', hint:'평균은 총점을 같은 기준으로 나누어 살펴보는 거예요. 국어·수학·과학 점수를 하나씩 세어 보면 총점을 무엇으로 나누어야 할까요?', final:'3'},
  {question:'12와 18의 공약수 중 가장 큰 수(최대공약수)는 무엇인가요?', focus:'12와 18의 최대공약수 찾기', final:'6', hint:'최대공약수는 두 수를 모두 나눌 수 있는 약수 가운데 가장 큰 수예요. 먼저 12를 나누어떨어지게 하는 수를 하나씩 적어 볼까요?'},
  {question:'70분을 몇 시간 몇 분으로 나타낼까요?', focus:'70분을 시간과 분으로 표현하기', final:'1시간 10분', hint:'1시간은 60분이에요. 70분에서 60분짜리 묶음을 떼고 나면 몇 분이 남는지 생각해 볼까요?'},
  {question:'얼음이 녹으면 왜 물이 되나요?', focus:'얼음이 물로 바뀌는 모습 이해하기', final:'열을 받아 녹기 때문', hint:'차가운 얼음을 따뜻한 손바닥 위에 올려놓으면 점점 작아지는 모습을 볼 수 있어요. 얼음이 받는 것은 무엇일까요?'},
];

function makeInput(question, extra={}) {
  return { grade:'초5~6', subject:'수학', hintLevel:1, problem:question,
    messages:[{role:'user',content:question}], ...extra };
}
function stages({ focus, hint, final='', draftIntent='ask_hint', draftVerdict='uncertain', reviewVerdict=draftVerdict, reviewHint=hint, reviewFocus=focus }) {
  const calls=[];
  return { calls, invokeModel: async p => {
    calls.push(p);
    return JSON.stringify(p.stage==='draft'
      ? {focus, given_facts:['원문에서 인용한 조건'], child_intent:draftIntent, verdict:draftVerdict, hint, private_final_answer:final,answer_aliases:[],step_goal:'첫 단계 생각하기'}
      : {approved:true,focus:reviewFocus,safe_hint:reviewHint,verdict:reviewVerdict,reason:'원문 내용과 일치',private_final_answer:final,answer_aliases:[],safe_to_show:true,contains_answer:false,contains_complete_solution:false});
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

// v14: parent-authorized answer reveal uses two independent agreeing answers.
import { runAnswerRevealFlow } from './tutor-engine.mjs';
test('parent PIN authorized solution review passes if both independent model stages agree',async()=>{
  const stages=[];
  const result=await runAnswerRevealFlow({problem:'12와 18의 최대공약수는 무엇인가요?',grade:'초5~6',subject:'수학'}, async ({stage,payload})=>{
    stages.push(stage);
    assert.match(payload.original_problem_verbatim,/12와 18/);
    return stage==='answer-draft'
      ? JSON.stringify({answer:'6',explanation:'12와 18을 둘 다 나눌 수 있는 가장 큰 수입니다.',ambiguous:false})
      : JSON.stringify({valid:true,independent_answer:'6'});
  });
  assert.deepEqual(stages,['answer-draft','answer-review']);
  assert.equal(result.answer,'6');
  assert.equal(result.reviewed,true);
});
test('mismatched independent answer fails closed without leaking answer',async()=>{
  await assert.rejects(()=>runAnswerRevealFlow({problem:'12와 18의 최대공약수는 무엇인가요?'},async ({stage})=>
    stage==='answer-draft' ? JSON.stringify({answer:'6',ambiguous:false}) : JSON.stringify({valid:true,independent_answer:'12'})
  ),TutorEngineError);
});
test('ambiguous answers are not disclosed',async()=>{
  await assert.rejects(()=>runAnswerRevealFlow({problem:'이것은 무엇인가요?'},async()=>
    JSON.stringify({answer:'여러 답이 가능해요',ambiguous:true})),TutorEngineError);
});

// v20: less generic, more useful first-step hints while preserving tutor safety.
import { repeatsPreviousHint } from './tutor-engine.mjs';
test('generic number-selection question is not considered a useful hint', () => {
  const q = '12와 18의 최대공약수를 찾아 보세요.';
  assert.equal(hasUsefulHint('문제에 나온 숫자 중 먼저 사용할 숫자는 무엇일까요?', q), false);
  assert.equal(hasUsefulHint('최대공약수는 두 수를 모두 나누는 가장 큰 약수예요. 먼저 12의 약수를 하나씩 적어 볼까요?', q), true);
});
test('new draft/review prompts demand explanation plus one concrete next step', () => {
  const cleaned = cleanTutorInput(makeInput('70분을 몇 시간 몇 분으로 나타내나요?'));
  const draft = makeDraftPrompt(cleaned).instructions;
  const review = makeReviewPrompt(cleaned, {hint:'초안'}).instructions;
  assert.match(draft,/쉬운 개념/);
  assert.match(draft,/첫 행동/);
  assert.match(review,/문제를 원문으로 다시 독립적으로 풀어/);
  assert.match(review,/막연하게 질문/);
});
test('same prior hint is not repeated after a new hint request', async () => {
  const q = '12와 18의 최대공약수는 무엇인가요?';
  const h = '최대공약수는 두 수를 모두 나누는 가장 큰 약수예요. 먼저 12를 나누어떨어지게 하는 수를 적어 볼까요?';
  const repeated = stages({focus:'공약수 찾기',hint:h});
  const input = makeInput(q, {hintLevel:2,messages:[{role:'user',content:q},{role:'assistant',content:h},{role:'user',content:'힌트 더 주세요'}]});
  assert.equal(repeatsPreviousHint(h,[{role:'assistant',text:h}]),true);
  await assert.rejects(() => runTutorFlow(input,repeated.invokeModel), TutorEngineError);
});
test('student correct answer is praised even if review proposes an old hint', async () => {
  const q = '12와 18의 최대공약수는 무엇인가요?';
  const h = '최대공약수는 두 수를 모두 나누는 가장 큰 약수예요. 먼저 12를 나누어떨어지게 하는 수를 적어 볼까요?';
  const grader = stages({focus:'공약수 찾기',hint:h,draftIntent:'answer_attempt',draftVerdict:'correct'});
  const result=await runTutorFlow(makeInput(q,{attemptText:'6',messages:[{role:'user',content:q},{role:'assistant',content:h},{role:'user',content:'답은 6이야'}]}),grader.invokeModel);
  assert.equal(result.verdict,'correct');
});

// v22: every normal hint must approach the answer without ever stating it.
import { answerLeakReason, answerCandidates } from './hint-safety.mjs';
const SAFE_GCD = '약수는 수를 나누었을 때 나머지가 없는 수예요. 먼저 12를 나누어떨어지게 하는 수를 직접 적어 볼까요?';
const MATH_Q = '12와 18의 최대공약수는 무엇인가요?';
function leakFlow({q=MATH_Q,hint,final='6',focus='두 수의 공약수 찾기',level=1,reviewFlags={}}) {
  const call=stages({focus, hint:SAFE_GCD, final, reviewHint:hint});
  return runTutorFlow(makeInput(q,{hintLevel:level}), async p=>{
    const raw = JSON.parse(await call.invokeModel(p));
    if (p.stage === 'review') Object.assign(raw,reviewFlags);
    return JSON.stringify(raw);
  });
}
test('v22: blocks literal numeric final answer even if both models approve', async()=>{
  await assert.rejects(()=>leakFlow({hint:'12와 18의 공약수를 모두 비교했더니 답은 6이에요. 이 숫자를 적어 보세요.'}),TutorEngineError);
  assert.equal(answerLeakReason('6입니다.',MATH_Q,['6']),'numeric-answer');
});
test('v22: blocks final answer written in Korean number words', async()=>{
  assert.ok(answerLeakReason('일곱 묶음이 여섯 번 있으니 마흔둘이에요.', '7 × 6은?', ['42']));
  assert.ok(answerLeakReason('사십이입니다.', '7 × 6은?', ['42']));
  assert.ok(answerLeakReason('세 과목으로 나눠야 해요.', '80점, 90점, 85점의 총점을 몇으로 나눌까?', ['3']));
  await assert.rejects(()=>leakFlow({q:'7 × 6은 무엇인가요?',final:'42',hint:'7을 여섯 번 더해 보면 마흔둘이 돼요. 이 값을 적으세요.'}),TutorEngineError);
});
test('v22: blocks final unit-conversion result but permits an introductory fact', async()=>{
  const q='70분을 몇 시간 몇 분으로 나타내나요?';
  assert.equal(answerLeakReason('1시간은 60분이에요. 70분에서 60분을 먼저 빼 볼까요?',q,['1시간 10분']),null);
  assert.ok(answerLeakReason('70분은 1시간 10분이에요. 이를 적으세요.',q,['1시간 10분']));
  assert.ok(answerLeakReason('남는 시간은 10분이에요. 답을 적어 보세요.',q,['1시간 10분']));
});
test('v22: blocks a one-word science answer and a civic answer', async()=>{
  assert.equal(answerLeakReason('얼음은 열을 받아 녹아요.', '얼음이 녹는 이유는?', ['열']),'single-word-answer');
  assert.ok(answerLeakReason('이것은 직접 민주주의라고 불러요.', '국민이 정치에 직접 참여하는 제도는?', ['직접 민주주의']));
});
test('v22: reviewer safety flags are mandatory even if answer is not literal', async()=>{
  await assert.rejects(()=>leakFlow({hint:SAFE_GCD,reviewFlags:{safe_to_show:false}}),TutorEngineError);
  await assert.rejects(()=>leakFlow({hint:SAFE_GCD,reviewFlags:{contains_complete_solution:true}}),TutorEngineError);
  await assert.rejects(()=>leakFlow({hint:SAFE_GCD,reviewFlags:{contains_answer:true}}),TutorEngineError);
  await assert.rejects(()=>runTutorFlow(makeInput(MATH_Q),async p=>JSON.stringify(p.stage==='draft'
    ? {focus:'약수 찾기',hint:SAFE_GCD,child_intent:'ask_hint',private_final_answer:'6'}
    : {focus:'약수 찾기',safe_hint:SAFE_GCD,approved:true,verdict:'uncertain'})),TutorEngineError);
});
test('v22: leaking focus is replaced by a neutral label', async()=>{
  const result=await leakFlow({hint:SAFE_GCD,focus:'정답은 6'});
  assert.equal(result.hint,SAFE_GCD);
  assert.doesNotMatch(result.problemFocus,/6/);
  assert.doesNotMatch(JSON.stringify(result),/private_final_answer|answer_aliases/);
});
test('v22: even hint number 100 cannot reveal final answer',async()=>{
  const r=await leakFlow({hint:SAFE_GCD,level:100});
  assert.ok(r.hint.includes('먼저 12'));
  await assert.rejects(()=>leakFlow({level:100,hint:'12와 18의 가장 큰 공약수는 여섯이에요. 직접 숫자를 적어 보세요.'}),TutorEngineError);
});
test('v22: safe intermediate question remains visible; private answers stay server-only',async()=>{
  const r=await leakFlow({hint:SAFE_GCD});
  assert.equal(r.hint,SAFE_GCD);
  assert.equal(Object.keys(r).some(k=>k.startsWith('private')),false);
  assert.deepEqual(answerCandidates({private_final_answer:'6'},{private_final_answer:'6',answer_aliases:['여섯']}),['6','여섯']);
});
