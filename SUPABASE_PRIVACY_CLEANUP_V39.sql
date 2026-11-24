-- 선택형 정기 정리 SQL: 월 1회 운영자가 검토 후 수동으로 실행합니다.
-- 실행 전에 필요한 데이터를 백업하세요. 삭제 후 복구할 수 없습니다.
-- 아래는 90일이 지난 신고 내역 및 이용량 집계만 삭제합니다.
-- 이 파일을 실행하지 않으면 자동 삭제되지 않습니다.
DELETE FROM public.ai_reports WHERE created_at < now() - interval '90 days';
DELETE FROM public.daily_usage WHERE usage_date < (now() AT TIME ZONE 'Asia/Seoul')::date - 90;
