# 생각별 선생님 v37 — Gemini 사용량·자동 재시도 안전장치

이 파일은 `saenggakbyeol-main.zip`(v36)을 기준으로, 기존 기능을 유지하면서 서버 API 요청과 자동 재시도를 제한한 수정본입니다.

## 무엇을 고쳤나요?

- 같은 `retryRequestId`를 가진 성공한 질문의 재요청은 기존 답변을 돌려주며 **사용자별/전체 질문 한도를 또 차감하지 않습니다.**
- 브라우저 AI 연결 재시도는 **최초 1회 + 자동 재시도 최대 2회**로 종료합니다. HTTP 429는 자동 재시도하지 않으며, 사용자가 직접 새로 질문할 수 있습니다.
- Gemini 호출 횟수는 힌트 초안·독립 검토·사진 인식·정답 보기·모델 폴백·힌트 재생성까지 **서버의 실제 모델 요청 단위로 제한**합니다.
- 기본값: `GEMINI_DAILY_CALL_LIMIT=240`(UTC 하루), `GEMINI_HOURLY_CALL_LIMIT=80`(UTC 시간대), `GEMINI_MAX_CALLS_PER_OPERATION=6`(한 질문/사진/정답 작업).
- `APP_BUDGET_LIMIT`에 도달하면 **자동 재시도 불가 HTTP 429** 응답을 돌려주며, 예산 차단 상태를 단순히 Gemini 모델 429로 혼동해 다음 모델을 계속 호출하지 않습니다.
- 기존의 3.1 Flash-Lite → 3.5 Flash-Lite → 3.8 Flash 우선순위, 독립 힌트 검토, 학부모 모드, 사진 읽기 및 브라우저 음성 기능은 보존했습니다.
- v36 ZIP에서 누락된 테스트용 `mock-gemini-rate-limit.mjs`를 보충하고 `npm test`를 실제 존재하는 테스트 목록에 맞춰 복구했습니다.

## Render 설정 (선택)

기존 환경변수 `GEMINI_API_KEY`는 그대로 유지합니다. 필요하면 Render → Environment에서 아래 값을 조정할 수 있습니다.

```text
AI_CLIENT_HOURLY_LIMIT=40
AI_GLOBAL_DAILY_LIMIT=120
GEMINI_DAILY_CALL_LIMIT=240
GEMINI_HOURLY_CALL_LIMIT=80
GEMINI_MAX_CALLS_PER_OPERATION=6
```

Render 로그에서 `[gemini-budget]`은 Gemini **호출 횟수**, `[gemini-usage]`은 Gemini가 돌려준 토큰 사용량을 뜻합니다. 질문 내용·사진·키는 기록하지 않습니다. `GEMINI_USAGE_LOG=0`이면 두 로그를 끕니다.

**중요:** 이 제한은 현재 Node.js 서버 프로세스의 메모리에서 작동하며, **Render 재시작·새 배포·다중 서버 인스턴스 시 초기화**됩니다. 결제 금액에 대한 엄격한 보장이나 공격 방지는 아닙니다. 출시 전에는 계정 인증, 공유 저장소 기반 지속 사용량 기록, Google 측 예산 알림·결제 한도 관리가 필요합니다. 모델 한 번 호출할 때 소비하는 토큰은 다르므로 **호출 횟수 = 요금 상한**도 아닙니다.

## 배포 순서

1. GitHub 저장소를 백업합니다.
2. **전체 ZIP**을 압축 풀어 파일들을 GitHub 저장소 최상위에 덮어쓰거나, **변경 파일 ZIP**의 변경 파일만 동일한 경로에 업로드합니다.
3. GitHub `Commit changes`를 저장하고 Render에서 `Live` 배포 완료를 확인합니다.
4. 배포 주소의 `/api/health`에서 `version`이 `v37-usage-guard-...`로 시작하는지 확인합니다.
5. 설치형 앱을 닫았다가 다시 열고 질문·사진·음성·학부모 모드를 점검합니다.
6. Google AI Studio의 실제 사용량/요금과 Render 로그를 함께 확인합니다.

## 테스트

`npm run check` 통과, `npm test` **81개 전부 통과** (Gemini 실제 호출 없는 모의 테스트). 테스트는 정상 앱 동작의 모든 경우와 실제 판매 수준의 보안을 보장하지 않습니다.
