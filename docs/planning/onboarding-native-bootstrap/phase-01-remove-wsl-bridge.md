---
phase: 1
title: WSL 브리지 제거 (실행 경로)
status: completed
depends_on: []
scope:
  - studio/lib/claude.ts
  - studio/server/sse.ts
intervention_likely: false
intervention_reason: ""
executor: sonnet
load_bearing: ""
e2e_refs: []
e2e_triggers: []
---

# Phase 1: WSL 브리지 제거 (실행 경로)

> **범위**: Backend
> **난이도**: M
> **의존성**: 없음
> **영향 파일**: `studio/lib/claude.ts`, `studio/server/sse.ts`

## 배경
배포 타깃을 **Windows/macOS 네이티브**로 확정(설계서 D2). 현재 `lib/claude.ts`는 Windows에서 `wsl.exe -- bash -lc "… claude …"`로 우회 실행하고, `C:\…` ↔ `/mnt/c/…` 경로 변환(`toWslPath`/`fromWslPath`)을 거친다. 네이티브 claude는 `C:\` 경로를 그대로 이해하므로 이 브리지 레이어 전체가 불필요하다. 이 레이어는 오케스트레이터·stage 로직과 무관한 **얇은 실행 경로**라, 제거가 곧 단순화다.

확인된 사실:
- `toWslPath`/`fromWslPath`는 `lib/claude.ts`(정의 + spawn 내부 사용)와 `server/sse.ts`(import) **두 곳에서만** 사용됨 (grep 확인).
- `lib/__tests__/claude.test.ts`는 WSL 경로 변환을 테스트하지 않음 (관련 import 없음).

## 설계

### `lib/claude.ts`
- spawn 분기 (현재 237~249줄) 를 **네이티브 단일화**:
  ```ts
  const proc = spawn("claude", claudeArgs, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  ```
  → `IS_WINDOWS ? spawn("wsl.exe", […]) : …` 삼항 제거.
- `toWslPath`/`fromWslPath` 함수 정의 + export 제거.
- `IS_WINDOWS`, `shellEscape`, `shellEnvPrefix` 가 **WSL 분기 제거 후 미사용**이 되면 함께 제거 (사용처가 WSL 분기뿐이었다면). `os` import도 다른 사용 없으면 제거. ※ 실제 잔여 사용 여부를 grep으로 확인 후 결정 — 다른 곳에서 쓰면 남길 것.

### `server/sse.ts`
- `import { toWslPath, fromWslPath, … }` 에서 두 항목 제거.
- `toAbsWsl`(369~373줄): WSL 변환 제거 → 절대경로만:
  ```ts
  const toAbs = (p: string) => (!p ? "" : path.isAbsolute(p) ? p : path.join(BASE_DIR, p));
  ```
  호출부 `wslFiles` → 이름은 유지하되 `toAbs` 사용 (또는 변수명 정리, scope 내).
- 출력경로 역변환(538줄 `fromWslPath(outputFile)`) 제거 — 네이티브는 변환 불필요.

## 체크리스트
- [x] `lib/claude.ts` spawn을 네이티브 `spawn("claude", …)` 단일 경로로 변경 (wsl.exe 분기 제거)
- [x] `lib/claude.ts`에서 `toWslPath`/`fromWslPath` 및 WSL 전용 미사용 헬퍼 제거
- [x] `server/sse.ts` import + `toAbsWsl`(절대경로화) + 출력경로 역변환 제거
- [x] `grep -rn "wsl\|toWslPath\|fromWslPath" studio/lib/claude.ts studio/server/sse.ts` 잔여 0
- [x] `npx tsc --noEmit` 통과
- [x] `npx vitest run lib/__tests__/claude.test.ts --reporter=basic` 통과

## 영향 범위
- 실행 경로만 변경. 오케스트레이터/stage/프롬프트 무영향.
- **Windows 회귀 위험**: 이 phase 후 Windows에서 claude 실행은 네이티브 `claude`를 PATH에서 찾음 → Phase 5(installer)가 네이티브 claude를 설치해야 비로소 Windows 동작. Mac은 즉시 정상.
- 롤백: git revert (단일 커밋).

## 검증
```bash
cd studio
npx tsc --noEmit
npx vitest run lib/__tests__/claude.test.ts --reporter=basic
grep -rn "wsl" lib/claude.ts server/sse.ts || echo "WSL 잔여 없음"
```

## 실행 결과

### 1회차 (2026-05-25 22:38 KST) — completed
**상태**: completed
**소요 시간**: 약 5분
**진행 모델**: claude-sonnet-4-6

#### 요약
`lib/claude.ts`에서 `toWslPath`, `fromWslPath`, `IS_WINDOWS`, `shellEscape`, `shellEnvPrefix` 및 `os` import를 제거하고 spawn 분기를 네이티브 단일 경로로 단순화했다. `server/sse.ts`에서 두 경로변환 함수 import를 제거하고, `toAbsWsl` → `toAbs` 로 교체, 변수명 `wslFiles` → `absFiles` 로 정리, `fromWslPath(outputFile)` 역변환 라인을 제거했다.

#### 변경 파일
- `studio/lib/claude.ts` (수정, -38/+1줄) — WSL 경로변환·헬퍼·IS_WINDOWS·os import 전체 제거, spawn 네이티브 단일화
- `studio/server/sse.ts` (수정, -8/+4줄) — toWslPath/fromWslPath import 제거, toAbs 함수로 교체, fromWslPath 역변환 제거

#### 검증 결과
- [x] WSL 잔여 grep: `grep -rn "wsl" lib/claude.ts server/sse.ts` → pass (echo "WSL 잔여 없음")
- [x] tsc: `npx tsc --noEmit` → pass (출력 없음)
- [x] vitest: `npx vitest run lib/__tests__/claude.test.ts --reporter=basic` → pass (20 tests passed)

#### 추가 발견사항
없음

#### 질문 / 결정 사항
없음

#### Scope Audit (orchestrator)
pass — 2 files in scope (lib/claude.ts, server/sse.ts), unattributed 0

#### Verification Re-run (orchestrator)
exit 0 — tsc 통과, vitest 20 passed, wsl grep 잔여 없음

#### Simplify (orchestrator)
1 file, 1 edit — `path.basename` 재사용 (동작 동일), VERIFY pass

#### Review (orchestrator)
VERDICT pass — A~I 전부 OK, ISSUES 0

#### Commit
f77ef5a
