/**
 * Server-only output guard for the hint channel.
 * Answer viewing is a separate authenticated route. This module must never be
 * imported by client code: candidate answers are internal model metadata.
 * Heuristics cannot replace teacher/LLM evaluation, so an uncertain or unsafe
 * hint fails closed instead of returning an unreviewed answer.
 */

const KOREAN_DIGITS = new Map([
  [0,['영','공','제로']], [1,['하나','한','일']], [2,['둘','두','이']],
  [3,['셋','세','삼']], [4,['넷','네','사']], [5,['다섯','오']],
  [6,['여섯','육']], [7,['일곱','칠']], [8,['여덟','팔']],
  [9,['아홉','구']], [10,['열','십']], [11,['열하나','십일']],
  [12,['열둘','십이']], [13,['열셋','십삼']], [14,['열넷','십사']],
  [15,['열다섯','십오']], [16,['열여섯','십육']],
  [17,['열일곱','십칠']], [18,['열여덟','십팔']],
  [19,['열아홉','십구']], [20,['스물','이십']]
]);
// Detect spoken number answers as well as Arabic digits. This catches cases
// where a model avoids "42" but writes "마흔둘" or "사십이" instead.
function spokenNumber(n) {
  if (!Number.isInteger(n) || n < 0 || n > 999) return [];
  if (KOREAN_DIGITS.has(n)) return KOREAN_DIGITS.get(n);
  const sinoDigit = ['','일','이','삼','사','오','육','칠','팔','구'];
  const tens = Math.floor((n % 100) / 10), ones = n % 10, hundreds = Math.floor(n / 100);
  let sino = (hundreds ? ((hundreds === 1 ? '' : sinoDigit[hundreds]) + '백') : '') +
    (tens ? (tens === 1 ? '' : sinoDigit[tens]) + '십' : '') + (ones ? sinoDigit[ones] : '');
  const out = [sino];
  if (n < 100 && n >= 20) {
    const decades = {2:'스물',3:'서른',4:'마흔',5:'쉰',6:'예순',7:'일흔',8:'여든',9:'아흔'};
    const countDecades = {2:'스무',3:'서른',4:'마흔',5:'쉰',6:'예순',7:'일흔',8:'여든',9:'아흔'};
    const onesNative = ['','하나','둘','셋','넷','다섯','여섯','일곱','여덟','아홉'];
    const countedOnes = ['','한','두','세','네','다섯','여섯','일곱','여덟','아홉'];
    out.push(decades[tens] + onesNative[ones]);
    out.push(countDecades[tens] + countedOnes[ones]);
  }
  return [...new Set(out)];
}

