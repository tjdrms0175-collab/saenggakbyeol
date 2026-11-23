# 생각별 선생님 v36 — Gemini Tier 1 비용 최적화

기준: 생각별 선생님 v35 전체 프로젝트. GitHub용 ZIP 파일의 파일은 저장소 최상위에 업로드하세요.

## 모델 우선순위

1. `gemini-3.1-flash-lite` (기본)
2. `gemini-3.5-flash-lite` (첫 모델이 HTTP 429 사용량 제한에 걸렸을 때)
3. `gemini-3.8-flash` (앞의 두 모델이 429일 때)

모델은 서버가 선택합니다. 실제 모델명이나 사용 가능 여부는 Google AI Studio에서 확인해야 합니다. 3.1이 평소에 작동하면 3.5/3.8로 단순히 답변 품질 때문에 넘어가지 않습니다. 503은 기존 자동 재연결을 사용하며, 401·403 같은 인증 오류는 모델을 바꿔 해결하지 않습니다.

## 토큰 최적화

- `generationConfig.thinkingConfig.thinkingLevel`: Flash-Lite 두 모델은 `minimal`, 3.8 Flash는 `low`.
- `maxOutputTokens`: 일반 힌트 초안 1450, 검토 1250, 사진 인식 1700, 보호자 정답 초안 750, 정답 검토 500. 이는 **최댓값**일 뿐 사용량을 보장하지 않습니다.
- 2차 검토에서 1차 튜터의 긴 공통 페르소나를 다시 보내지 않고 안전·학년·과목 검토 규칙을 압축합니다.
- 최근 대화는 필요한 최신 6개 메시지, 각 420자 이내로 전달합니다. 원래 문제 문장은 별도로 유지합니다.
- 사진은 v34부터 도입된 방식대로 처음 한 번 읽고 사용자가 확인한 텍스트로 이후 힌트를 진행합니다.
- 원래의 2단계 AI 독립 검토·정답 노출 검사·학부모 비밀번호·학년별 지도·재시도 기능은 유지합니다. 문제에 따라 검증 실패 시 추가 AI 호출이 발생할 수 있습니다.
- Gemini API가 `usageMetadata`를 반환하면 Render Logs에 `[gemini-usage] model=... stage=... input=... output=... thinking=... total=...`로 기록합니다. 질문/사진/API 키는 로깅하지 않습니다. 로그를 끄려면 Render 환경변수 `GEMINI_USAGE_LOG=0`으로 설정하세요.

## 배포

1. GitHub에서 현재 저장소를 먼저 백업합니다.
2. `saenggakbyeol_v36_github_cost_opt.zip` 압축을 풀어 나온 파일들을 GitHub 저장소 **최상위**에 업로드하고 기존 파일을 교체합니다.
3. `Commit changes`를 누릅니다. Render 자동 배포가 `Live`가 될 때까지 배포 상태를 확인합니다.
4. 갤럭시 설치형 PWA를 완전히 닫았다가 다시 실행합니다. 캐시 버전을 올려 새 파일을 받도록 했습니다.
5. 같은 과학·수학 문제에서 힌트, 중간 답 판정, 학부모 정답 보기, 사진 읽기를 확인합니다.
6. Render Logs에서 Gemini 모델명과 토큰을 확인하고 Google AI Studio Usage와 요금을 교차 확인합니다.

기존 `GEMINI_API_KEY`는 그대로 사용합니다. 계정의 Tier 1 여부, 모델별 사용 가능 지역·가격, 실제 토큰 비용은 Render에서 알 수 없으므로 Google AI Studio에서 확인하세요.

## 테스트

`npm run check` 및 `npm test`를 수행했습니다. 전체 107개 테스트는 실제 Gemini를 호출하지 않는 모의 서버 테스트이며, 실제 학습 응답의 품질과 요금은 배포 후 점검해야 합니다.
