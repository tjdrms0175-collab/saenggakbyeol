-- 생각별 선생님 v39 AI 답변 신고 저장소
-- v38 서울 프로젝트의 daily_usage는 삭제하거나 변경하지 않습니다.
-- SQL Editor > New > 이 내용 전체 붙여넣기 > Run
CREATE TABLE IF NOT EXISTS public.ai_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reason text NOT NULL CHECK (reason IN ('unsafe','offensive','incorrect','privacy','other')),
  answer_excerpt text CHECK (answer_excerpt IS NULL OR char_length(answer_excerpt) <= 600),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewed','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

ALTER TABLE public.ai_reports ENABLE ROW LEVEL SECURITY;
-- 클라이언트에서 보고서/원본 답변을 조회하거나 쓸 수 없습니다.
REVOKE ALL ON public.ai_reports FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_reports TO service_role;

COMMENT ON TABLE public.ai_reports IS 'AI 답변 신고: 사유 및 사용자가 명시적으로 동의한 AI 답변 일부만 저장. 질문, 사진, 사용자 IP, 계정 ID는 저장하지 않음';
