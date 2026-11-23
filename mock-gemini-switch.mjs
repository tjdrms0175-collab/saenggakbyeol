// Test-only preload: intercepts Gemini requests. No real API calls or credentials.
const realFetch = globalThis.fetch;
let primaryAttempts = 0;
const scenario = process.env.GEMINI_TEST_CASE || 'quota-first';
globalThis.fetch = async (url, options={}) => {
  if (!String(url).startsWith('https://generativelanguage.googleapis.com/')) return realFetch(url, options);
  const model = decodeURIComponent(String(url).split('/models/')[1].split(':')[0]);
  const payload = JSON.parse(options.body);
  const isReview = payload.systemInstruction.parts[0].text.includes('독립 검토자');
  if (model === 'gemini-3.5-flash-lite') {
    primaryAttempts++;
    if (scenario === 'auth') return new Response('{}',{status:401});
    if (scenario === 'overload') return new Response('{}',{status:503});
    if (['two-quota','all-quota'].includes(scenario) || (scenario === 'quota-first' && primaryAttempts === 1))
      return new Response('{}',{status:429});
  }
  if (model === 'gemini-3.6-flash' && ['two-quota','all-quota'].includes(scenario)) return new Response('{}',{status:429});
  if (model === 'gemini-3.8-flash' && scenario === 'all-quota') return new Response('{}',{status:429});
  const output = isReview
    ? {approved:true,focus:'두 수의 최대공약수 찾기',safe_hint:'먼저 12의 약수를 하나씩 적고, 18에도 공통으로 들어 있는지 비교해 볼까요?',verdict:'uncertain',reason:'원문과 일치',private_final_answer:'6',answer_aliases:[],safe_to_show:true,contains_answer:false,contains_complete_solution:false}
    : {focus:'두 수의 최대공약수 찾기',given_facts:['12','18'],child_intent:'ask_hint',verdict:'uncertain',hint:'먼저 12의 약수를 하나씩 적고, 18에도 공통으로 들어 있는지 비교해 볼까요?',private_final_answer:'6',answer_aliases:[],step_goal:'약수 알아보기'};
  return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(output)}]}}]}),{status:200,headers:{'Content-Type':'application/json'}});
};
