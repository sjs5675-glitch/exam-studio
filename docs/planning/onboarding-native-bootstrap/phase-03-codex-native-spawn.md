---
phase: 3
title: codex 네이티브 spawn 보정 (.cmd shim)
status: completed
depends_on: []
scope:
  - studio/lib/ai/providers/codexCli.ts
  - studio/lib/__tests__/providerCodex.test.ts
intervention_likely: true
intervention_reason: "Windows 실기 스모크 필요 (Mac 개발기에서 codex .cmd spawn 검증 불가)"
executor: sonnet
load_bearing: "spawn 바이너리 해석(Windows .cmd) 교체가 핵심; 나머지는 무변경"
e2e_refs: []
e2e_triggers: []
---

# Phase 3: codex 네이티브 spawn 보정 (.cmd shim)

> **범위**: Backend
> **난이도**: S
> **의존성**: 없음
> **영향 파일**: `studio/lib/ai/providers/codexCli.ts`

## 배경
`codexCli.ts`는 이미 네이티브 `spawn("codex", args, …)`를 쓴다(WSL 분기 없음). 그러나 npm 전역 설치(`npm i -g @openai/codex`) 시 Windows에서 PATH에 놓이는 것은 `codex.cmd`(또는 `codex.ps1`) **shim**일 수 있다. Node `child_process.spawn`은 Windows에서 `shell:false`(기본)일 때 `.cmd`를 직접 실행하지 못해 `ENOENT`가 날 수 있다. → Windows에서 codex가 "설치됐는데 실행 실패"하는 함정.

## 설계
- Windows에서만 spawn 대상 바이너리/옵션을 보정. macOS/Linux는 현행 유지(회귀 0 목표).
  - 방법 택1 (둘 중 안전한 쪽 선택, 근거를 실행 결과에 기록):
    1. `process.platform === "win32"`일 때 커맨드를 `"codex.cmd"`로 지정.
    2. 또는 spawn 옵션에 `shell: true` (Windows 한정). 단 `shell:true`는 인자 이스케이프 이슈가 있으므로, 프롬프트가 인자 배열로 전달되는 현 구조에서 안전한지 검토 후 적용. **가능하면 (1) `.cmd` 명시 + `shell:false` 유지**가 인자 안전.
- `--version`/spawn 외 다른 로직(idle timeout, stderr passthrough, JSON 파싱)은 **무변경**.
- `@openai/codex`는 Node ≥22 요구 — 이건 Phase 5(installer)에서 보장. 이 phase는 spawn 해석만.

## 체크리스트
- [x] Windows에서 codex shim(`.cmd`) 실행되도록 spawn 대상/옵션 보정 (`win32` 분기)
- [x] macOS/Linux 경로 무변경 (회귀 0)
- [x] 변경 방식(`.cmd` 명시 vs `shell:true`) 선택 근거를 실행 결과에 1줄 기록
- [x] `npx vitest run lib/__tests__/providerCodex.test.ts --reporter=basic` 통과
- [x] `npx tsc --noEmit` 통과

## 영향 범위
- macOS 회귀 없음이 1차 검증. **Windows 실제 동작은 실기 스모크 필요** (이 phase는 코드만; 검증은 공통 체크리스트의 Windows 스모크 항목으로 이월).
- 롤백: 단일 파일 revert.

## 검증
```bash
cd studio
npx tsc --noEmit
npx vitest run lib/__tests__/providerCodex.test.ts --reporter=basic
```
Windows 실기 (수동):
```
codex exec --json --sandbox danger-full-access -- "echo hello"
# studio에서 codex provider로 문제 1건 추출 스모크
```

## 실행 결과

### 1회차 (2026-05-25 22:49 KST) — completed
**상태**: completed
**소요 시간**: 약 5분
**진행 모델**: claude-sonnet-4-6

#### 요약
`codexCli.ts`의 `run()` 내부에 `getCodexBin()` export 헬퍼를 추출하고, Windows(`win32`)에서 `"codex.cmd"`를 반환하도록 구현했다. macOS/Linux는 기존 `"codex"` 그대로 유지(회귀 0). spawn은 `shell:false` 기본값 유지 — 인자가 배열로 전달되는 현 구조에서 이스케이프 이슈 없이 가장 안전함. 테스트 10개 모두 통과.

**방법 선택 근거**: `.cmd` 명시 + `shell:false` 유지 — 프롬프트를 포함한 인자가 배열(`args[]`)로 전달되어 있어 `shell:true` 시 발생하는 특수문자 이스케이프 문제를 회피할 수 있고, Node spawn의 표준 동작(`.cmd` 직접 실행 가능)을 최소 변경으로 활용.

#### 변경 파일
- `studio/lib/ai/providers/codexCli.ts` (수정, +13/-2줄) — `getCodexBin()` 헬퍼 추가 + `run()` 내부 `codexBin` 변수 교체
- `studio/lib/__tests__/providerCodex.test.ts` (수정, +18줄) — `getCodexBin` import, platform mock 테스트 2개 추가

#### 검증 결과
- [x] `npx tsc --noEmit` → pass (에러 없음)
- [x] `npx vitest run lib/__tests__/providerCodex.test.ts --reporter=basic` → pass (10 tests 모두 통과)
- [ ] Windows 실기 스모크 (`codex exec --json --sandbox ...`) → skip — Mac 개발기에서 불가, 수동 게이트로 이월

#### 추가 발견사항
없음

#### 질문 / 결정 사항
Windows 실기 검증(수동): Windows 환경에서 `codex provider`로 문제 1건 추출 스모크 테스트 필요 (checklist 공통 항목 참조).

#### Scope Change (orchestrator)
auto-approve: +studio/lib/__tests__/providerCodex.test.ts — checklist 항목4가 명시 참조하는 테스트 파일(scope-spec gap), 1 file 같은 모듈 테스트

#### Scope Audit (orchestrator)
pass — codexCli.ts (scope) + providerCodex.test.ts (확장 scope), unattributed 0

#### Verification Re-run (orchestrator)
exit 0 — tsc 통과, vitest 10 passed. Windows .cmd spawn 실기는 수동 게이트 이월 (partial 정합)

#### Simplify (orchestrator)
1 file, 1 edit — 빈 no-op stdout 핸들러 제거, VERIFY pass

#### Review (orchestrator)
VERDICT pass — A~K OK, no-op 제거는 기능중립 dead code(경계), ISSUES 0

#### Commit
63fcc54
