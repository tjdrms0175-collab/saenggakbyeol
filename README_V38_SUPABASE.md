# 생각별 선생님 v38 - Supabase 서울 DB에 사용량 보관

## 지금까지 완료된 작업

1. Supabase **saenggakbyeol-seoul** 프로젝트 생성 (서울 리전)
2. `public.daily_usage` 테이블 생성, RLS 활성화, anon/authenticated 권한 회수
3. Render > Environment 에 `SUPABASE_URL`과 `SUPABASE_SECRET_KEY` 저장
4. Render 환경변수 변경 배포 성공

**중요: 아직 SQL 함수가 만들어지지 않았습니다. 아래 순서대로 먼저 SQL, 나중에 소스 배포를 진행하세요.**

## 1단계: 서울 Supabase 프로젝트에서 SQL 실행

1. Supabase > **saenggakbyeol-seoul** > **SQL Editor** > **New** 로 이동합니다.
2. 이 ZIP 안의 `SUPABASE_SETUP_V38.sql`을 메모장으로 열고 **전체 내용을 복사**해 붙여 넣습니다.
3. `Run`을 클릭해 `Success. No rows returned` 결과를 확인합니다.
4. 이 SQL은 기존 테이블을 삭제하지 않고 원자적 사용량 차감 함수 `public.reserve_daily_usage`를 만듭니다.
5. 비밀 키나 비밀번호를 SQL 편집기, 캡처, GitHub에 붙여 넣지 마세요.

## 2단계: GitHub 전체 v38 소스 배포

1. GitHub 저장소의 기존 소스를 백업합니다.
2. 전체 ZIP은 압축 해제 후 저장소 루트에 업로드하거나, v38 패치 ZIP의 파일만 덮어씁니다.
3. `Commit changes`를 누르면 Render 자동 배포가 시작됩니다.
4. Render > Deploys 에서 새 커밋이 `Live`인지 확인합니다.
5. `https://saenggakbyeol.onrender.com/api/health`에서 `version`이 `v38-supabase-usage-`로 시작하고 `persistentUsage`가 `true`인지 확인합니다.
6. 앱에서 힌트 질문 1개와 사진 인식 1개를 실제 테스트합니다.
7. Supabase > Table Editor > `daily_usage`를 열고 오늘 날짜에 `global_public`, `global_gemini`, `ip_...` 행의 수치가 늘어났는지 확인합니다.

## 무엇이 달라졌나요?

- **서버 재시작 후에도** 한국 시간 기준 일별 요청/사진/모델 호출 기록이 Supabase에 유지됩니다.
- 각 요청을 `INSERT...ON CONFLICT DO UPDATE...WHERE` 한 번의 원자적 SQL로 차감하여 여러 요청이 동시에 들어와도 하루 한도를 초과해 저장하지 않습니다.
- `global_public`: 전체 앱 API 요청, `global_gemini`: 전체 Gemini 모델 호출, `ip_...`: IP 기반 익명 사용량 기록입니다.
- 사용자의 원본 IP, 실제 문제 내용, 사진은 사용량 테이블에 저장하지 않습니다. 해시값은 같은 네트워크 기기끼리 공유될 수 있습니다.
- 데이터베이스 오류, 잘못된 Secret key, RPC 함수 부재 시 **안전을 위해 AI 요청을 503으로 중지**합니다. 비밀 키는 서버의 `apikey` 헤더로만 전송합니다.
- 설정되지 않은 로컬 개발 환경은 기존 v37 메모리 기반 제한을 유지합니다.
- 모델 우선순위, 5회 힌트와 보호자 PIN, 사진 인식, 음성 UI는 그대로입니다.

## 기본 제한 (Render Environment 에서 선택 조정)

| 환경변수 | 기본값 | 의미 |
|---|---:|---|
| `AI_CLIENT_HOURLY_LIMIT` | 40 | IP별 시간당 API 요청 (메모리) |
| `AI_CLIENT_DAILY_LIMIT` | 40 | IP별 한국 시간 하루 전체 API 요청 |
| `AI_CLIENT_PHOTO_DAILY_LIMIT` | 5 | IP별 하루 사진 인식 |
| `AI_GLOBAL_DAILY_LIMIT` | 120 | 전체 사용자 하루 API 요청 |
| `GEMINI_DAILY_CALL_LIMIT` | 240 | 전체 Gemini 하루 실제 호출 횟수 |
| `GEMINI_CLIENT_DAILY_CALL_LIMIT` | 120 | IP별 Gemini 하루 실제 호출 횟수 |
| `GEMINI_HOURLY_CALL_LIMIT` | 80 | 서버 인스턴스당 Gemini 시간당 실제 호출 (메모리) |
| `GEMINI_MAX_CALLS_PER_OPERATION` | 6 | 한 작업의 Gemini 재시도/단계 호출 합계 |

- 한 문제의 힌트에는 초안과 검토 등 **여러 Gemini 호출**이 사용될 수 있습니다. 호출 횟수는 지출 금액 자체가 아니므로 Google AI Studio 결제 예산을 별도 관리하세요.
- 익명/IP 기반 제한은 **계정 기반 인증과 부정 사용 방지 기능을 대체하지 못합니다**. 공용 와이파이 및 이동통신망을 공유한 사용자는 같은 할당량을 사용할 수 있습니다.
- 최초 무료 배포의 안전장치이며 정식 공개 전 보호자 계정 인증, 아동 데이터 처리·삭제, 악용 방지, 모니터링 등을 추가해야 합니다.

## 검증

- `npm run check`: 통과
- `npm test`: **89개 통과** (로컬 모의 API 테스트; 실제 Supabase/Google API 접속은 포함하지 않음)
- 실제 Supabase SQL 실행 및 Render 연결 검증은 사용자가 1단계와 2단계를 완료한 뒤 확인해야 합니다.
