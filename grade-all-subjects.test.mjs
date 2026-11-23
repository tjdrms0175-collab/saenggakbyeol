import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTutorInput, gradeTeachingGuidance, makeDraftPrompt, makeReviewPrompt, runTutorFlow, TutorEngineError } from './tutor-engine.mjs';

const SUBJECTS = {
  '수학':'전체 25명 중 10명이 안경을 썼다면 비율은 어떻게 구하나요?',
  '과학':'비가 오지 않을 때 식물의 잎은 어떤 모습으로 변하나요?',
  '영어':'I have a small red bag에서 small을 어떻게 이해할 수 있나요?',
  '국어':'동화 속 주인공이 갑자기 집으로 돌아온 까닭은 무엇인가요?',
  '사회':'우리나라에서 법을 만들고 고치는 일을 맡는 기관은 어디인가요?',
};
const GRADES = ['초1~2','초3~4','초5~6'];
const GRADE_ANCHORS = {
  '초1~2':['손으로 해 볼 수 있는 행동','사탕·블록·손가락','물·햇빛·그림자','그림·동작·익숙한 단어','짧은 문장 속 인물','우리 반 약속'],
  '초3~4':['생활 사례에서 교과 개념','주어진 수가 전체·부분','관찰한 사실과 예상되는 이유','주어·동작·시간 표현','글에서 근거가 되는 문장','학교·지역사회 사례'],
  '초5~6':['교과 개념 간 관계와 근거','공식의 의미와 기준량','변인·관찰 결과·원인','시제·문장 구조·연결어','주장과 근거·글의 구조','제도의 역할과 권한'],
};
function input(grade,question) {
  return cleanTutorInput({grade,subject:'자동',problem:question,hintLevel:1,messages:[{role:'user',content:question}]});
}
const draft={focus:'문제 목표 이해하기',given_facts:[],child_intent:'ask_hint',verdict:'uncertain',step_verdict:'uncertain',hint:'먼저 문제에서 묻는 한 가지 조건을 정확히 짚어 보아요. 그 조건과 관련된 문장은 어디에 있나요?',private_final_answer:'',answer_aliases:[],step_goal:'첫 근거 찾기',identified_subject:'국어'};
for (const grade of GRADES) {
  for (const [subject,question] of Object.entries(SUBJECTS)) {
    test(`v29 grade ${grade} / subject ${subject}: both stages use subject-sensitive rubric`, () => {
      const cleaned=input(grade,question);
      assert.equal(cleaned.grade,grade);
      assert.equal(cleaned.subject,'자동');
      const proposal=makeDraftPrompt(cleaned);
      const review=makeReviewPrompt(cleaned,draft);
      for (const p of [proposal,review]) {
        assert.equal(p.payload.grade,grade);
        assert.equal(p.payload.original_problem_verbatim,question);
        assert.match(p.instructions,new RegExp(`선택된 학년: ${grade}`));
        assert.match(p.instructions,/과목 자동 판별/);
        assert.match(p.instructions,new RegExp(`${subject}:`));
        for (const needle of GRADE_ANCHORS[grade]) assert.ok(p.instructions.includes(needle),`${grade}: '${needle}' is missing`);
      }
    });
  }
}

test('v29 distinct grade rubrics for identical social-science question', () => {
  const q=SUBJECTS['사회'];
  const versions=GRADES.map(grade=>gradeTeachingGuidance(input(grade,q).grade));
  assert.equal(new Set(versions).size,3);
  assert.match(versions[0],/우리 반 약속/);
  assert.match(versions[1],/학교·지역사회/);
  assert.match(versions[2],/삼권분립/);
});

function fakeStages({gradeFit=true,subjectFit=true,correct=false}={}) {
  return async ({stage})=>JSON.stringify(stage==='draft'?{
    identified_subject:'사회',focus:'문제를 생활에서 추론하기',given_facts:[],
    child_intent: correct ? 'answer_attempt' : 'ask_hint',
    verdict:correct?'correct':'uncertain',step_verdict:'uncertain',private_final_answer:'국회',
    answer_aliases:[],step_goal:'역할 하나를 설명하기',
    hint:'우리 반에서 약속을 함께 정하듯 나라에도 중요한 결정을 맡는 곳이 있어요. 법을 만드는 일은 어느 곳에서 할지 생각해 볼까요?'
  }:{
    approved:true,identified_subject:'사회',focus:'법을 만드는 주체를 생각하기',
    safe_hint:'우리 반에서 약속을 정할 때는 여러 친구가 의견을 나누지요. 나라의 법은 누가 모여서 정할지 생각해 볼까요?',
    verdict:correct?'correct':'uncertain',step_verdict:'uncertain',private_final_answer:'국회',
    answer_aliases:[],safe_to_show:true,grade_fit:gradeFit,subject_method_fit:subjectFit,
    contains_answer:false,contains_complete_solution:false,reason:'독립 검토'
  });
}
test('v29 reviewer rejects a grade-inappropriate hint in a normal hint turn',async()=>{
  const q=SUBJECTS['사회'];
  await assert.rejects(()=>runTutorFlow({grade:'초1~2',subject:'자동',problem:q,hintLevel:1,messages:[{role:'user',content:q}]},fakeStages({gradeFit:false})),TutorEngineError);
});
test('v29 reviewer rejects a mismatched subject teaching method',async()=>{
  const q=SUBJECTS['사회'];
  await assert.rejects(()=>runTutorFlow({grade:'초5~6',subject:'자동',problem:q,hintLevel:1,messages:[{role:'user',content:q}]},fakeStages({subjectFit:false})),TutorEngineError);
});
test('v29 a student correct answer remains correct even when *next* hint is not grade-fit',async()=>{
  const q=SUBJECTS['사회'];
  const result=await runTutorFlow({grade:'초5~6',subject:'자동',problem:q,hintLevel:2,attemptText:'국회',messages:[{role:'user',content:q},{role:'assistant',content:'법을 누가 만들까요?'},{role:'user',content:'국회'}]},fakeStages({gradeFit:false,correct:true}));
  assert.equal(result.verdict,'correct');
  assert.match(result.hint,/정답이야/);
});
