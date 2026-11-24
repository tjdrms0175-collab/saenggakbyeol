import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {cleanTutorInput, makeDraftPrompt, makeReviewPrompt, gradeTeachingGuidance} from './tutor-engine.mjs';

const q='12와 18의 최대공약수를 구하는 방법을 설명해 주세요.';
const dialogue=[
  {role:'user',content:q},
  {role:'assistant',content:'먼저 첫 번째 수의 약수를 적어 보세요. 12를 나누는 수는 무엇인가요?'},
  {role:'user',content:'1, 2, 3을 찾았어요.'},
  {role:'assistant',content:'잘했어요. 그 밖에 12를 나누어떨어지게 하는 수를 하나 더 생각해 볼까요?'},
  {role:'user',content:'힌트를 더 주세요.'},
];
const input=cleanTutorInput({grade:'초5~6',subject:'자동',hintLevel:3,problem:q,messages:dialogue});
const draft=makeDraftPrompt(input);
const review=makeReviewPrompt(input,{
  focus:'약수 비교',hint:'두 수의 약수를 공통으로 나누어 보세요. 어느 수가 양쪽에 모두 있는지 찾아볼까요?',
  identified_subject:'수학',private_final_answer:'6',answer_aliases:[],step_goal:'약수 비교',given_facts:['12','18']
});
test('v40 prompt is compact, retains independent verification and grade-specific methods',()=>{
  const n=draft.instructions.length+JSON.stringify(draft.payload).length+
    review.instructions.length+JSON.stringify(review.payload).length;
  assert.ok(n<6900,`Unexpected prompt bloat: ${n} chars`);
  for(const p of [draft,review]) {
    assert.match(p.instructions,/정답/);
    assert.match(p.instructions,/현재 힌트 3회차/);
    assert.match(p.instructions,/초5~6/);
    assert.match(p.instructions,/수학:/);
    assert.equal(p.payload.original_problem_verbatim,q);
    assert.equal(p.payload.hint_number,3);
    assert.equal(p.payload.thinking_step_instruction,undefined);
    assert.equal(p.payload.subject_classification_rule,undefined);
    assert.ok(p.payload.prior_dialogue.some(x=>x.role==='assistant'));
    assert.equal(p.payload.prior_dialogue.at(-1).text,'힌트를 더 주세요.');
    assert.ok(p.payload.prior_dialogue.every(x=>x.text.length<=280));
    assert.equal(JSON.stringify(p.payload).split(q).length-1,1,'original must not be duplicated');
  }
  assert.match(review.instructions,/독립 검토자 역할/);
  assert.equal(review.payload.draft_to_check.private_final_answer,'6');
  assert.equal(review.payload.draft_to_check.given_facts,undefined);
});

test('v40 short student reply is kept for step grading and answer attempt',()=>{
  const v=cleanTutorInput({grade:'초1~2',problem:q,hintLevel:2,attemptText:'3',messages:[
    {role:'user',content:q}, {role:'assistant',content:'12의 약수를 하나 적어 보세요.'},{role:'user',content:'3'}]});
  const p=makeDraftPrompt(v).payload;
  assert.equal(p.prior_dialogue.at(-1).text,'3');
  assert.equal(p.possible_answer_text_only_if_student_attempted,'3');
  assert.match(gradeTeachingGuidance('초1~2'),/우리 반 약속/);
});

test('v40 confirmed photo sends recognized text without uploading the picture again',()=>{
  const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
  const m=app.match(/imageDataUrl:state\.active\?\.photoReviewed\s*\?\s*null\s*:\s*\(photoDataUrl\|\|null\)/);
  assert.ok(m,'confirmed photos should not be resent over tutor API');
  assert.match(app,/\/api\/photo\/read/,'photo recognition remains available');
});

test('v40 logs implicit cache hits without storing prompts or user content',()=>{
  const server=fs.readFileSync(new URL('./server.mjs',import.meta.url),'utf8');
  assert.match(server,/metadata\.cachedContentTokenCount/);
  assert.match(server,/cached=\$\{cached\}/);
  assert.match(server,/\[gemini-usage\]/);
});
