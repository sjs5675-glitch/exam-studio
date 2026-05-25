---
phase: 2
title: status 네이티브화 + installed/authenticated 노출
status: completed
depends_on: []
scope:
  - studio/app/api/status/route.ts
intervention_likely: false
intervention_reason: ""
executor: sonnet
load_bearing: ""
e2e_refs: []
e2e_triggers: []
---

# Phase 2: status 네이티브화 + installed/authenticated 노출

> **범위**: Backend
> **난이도**: M
> **의존성**: 없음
> **영향 파일**: `studio/app/api/status/route.ts`

## 배경
현재 `/api/status`의 `checkCli`는 Windows에서 `wsl.exe -- bash -lc "<bin> --version"`으로 WSL 안의 CLI를 본다. 네이티브 전환(D2)에 맞춰 **네이티브 `<bin> --version`** 으로 바꿔야 실행 경로(Phase 1·3)와 일치한다. (현재는 status=WSL, codex 실행=네이티브로 불일치 — 이 phase가 status 쪽을 정렬.)

또한 게이팅(Phase 4)·프론트 배너(Phase 7)는 "설치됐는가"뿐 아니라 **"로그인됐는가"** 를 알아야 한다. 인증 판별은 provider별로 비대칭(설계서 §4):
- **codex**: `codex login status` → 로그인 시 exit 0 / 미로그인 exit 1. 스크립트 판별 가능.
- **claude**: 공식 상태확인 CLI 없음. → 자격증명 파일 존재로 휴리스틱 판별:
  - Windows: `%USERPROFILE%\.claude\.credentials.json` 존재
  - macOS: Keychain 저장이라 파일로 확인 불가 → `~/.claude/.credentials.json`(있을 수 있음) 확인하되, 없으면 "불명(설치는 됨)"으로 처리하고 최종 판정은 실제 호출에 위임. (Phase 4가 미인증 시 친절히 안내하므로 false-negative는 허용 가능.)

## 설계
- `checkCli(binary)`의 Windows 분기 제거 → 모든 OS `execSync("<binary> --version")` (PATH의 `.cmd`/`.exe` 자동 해석; 실패 시 ENOENT catch).
- 신규 `checkAuth(provider)`:
  - codex: `execSync("codex login status")` exit 0 → authenticated. (비영(非0)/throw → false)
  - claude: 자격증명 파일 존재 확인 (`USERPROFILE`/`HOME` + `.claude/.credentials.json`). 환경변수 `ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN` 있으면 authenticated=true.
- 응답 형태 확장 (기존 키 유지 + 추가):
  ```jsonc
  {
    "cli":     { "available": bool, "version": str, "authenticated": bool },   // claude
    "codexCli":{ "available": bool, "version": str, "authenticated": bool },   // codex
    "queue": …, "timestamp": …
  }
  ```
  ※ 기존 소비처(`app/page.tsx`)가 `available`만 읽으므로 하위호환 유지.
- `execSync`에 `timeout`(기존 10s) 유지, stdio 무음 처리.

## 체크리스트
- [x] `checkCli` WSL 분기 제거 → 네이티브 `--version` 단일 경로
- [x] codex 인증: `codex login status` exit code로 `authenticated` 판별
- [x] claude 인증: 자격증명 파일(`HOME`/`USERPROFILE` + `.claude/.credentials.json`) 또는 env 토큰으로 판별 (크로스플랫폼 경로 — `path.join`)
- [x] 응답에 provider별 `authenticated` 필드 추가 (기존 `available`/`version` 유지)
- [x] 미설치 시 throw 안 하고 `{available:false, authenticated:false}` 반환
- [x] `npx tsc --noEmit` 통과

## 영향 범위
- `app/page.tsx`는 `available`만 읽으므로 무영향 (Phase 7에서 `authenticated` 소비).
- Windows 인증 판별은 Phase 5 설치 후 실기 스모크로 확정 (claude 파일 경로).

## 검증
```bash
cd studio
npx tsc --noEmit
# 로컬에서 (codex 설치/로그인 상태에 따라) 응답 확인
# curl -s localhost:3020/api/status | jq
```

## 실행 결과

### 1회차 (2026-05-25 KST) — completed
**상태**: completed
**소요 시간**: 약 5분
**진행 모델**: claude-sonnet-4-6

#### 요약
`checkCli`의 Windows WSL 분기를 제거하고 모든 OS에서 네이티브 `--version`을 직접 호출하도록 단일화했다.
신규 `checkAuth(provider)` 함수를 추가해 codex는 `codex login status` exit code, claude는 env 토큰 또는 자격증명 파일 존재 여부로 인증 상태를 판별한다.
응답 JSON에 provider별 `authenticated` 필드를 추가했으며 기존 `available`/`version` 필드는 그대로 유지된다.
미설치 시 `{available:false, authenticated:false}` 를 throw 없이 반환한다.

#### 변경 파일
- `studio/app/api/status/route.ts` (수정, +40/-12줄)

#### 검증 결과
- [x] `npx tsc --noEmit`: `cd studio && npx tsc --noEmit` → pass (출력 없음, exit 0)

#### 추가 발견사항
없음

#### 질문 / 결정 사항
없음

#### Scope Audit (orchestrator)
pass — 1 file in scope (app/api/status/route.ts), unattributed 0

#### Verification Re-run (orchestrator)
exit 0 — tsc --noEmit 통과 (공유 working tree)

#### Simplify (orchestrator)
1 file, 2 edits — 불필요 주석 2건 제거, VERIFY pass

#### Review (orchestrator)
VERDICT pass — A~I 전부 OK, 하위호환 유지, ISSUES 0

#### Commit
af048c1
