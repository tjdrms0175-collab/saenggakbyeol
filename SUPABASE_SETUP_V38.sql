-- 생각별 선생님 v38: 사용자별/전체 일일 사용량을 원자적으로 기록합니다.
-- 이미 생성한 public.daily_usage 테이블을 유지합니다.
-- Supabase 서울 프로젝트 -> SQL Editor -> New -> Run
-- 이 SQL은 사용자 데이터를 삭제하지 않습니다.
CREATE TABLE IF NOT EXISTS public.daily_usage (
  client_id TEXT NOT NULL,
  usage_date DATE NOT NULL,
  question_count INTEGER NOT NULL DEFAULT 0 CHECK (question_count >= 0),
  hint_count INTEGER NOT NULL DEFAULT 0 CHECK (hint_count >= 0),
  photo_count INTEGER NOT NULL DEFAULT 0 CHECK (photo_count >= 0),
  api_request_count INTEGER NOT NULL DEFAULT 0 CHECK (api_request_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (client_id, usage_date)
);
ALTER TABLE public.daily_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_usage FROM anon, authenticated;

-- SECURITY INVOKER: 오직 서버 전용 secret(service_role)만 실행 가능.
-- 정해진 네 가지 열 이름만 허용하여 동적 SQL 인젝션을 차단합니다.
CREATE OR REPLACE FUNCTION public.reserve_daily_usage(
  p_client_id text, p_metric text, p_max integer
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_column text;
  v_success boolean;
BEGIN
  IF p_client_id IS NULL OR length(p_client_id) > 100 OR length(p_client_id) < 3
     OR p_max IS NULL OR p_max < 1 OR p_max > 100000 THEN
    RETURN false;
  END IF;
  v_column := CASE p_metric
    WHEN 'question' THEN 'question_count'
    WHEN 'hint' THEN 'hint_count'
    WHEN 'photo' THEN 'photo_count'
    WHEN 'api' THEN 'api_request_count'
    ELSE NULL
  END;
  IF v_column IS NULL THEN RETURN false; END IF;
  EXECUTE format(
    'INSERT INTO public.daily_usage AS u (client_id, usage_date, %1$I, updated_at)
       VALUES ($1, (now() AT TIME ZONE ''Asia/Seoul'')::date, 1, now())
     ON CONFLICT (client_id, usage_date)
     DO UPDATE SET %1$I = u.%1$I + 1, updated_at = now()
       WHERE u.%1$I < $2
     RETURNING true', v_column
  ) INTO v_success USING p_client_id, p_max;
  RETURN COALESCE(v_success, false);
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_daily_usage(text,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_daily_usage(text,text,integer) TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.daily_usage TO service_role;
