/**
 * Saenggakbyeol v39: privacy-minimized AI-answer reports.
 * Only a reason and an optional, user-approved snippet of AI output are sent
 * to server-owned Supabase; learner input, image, cookie, and IP are omitted.
 */
import {storageConfig} from './supabase-usage.mjs';

export const REPORT_REASONS=Object.freeze(['unsafe','offensive','incorrect','privacy','other']);
export class ReportStorageError extends Error {
  constructor(){super('신고를 저장할 수 없어요.');this.code='REPORT_STORAGE_UNAVAILABLE';}
}
export async function submitAiReport({reason,answerExcerpt=null},env=process.env,fetchImpl=globalThis.fetch){
  if (!REPORT_REASONS.includes(reason) ||
      (answerExcerpt!==null && (typeof answerExcerpt!=='string' || answerExcerpt.length>600)))
    throw new TypeError('Invalid AI report');
  let config;
  try {config=storageConfig(env);}catch{throw new ReportStorageError();}
  if(!config)throw new ReportStorageError();
  let response;
  try {
    response=await fetchImpl(config.base+'/rest/v1/ai_reports',{
      method:'POST',
      headers:{apikey:config.key,'Content-Type':'application/json','Prefer':'return=minimal'},
      body:JSON.stringify({reason,answer_excerpt:answerExcerpt||null}),
      signal:AbortSignal.timeout(5000),redirect:'error',
    });
  } catch {throw new ReportStorageError();}
  if (!response.ok) throw new ReportStorageError();
  return true;
}
