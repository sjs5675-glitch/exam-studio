---
phase: 7
title: 앱 로그인 런처 + 프론트 배너
status: completed
depends_on: [2, 4]
scope:
  - studio/app/api/provider-login/route.ts
  - studio/app/page.tsx
intervention_likely: true
intervention_reason: "수동 QA — 터미널 팝업/로그인 후 배너 해제 육안 확인. Windows 팝업 경로는 Mac에서 검증 불가."
executor: sonnet
load_bearing: ""
e2e_refs: []
e2e_triggers: []
---

# Phase 7: 앱 로그인 런처 + 프론트 배너

> **범위**: Backend(API route) + Frontend
> **난이도**: M
> **의존성**: Phase 2(authenticated 상태), Phase 4(게이팅 메시지 일관성)
> **영향 파일**: `studio/app/api/provider-login/route.ts`(신규), `studio/app/page.tsx`

## 배경
설치는 됐지만 로그인 안 된 상태를, 앱에서도 감지해 **"로그인 필요" 배너 + 버튼**으로 안내하고(D4·D5), 버튼을 누르면 **보이는 터미널을 띄워** 대화형 로그인을 시작한다. 헤드리스 호출은 TTY가 없어 로그인을 못 하므로, 로컬 Node 서버가 별도 터미널 창을 spawn해야 한다.

`app/page.tsx`는 이미 `/api/status`를 fetch해 "시스템 상태" 카드(`ProviderStatusRow`)를 그린다 → Phase 2가 추가한 `authenticated`를 소비.

## 설계

### `app/api/provider-login/route.ts` (신규)
- `POST { provider: "codex" | "claude" }` → OS별 대화형 터미널 spawn:
  - Windows: `spawn("cmd.exe", ["/c", "start", "", "cmd", "/k", loginCmd])` (새 콘솔 창)
  - macOS: `spawn("open", ["-a", "Terminal"])` 로는 명령 전달이 어려움 → `osascript -e 'tell app "Terminal" to do script "codex login"'` 사용.
  - loginCmd: codex=`codex login`, claude=`claude`.
- 로컬 전용(localhost) 동작이므로 인증 불필요하나, provider 화이트리스트로 임의 명령 주입 방지 (codex/claude만 허용).
- 응답: `{ launched: true }` 또는 실패 사유.

### `app/page.tsx`
- `systemStatus`에서 각 provider `authenticated` 확인.
- 설치됨(`available`) && 미인증(`!authenticated`)인 provider가 있으면 상단/카드에 **경고 배너**: "OO 로그인이 필요합니다 [로그인]".
- 버튼 → `POST /api/provider-login` → 안내 토스트("터미널에서 브라우저 로그인을 완료한 뒤 새로고침하세요").
- 미설치(`!available`)는 배너 대신 설치 안내(부트스트랩/installer 문구) — 기존 status 카드의 빨강 점으로 충분하면 최소화.

## 체크리스트
- [x] `api/provider-login/route.ts` 신규: provider 화이트리스트 + OS별 터미널 spawn (win `start cmd /k`, mac `osascript ... do script`)
- [x] `page.tsx`: `authenticated` 소비 — 설치됨+미인증 시 "로그인 필요" 배너+버튼
- [x] 버튼 → `/api/provider-login` 호출 + "로그인 완료 후 새로고침" 안내
- [x] 임의 명령 주입 방지 (provider enum만 허용)
- [x] `npx tsc --noEmit` 통과
- [ ] macOS 실기: 미로그인 상태에서 배너 노출 → 버튼 → Terminal 창에서 `codex login` 뜸 → 로그인 후 새로고침 시 배너 사라짐

## 영향 범위
- `page.tsx`는 기존 status 카드에 배너 추가 — 레이아웃 영향 최소.
- Windows 팝업 경로(`start cmd /k`)는 **실기 스모크 필요**.
- 보안: provider 화이트리스트로 셸 인젝션 차단 (사용자 입력을 명령에 직접 넣지 않음).

## 검증
```bash
cd studio
npx tsc --noEmit
# 수동: codex logout 후 앱 새로고침 → 배너 → 버튼 → Terminal codex login → 로그인 → 새로고침 배너 해제
```

## 실행 결과

### 1회차 (2026-05-25 오늘) — completed
**상태**: completed
**소요 시간**: 약 10분
**진행 모델**: claude-sonnet-4-6

#### 요약
`studio/app/api/provider-login/route.ts`를 신규 생성해 provider 화이트리스트(codex/claude만 허용) + OS별 터미널 spawn을 구현했다. `studio/app/page.tsx`는 `SystemStatus` 인터페이스에 `authenticated` 필드를 추가하고, 설치됨+미인증 provider마다 황색 경고 배너+로그인 버튼을 렌더링한다. 버튼 클릭 시 `/api/provider-login` POST + 6초 토스트("터미널에서 브라우저 로그인 완료 후 새로고침")를 표시한다.

#### 변경 파일
- `studio/app/api/provider-login/route.ts` (신규, +48줄)
- `studio/app/page.tsx` (수정, +45/-1줄)

#### 검증 결과
- [x] `npx tsc --noEmit`: `cd studio && npx tsc --noEmit` → 출력 없음(pass)
- [ ] macOS 실기 (미로그인 → 배너 → 버튼 → Terminal codex login → 새로고침 배너 사라짐): 수동 QA 필요 — 로컬 앱 기동 + codex logout 상태가 필요해 자동화 불가

#### 추가 발견사항
없음

#### 질문 / 결정 사항
- macOS 실기 QA (체크리스트 마지막 항목)는 사용자가 직접 수행해야 함. Windows `start cmd /k` 경로는 Mac 환경에서 검증 불가.


#### Scope Audit (orchestrator)
pass — page.tsx, api/provider-login/route.ts (scope), unattributed 0

#### Verification Re-run (orchestrator)
exit 0 — npx tsc --noEmit 통과. 터미널 팝업/배너 해제 육안 QA + Windows 팝업은 수동 게이트 이월 (partial 정합)

#### Simplify (orchestrator)
1 file, 1 edit — route.ts 불필요 as 단언 제거, page.tsx는 프론트 안전상 skip, VERIFY pass

#### Review (orchestrator)
VERDICT pass — F(보안: LOGIN_CMDS 화이트리스트, injection 경로 없음, OS 분기) + H(authenticated 실존) 검수 통과, ISSUES 0

#### Commit
e872bc5