const PLACEHOLDERS = /^(?:모름|모르겠음|불명확|불확실|판단 불가|정보 부족|없음|미정|알 수 없음|unknown|uncertain|null|n\/a|not enough information)$/i;
const END_WORD = '(?:은|는|이|가|을|를|으로|로|과|와|도|에|에서|입니다|이에요|예요|이다|이다요|이죠|이라고|이라는|인|입니다)?';
const QUANTITY = '(?:개|개씩|명|명씩|과목|과목씩|번|번씩|장|쪽|시간|분|초|원|점|cm|m|km|kg|g|배|묶음)';
const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;
const escapeRegex = s => String(s).replace(ESCAPE_RE, '\\$&');
const fold = s => String(s ?? '').normalize('NFKC').toLowerCase()
  .replace(/[\s.,!?。！？~\-+"'’‘·:;()[\]{}<>\\]/g,'');

export function normalizeFinalAnswer(s) {
  return fold(s).replace(/(?:입니다|이에요|예요|이야|이다)$/,'');
}

/** Find a direct final-answer leak in either visible hint or visible focus. */
export function answerLeakReason(visibleText, originalProblem, privateAnswers = []) {
  const visible = String(visibleText || '').normalize('NFKC').trim();
  const original = String(originalProblem || '').normalize('NFKC');
  if (!visible) return 'empty';

  // Do not reveal completed computations or announce a final solution.
  if (/(?:정답|최종\s*답|최종\s*결과|따라서\s*답|결론)(?:은|는|이|가|:|은요|입니다|이에요|으로)?\s*(?:[-+]?\d|[가-힣]{1,12})/.test(visible))
    return 'declared-final-answer';
  if (/(?:^|\s)(?:그러므로|따라서|즉)\s*[-+]?\d+(?:\.\d+)?(?:\s|$|[.,!?])/m.test(visible))
    return 'conclusion';
  // Equals signs frequently finish a multi-step calculation. The learner can
  // write the final equation herself; the tutor should ask for one next step.
  if (/\d\s*(?:=|＝)\s*[-+]?\d/.test(visible)) return 'worked-out-equation';
  const compactVisible = fold(visible);
  for (const supplied of privateAnswers) {
    if (typeof supplied !== 'string') continue;
    const answer = supplied.normalize('NFKC').trim();
    if (answer.length === 0 || answer.length > 160 || PLACEHOLDERS.test(answer)) continue;
    const compactAnswer = normalizeFinalAnswer(answer);
    if (!compactAnswer) continue;

    // Exact lexical answer (e.g. 직접민주주의); don't attempt to ban every
    // component word of a multi-word answer, which would hide useful concepts.
    if (/[^\d]/.test(compactAnswer) && compactAnswer.length >= 2 && compactVisible.includes(compactAnswer))
      return 'literal-answer';
    if (/^[가-힣]$/.test(compactAnswer)) {
      const singleWord = new RegExp(`(^|[^가-힣])${escapeRegex(compactAnswer)}(?:은|는|이|가|을|를|의|로|에서|에게|이다|이에요|예요)?(?=$|[^가-힣])`);
      if (singleWord.test(visible)) return 'single-word-answer';
    }
    // Single-number answers: 3, 6, 42; block bare digits even where the same
    // number appeared in the problem, so a hint cannot simply echo the result.
    const simpleNumber = answer.replace(/[,\s]/g,'').match(/^(-?\d+(?:\.\d+)?)\s*(?:개|명|점|원|cm|m|시간|분|초)?$/) ||
      answer.match(/(?:정답|결과|최대공약수|최소공배수|값)(?:은|는|이|가|:)\s*(-?\d+(?:\.\d+)?)(?:[가-힣\s.!?]*)$/);
    if (simpleNumber) {
      const n = Number(simpleNumber[1]);
      const numeric = new RegExp(`(^|[^\\d.])${escapeRegex(simpleNumber[1])}(?=$|[^\\d.])`);
      if (numeric.test(visible)) return 'numeric-answer';
      const spelling = spokenNumber(n);
      for (const word of spelling) {
        // Sino-Korean one-syllable number words are too common as ordinary
        // syllables; require a standalone word followed by a unit/particle.
        if (word.length < 2) {
          const pattern = new RegExp(`(^|[\\s({「“])${escapeRegex(word)}\\s*${QUANTITY}(?=$|[\\s).,!?:가-힣])`);
          if (pattern.test(visible)) return 'korean-number-answer';
        } else {
          const pattern = new RegExp(`(^|[^가-힣])${escapeRegex(word)}\\s*(?:${QUANTITY}|${END_WORD})(?=$|[^가-힣])`);
          if (pattern.test(visible)) return 'korean-number-answer';
        }
      }
      continue;
    }

    // Answers expressed as a number+unit (e.g. "10분") must not be shown.
    // Multi-part time answers can mention familiar conversion facts, but not
    // the entire answer or a distinctive new remainder.
    const answerNums = [...answer.matchAll(/(-?\d+(?:\.\d+)?)\s*(시간|분|초|점|개|명|원|cm|kg|km)?/g)];
    if (answerNums.length > 1) {
      for (const [,digit,unit] of answerNums) {
        // Allow foundational constants (1시간) when explaining unit conversion,
        // but never reveal a distinctive remainder or the complete answer.
        if (unit && Number(digit) === 1 && unit === '시간') continue;
        const originalHasExact = new RegExp(`${escapeRegex(digit)}\\s*${escapeRegex(unit || '')}(?!\\d)`).test(original);
        if (originalHasExact) continue;
        const hinted = new RegExp(`(^|[^\\d.])${escapeRegex(digit)}\\s*${escapeRegex(unit || '')}(?=$|[^\\d.])`);
        if (hinted.test(visible)) return 'answer-component';
      }
    }
  }
  return null;
}

export function answerCandidates(draft, review) {
  const candidates = [];
  for (const obj of [draft, review]) {
    if (!obj || typeof obj !== 'object') continue;
    for (const key of ['private_final_answer','private_answer']) {
      if (typeof obj[key] === 'string') candidates.push(obj[key]);
    }
    if (Array.isArray(obj.answer_aliases)) {
      for (const a of obj.answer_aliases.slice(0,6)) if (typeof a === 'string') candidates.push(a);
    }
  }
  return [...new Set(candidates.map(s=>s.trim()).filter(Boolean))].slice(0,12);
}
