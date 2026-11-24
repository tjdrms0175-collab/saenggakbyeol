# 생각별 선생님 v41 보안 피드백 점검 및 수정 기록

작성 기준: 2026-11-24, 제공된 화면 캡처·`웹 보안 스킬.md`·v40 소스. 외부 운영 서버와 GitHub 과거 커밋은 이 환경에서 접속 검증하지 못했습니다.

## 가장 먼저 확인할 사항: Gemini API 이용 약관

2026-03-23 시행 Gemini API Additional Terms의 **Age Requirements**는 Gemini API를 18세 미만을 대상으로 하거나 18세 미만이 접근할 가능성이 있는 앱에 사용하는 것을 제한합니다. **생각별은 초등학생 대상 앱이므로 공개 배포 전에 Google로부터 명확한 적용 여부를 확인하거나, 아동 대상 사용을 허용하는 다른 모델 제공 방식으로 설계를 변경해야 합니다.** 유료 Tier 1 및 보호자 동의만으로 해당 약관 제한이 해소된다고 가정하지 마세요.

공식 출처: https://ai.google.dev/gemini-api/terms

## 1. API 키 노출 점검

- 현재 검사한 v40/v41 GitHub 업로드용 소스의 `app.js`, `index.html`, 정적 파일 등에서 **실제 Gemini API 키 리터럴은 검출되지 않았습니다**. `GEMINI_API_KEY`라는 환경변수 **이름**은 공개 코드에 있지만 비밀 키 **값**과 다릅니다.
- `server.mjs`만 Render 환경변수를 읽고 `x-goog-api-key` 요청 헤더로 Gemini에 전송합니다. 외부 API 에러 메시지는 서버가 자체 생성해 사용자에게 돌려줍니다.
- `/api/provider-config`는 `configured: true/false`만 노출하며 비밀값을 반환하지 않습니다.
- 웹 서버는 명시적 정적 파일 화이트리스트만 사용하므로 `.env`, `.git/config`, `server.mjs`, `package.json`, SQL 파일, 소스맵은 정적으로 제공하지 않습니다. 로컬 통합 테스트에서 이 경로들이 404였습니다.
- **미확인**: GitHub 오래된 커밋/브랜치, 과거 스크린샷, Render 이전 로그, 현재 실서비스 HTTP 응답, Google 측 실제 유출 탐지 여부.
- **별개의 위험**: 익명 사용자가 공개 `/api/tutor`를 통해 사업자 API 키의 사용량을 소모하는 것은 여전히 가능하므로 키가 숨겨져 있어도 100% 도용 방지는 아닙니다. 비용 제한 + 계정/인증 강화가 필요합니다.
- 실제 키가 노출됐다는 신고를 받았다면, 키 값을 공유하지 말고 **새 Gemini 키 생성 → Render `GEMINI_API_KEY`만 교체 → 정상 동작 확인 → 기존 키 폐기**를 진행하십시오. 이미 유출이 확인된 경우에는 기존 키 즉시 차단을 우선하세요.

## 2. 이미지의 '괜찮았던 것' 확인

| 피드백 | v40 코드 확인 결과 | v41 조치 |
|---|---|---|
| CSP, iframe 차단, nosniff, HTTPS | 정적 페이지 CSP와 frame-ancestors 존재. API JSON은 no-store, nosniff 및 기본 CSP 설정 | API·정적 응답 모두 `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Resource-Policy`, 프로덕션 HSTS 적용 |
| `.git`, `.env`, 서버 파일 404 | 정적 화이트리스트가 있어 의도상 차단 | 가짜 키를 사용한 404 자동검사 추가 |
| 프론트에 API 키 없음 | 실제 값 없고 환경변수 이름만 있음 | 응답·정적 파일 비노출 자동검사 추가 |
| 다른 출처 403, 와일드카드 CORS 없음 | Origin 있는 교차 사이트 요청 차단. CORS `*` 없음 | `Sec-Fetch-Site: cross-site` 차단, API POST 전반 통일 |
| PIN·AI 질문 속도 제한 | 메모리 기반 시도 제한 + Supabase 원자적 일일 사용량 예약 존재 | 기존 제한 유지, 미인증 구조의 한계 명시 |
| XSS | 대부분 textContent, 개발자 고정 안내만 innerHTML | 동작 유지; 사용자 입력으로 HTML 만들지 않도록 지속 관리 |
| SSRF·입력 검증 | 이미지 포맷 제한, 서버 설정 방식의 FreeLLMAPI URL 검사. 브라우저 제공 custom URL은 제한적 HTTPS 도메인을 허용했음 | 프로덕션의 `custom` 프록시 주소는 운영자가 설정한 `CUSTOM_API_BASE_URL`에서만 읽게 변경. 기본 provider는 Gemini만 허용 |
| API 응답 캐싱·정답 공개 | no-store, 정답 공개 시 서버 힌트 5회 확인 | 유지. Render 재시작 시 힌트 진행 기록 초기화되는 제한은 남아 있음 |

