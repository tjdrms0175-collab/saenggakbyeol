import test from 'node:test';
import assert from 'node:assert/strict';
import {runTutorFlow,knownWrongOperationValues} from './tutor-engine.mjs';

const problem='어떤 수에 7을 곱해야 할 것을 잘못하여 7을 더했더니 21이 되었습니다. 바르게 계산한 값은 얼마인가요?';
const hint='어떤 수에 7을 잘못 더해서 21이 되었어요. 21에서 7을 빼면 원래 수가 얼마인가요?';
const safeNext='잘못된 덧셈에서 먼저 원래 수를 찾았어요. 바르게 계산하려면 그 수에 원래 어떤 계산을 해야 할까요?';
function callWith(attempt,{privateAnswer='98',draftVerdict='correct',reviewVerdict='correct',draftStep='uncertain',reviewStep='uncertain',nextHint=safeNext}={}) {
  const data={problem,grade:'초5~6',subject:'자동',hintLevel:2,attemptText:attempt,
    messages:[{role:'user',content:problem},{role:'assistant',content:hint},{role:'user',content:attempt}]};
  return runTutorFlow(data,async({stage})=>JSON.stringify(stage==='draft'?{
    identified_subject:'수학',focus:'잘못 계산한 수에서 바르게 계산한 값을 구하기',
    given_facts:['7을 곱하려다 7을 더했더니 21'],child_intent:'answer_attempt',
    verdict:draftVerdict,step_verdict:draftStep,private_final_answer:privateAnswer,hint:nextHint,
  }:{identified_subject:'수학',focus:'원래 계산과 잘못된 계산의 차이',
    approved:true,verdict:reviewVerdict,step_verdict:reviewStep,private_final_answer:privateAnswer,
    safe_hint:nextHint,safe_to_show:true,contains_answer:false,contains_complete_solution:false
  }));
}

test('v28: distinguishes intermediate and final for mixed multiplication/addition problem',()=>{
  assert.deepEqual(knownWrongOperationValues(problem),{intermediate:14,final:98});
});
test('v28: 14 is a correct intermediate, NEVER completed final even if both models mark it final',async()=>{
  const r=await callWith('14');
  assert.equal(r.verdict,'step_correct');
  assert.match(r.hint,/중간 계산/);
  assert.match(r.hint,/처음 문제/);
  assert.doesNotMatch(r.hint,/98|역할|특징/);
});
test('v28: prevents false final even if both AI private answers wrongly say 14',async()=>{
  const r=await callWith('14',{privateAnswer:'14',draftStep:'correct',reviewStep:'correct'});
  assert.equal(r.verdict,'step_correct');
  assert.doesNotMatch(r.hint,/98/);
});
test('v28: final answer is recognized even if models mislabel its verdict',async()=>{
  const r=await callWith('98',{draftVerdict:'incorrect',reviewVerdict:'incorrect'});
  assert.equal(r.verdict,'correct');
  assert.match(r.hint,/정답이야/);
  assert.doesNotMatch(r.hint,/98/);
});
test('v28: unrelated numeric answer is never marked correct',async()=>{
  const r=await callWith('7');
  assert.notEqual(r.verdict,'correct');
  assert.notEqual(r.verdict,'step_correct');
});
test('v28: textual intermediate word is not full correct when private original answer differs',async()=>{
  const original='사막에 사는 선인장의 잎이 뾰족하게 변한 이유는 무엇인가요?';
  const r=await runTutorFlow({problem:original,grade:'초5~6',subject:'과학',attemptText:'가시',
    messages:[{role:'user',content:original},{role:'assistant',content:'이 뾰족한 것을 뭐라고 부를까요?'},{role:'user',content:'가시'}]
  },async ({stage})=>JSON.stringify(stage==='draft'?{
    focus:'잎의 변화 원인',child_intent:'answer_attempt',verdict:'correct',step_verdict:'correct',
    private_final_answer:'수분 증발을 줄이기 위해서',hint:'선인장에서는 물을 아끼는 게 중요해요. 그 형태는 어떤 일을 할까요?'
  }:{focus:'선인장의 잎의 역할',approved:true,verdict:'correct',step_verdict:'correct',
    private_final_answer:'수분 증발을 줄이기 위해서',safe_hint:'선인장에서는 물을 아끼는 게 중요해요. 그 형태는 어떤 일을 할까요?',
    safe_to_show:true,contains_answer:false,contains_complete_solution:false
  }));
  assert.equal(r.verdict,'step_correct');
  assert.doesNotMatch(r.hint,/정답을 완전히/);
});
