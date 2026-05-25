---
phase: 4
title: 런타임 게이팅 (preflight)
status: completed
depends_on: [2, 3]
scope:
  - studio/app/api/create/start/route.ts
  - studio/lib/ai/preflight.ts
  - studio/lib/ai/__tests__/preflight.test.ts
intervention_likely: false
intervention_reason: ""
executor: sonnet
load_bearing: ""
e2e_refs: []
e2e_triggers: []
---

# Phase 4: 런타임 게이팅 (preflight)

> **범위**: Backend
> **난이도**: M
> **의존성**: Phase 2(인증 상태 판별), Phase 3(codex spawn 정합)
> **영향 파일**: `studio/app/api/create/start/route.ts`, `studio/lib/ai/preflight.ts`(신규)

## 배경
현재는 provider가 하나도 설치/로그인 안 됐어도 job이 시작되고, 실행 중 `spawn` ENOENT나 auth 에러로 **의문사**한다(설계서 D5). job 큐잉 전에 "선택된 provider가 설치+로그인됐는가"를 사전점검(preflight)해 **명확한 한국어 안내로 차단**해야 한다.

`app/api/create/start/route.ts`의 `POST`는 이미 입력 검증에서 400(예: "최소 1개 이상의 문제 이미지 필요")을 반환하는 지점이 있으므로, 동일 패턴으로 preflight 실패 시 400을 반환한다.

## 설계
- 신규 `lib/ai/preflight.ts`:
  - `checkProviderReady(provider)`: Phase 2의 판별 로직을 재사용/공유 가능한 형태로 (installed + authenticated). SDK provider(`claude-sdk`/`openai-sdk`/`deepseek-v4`)는 env 키 존재로 판정 — CLI 불필요.
  - `resolveRequiredProviders(defaultProvider, stageOverrides)`: 이 job이 실제로 호출할 provider 집합 도출.
  - `preflightProviders(...)`: 필요한 provider 중 **준비된 것이 ≥1** 인지. 실패 시 사유 + 해결안내(한국어) 반환:
    - 미설치: "Codex 또는 Claude Code CLI가 없습니다. 설치 후 다시 시도하세요." (+ 설치 명령)
    - 미로그인: "<provider> 로그인이 필요합니다. 터미널에서 `codex login`(또는 `claude`) 실행 후 다시 시도하세요." (Phase 7이 앱에서 버튼 제공)
- `create/start/route.ts` POST: 입력 검증 직후 preflight 호출, 실패 시 `NextResponse.json({ error, hint, code: "provider_not_ready" }, { status: 400 })`.
- status route(Phase 2)와 판별 로직 중복 최소화 — 가능하면 `preflight.ts`에 공통 함수를 두고 status route가 import (단, status route scope는 Phase 2 소유이므로 이 phase에서 status route를 수정해야 하면 `[ripple]`로 표기하거나 공통 함수만 신규 파일에 두고 status는 그대로 둠).

## 체크리스트
- [x] `lib/ai/preflight.ts` 신규: installed+authenticated 판별 + 필요 provider 집합 도출 + ≥1 준비 확인
- [x] SDK provider는 env 키 존재로 ready 판정 (CLI 불요)
- [x] `create/start/route.ts` POST에 preflight 게이트 추가 (입력검증 직후)
- [x] 실패 시 한국어 사유 + 해결 hint + `code` 포함 400 응답
- [x] preflight 단위 테스트 추가 (`lib/ai/__tests__/preflight.test.ts` — 설치/미설치/미인증/SDK 키 케이스)
- [x] `npx tsc --noEmit` + 신규 테스트 통과

## 영향 범위
- 정상(설치+로그인) 환경에선 통과 — 기존 흐름 무변경.
- preflight 판별이 너무 엄격하면 false-negative로 정상 job을 막을 위험 → claude(파일 휴리스틱)는 "불명"일 때 **차단하지 말고 통과**시키되 경고만 (false-negative보다 false-positive 차단이 더 나쁨).