## 3. 업로드된 보안 문서 항목 중 적용 / 보류

### 바로 적용(v41)
- 모든 API POST의 JSON Content-Type 검사(415), 교차 출처 Fetch Metadata 검사(403).
- 운영 기본 허용 AI 제공업체를 `gemini`로 제한; 추가 제공업체는 Render의 `AI_ALLOWED_PROVIDERS` 명시적 허용 필요.
- 브라우저에서 임의로 넣는 custom API URL 무시; 서버 `CUSTOM_API_BASE_URL` 설정만 허용.
- API JSON과 정적 파일에 동일한 보안 응답 헤더 적용.
- 가짜 비밀 키를 넣어도 HTML/JS/API JSON/404에서 노출되지 않는 로컬 통합 테스트 추가.

### 이미 구현되어 있거나 추가 작업 필요
- 기존 Supabase 예약 RPC는 동시 사용량 차감에 원자적 동작을 목표로 작성됨. 실제 운영 DB에 40개 동시 요청을 보내는 부하 테스트는 실행하지 않았음.
- Cookie는 HttpOnly, SameSite=Strict, 프로덕션 Secure. 그러나 이 PIN은 **같은 브라우저의 학부모 모드 잠금**이지 실제 보호자 신원 확인이나 회원 로그인은 아님.
- 현재 사용자별 제한은 IP 기반으로, 가족/학교의 같은 공인 IP 사용자는 한도를 공유할 수 있고 여러 네트워크로 변경 시 우회 가능. 인증 기반 제한은 차기 작업.
- 개발자 도구 차단·난독화는 비밀키 보호 수단이 아니며 웹앱 사용자 경험과 유지보수를 해칠 수 있어 기본 적용하지 않음.
- 본 서비스는 Render Web Service로 VPS를 직접 운영하지 않으므로 VPS SSH, fail2ban, systemd, 방화벽 체크는 해당하지 않음.
- 구글/카카오 로그인, 세션·OTP, 푸시, 웹훅, 쿠폰, SSRF 외부 이미지 링크 등 미구현 기능에 대한 체크리스트는 현 단계에 직접 적용하지 않음.
- Google Play 등록 전 아동 개인정보·법정대리인 확인·데이터 보유기간·삭제 신청 처리·신고 처리 운영 절차는 별도 필요.

## 4. 배포 절차

1. **백업**: GitHub에 현재 정상 동작 버전을 별도 태그 또는 ZIP으로 보관합니다.
2. 압축파일의 압축을 풀고 기존 GitHub 저장소 최상위에 업로드 후 Commit. Render가 새 커밋을 배포하도록 합니다.
3. Render > Deploys에서 Live 확인. 기존 `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, 사용량 제한 설정은 바꾸지 않습니다.
4. 새 변수 추가 불필요. 기본적으로 Gemini만 외부 공급자 호출에 허용됩니다. **FreeLLMAPI를 앱 UI에서 직접 사용해야 할 경우** 운영자가 `AI_ALLOWED_PROVIDERS=gemini,freellmapi`로 설정해야 합니다. 운영자가 직접 설정한 커스텀 외부 URL이 필요하다면 `CUSTOM_API_BASE_URL`도 함께 검토하고 구성해야 합니다.
5. 브라우저 새로고침 후 질문/사진/신고/학부모 모드를 테스트하고, Render Logs에 HTTP 415 또는 403 문제가 없는지 확인합니다.
6. 기존 비밀번호 cookie 암호화 키와 관련된 `APP_ACCESS_PIN` 또는 `ANSWER_PIN_SECRET`를 **검토 없이 삭제하지 마세요**. 기존 브라우저의 PIN 정보를 읽지 못할 수 있습니다.

**이번 버전에서 추가 SQL은 없습니다.** Supabase 데이터는 그대로 유지합니다.

## 5. 자동 시험 결과와 범위

- `npm run check` 성공.
- `npm test`: **101개 중 101개 통과** (v40 기존 98개 + 새 보안 검사 3개).
- 실제 운영 서버 테스트: **미수행** (접근 불가). 실제 사용자 기기·Play Store 테스트: **미수행**.
- 공개 저장소 과거 커밋과 라이브 API의 실제 키 유출 여부는 **미검증**.

## 6. 향후 가장 중요한 작업

1. **Gemini API 미성년자 접근 제한 조항 해소**: 아동 대상 서비스의 제공 모델/계약부터 확인. 해결 전 공개 배포 보류.
2. 보호자 인증/회원 및 익명 사용자별 사용량 관리 강화(공개 API 우회 비용 위험 축소).
3. 개인정보 처리방침 확정, 동의·삭제 절차 및 운영 문의 채널 구축.
4. 비용/사용량 경보와 이상 호출 모니터링.