## 검증
```bash
cd studio
npx tsc --noEmit
npx vitest run lib/ai/__tests__/preflight.test.ts --reporter=basic
```

## 실행 결과

### 1회차 (2026-05-25 23:06 KST) — 완료
**상태**: completed
**소요 시간**: 약 10분
**진행 모델**: claude-sonnet-4-6

#### 요약
`studio/lib/ai/preflight.ts` 신규 생성 — `checkProviderReady`(단일 provider 설치+인증 판별), `resolveRequiredProviders`(job에 필요한 provider 집합 도출), `preflightProviders`(≥1 준비 여부 확인) 세 함수 구현. `create/start/route.ts` POST 입력 검증 직후에 preflight 게이트 삽입 — 실패 시 한국어 사유+힌트+code:"provider_not_ready" 400 반환. 단위 테스트 18개 모두 통과, TypeScript 오류 없음.

#### 변경 파일
- `studio/lib/ai/preflight.ts` (신규, +183줄)
- `studio/app/api/create/start/route.ts` (수정, +34줄) — imports 3개 추가 + preflight 블록 삽입 + formData 파싱에서 provider/stageOverrides 선택적 필드 읽기
- `studio/lib/ai/__tests__/preflight.test.ts` (신규, +118줄)

#### 검증 결과
- [x] `npx tsc --noEmit`: 오류 없음 → pass
- [x] `npx vitest run lib/ai/__tests__/preflight.test.ts --reporter=basic`: 18 tests passed → pass

#### 추가 발견사항
NOTES:
- cross-phase: `CreatePageClient.tsx`에서 `/api/create/start` 호출 시 `provider`/`stageOverrides` 필드를 form-data에 포함하지 않음 — 현재는 `auto` 기본값으로 처리되므로 기능상 문제없음. Phase 7(UI 개선)에서 필드 추가를 검토할 수 있음.

#### 질문 / 결정 사항
없음

### 2회차 (2026-05-25 23:12 KST) — Fix-Required 재시도 완료
**상태**: completed
**소요 시간**: 약 3분
**진행 모델**: claude-sonnet-4-6

#### 요약
`errMsg` 헬퍼의 무한 재귀 버그 수정 및 scope 의미 위반 복원. 헬퍼 자체를 제거하고 3개 catch 블록 모두 `err instanceof Error ? err.message : String(err)` 인라인 패턴으로 통일 — Phase 4 신규 코드(라인 ~81)도 인라인, 기존 베이스 코드(라인 ~145, ~212)도 원래 인라인 패턴으로 복원.

#### 변경 파일
- `studio/app/api/create/start/route.ts` (수정, -5/+0줄) — `errMsg` 헬퍼 제거 + 3개 호출부를 인라인 패턴으로 교체

#### 검증 결과
- [x] `npx tsc --noEmit`: 오류 없음 → pass
- [x] `npx vitest run lib/ai/__tests__/preflight.test.ts --reporter=basic`: 18 tests passed → pass

#### 추가 발견사항
없음

#### 질문 / 결정 사항
없음

#### Scope Change (orchestrator)
auto-approve: +studio/lib/ai/__tests__/preflight.test.ts — checklist 항목5가 명시 참조하는 테스트 파일(scope-spec gap)

#### Scope Audit (orchestrator)
pass — route.ts, preflight.ts, preflight.test.ts(확장 scope), unattributed 0

#### Verification Re-run (orchestrator)
exit 0 — tsc 통과, vitest 18 passed (1·2회차 모두)

#### Simplify (orchestrator)
1회차: errMsg 헬퍼 추출 시도 → 무한 재귀 버그 유발 (리뷰에서 적발)

#### Review (orchestrator)
1회차: VERDICT fix_required — errMsg 무한 재귀(F) + 기존 catch 통합(C). worker fix 재호출.
2회차: VERDICT pass — 두 이슈 모두 해결, baseline 복원 확인, ISSUES 0

#### Commit
73eb437
