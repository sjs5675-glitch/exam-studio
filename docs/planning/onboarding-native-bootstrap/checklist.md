---
task: onboarding-native-bootstrap
phase_count: 7
created: 2026-05-25
---

# 온보딩 네이티브 부트스트랩 — 진행 체크리스트

> **AI 개발 가이드**: `/phase-run`이 이 파일을 읽어 다음 phase를 선정합니다.
> 사용자가 수동 진행 시에도 같은 테이블을 갱신해 주세요.
> 설계 근거 전문: [`docs/onboarding-design.md`](../../onboarding-design.md)

## 진행 상태 요약

| Phase | 파일 | 항목 | 완료 | 진행률 | 상태 | 커밋 |
|-------|------|------|------|--------|------|------|
| 1 | [phase-01-remove-wsl-bridge.md](./phase-01-remove-wsl-bridge.md) | 6 | 6 | 100% | completed | f77ef5a |
| 2 | [phase-02-status-native-auth.md](./phase-02-status-native-auth.md) | 6 | 6 | 100% | completed | af048c1 |
| 3 | [phase-03-codex-native-spawn.md](./phase-03-codex-native-spawn.md) | 5 | 5 | 100% | completed | 63fcc54 |
| 4 | [phase-04-runtime-gating.md](./phase-04-runtime-gating.md) | 6 | 6 | 100% | completed | 73eb437 |
| 5 | [phase-05-installer-extend.md](./phase-05-installer-extend.md) | 8 | 8 | 100% | completed | 2ebe1e3 |
| 6 | [phase-06-bootstrap-oneliner.md](./phase-06-bootstrap-oneliner.md) | 6 | 5 | 83% | completed | 9aa3385 |
| 7 | [phase-07-login-launcher-banner.md](./phase-07-login-launcher-banner.md) | 6 | 5 | 83% | completed | e872bc5 |
| **Total** | | **43** | **41** | **95%** | | |

## Phase 의존성

```
Phase 1 (독립)
Phase 2 ──┬──▶ Phase 4 ──▶ Phase 7
Phase 3 ──┘            ▲
Phase 2 ──────────────┘ (Phase 7도 2 참조)
Phase 5 ──▶ Phase 6
```

초기 병렬 가능: **{1, 2, 3, 5}**

## 우선순위

| 등급 | Phase | 설명 | 예상 시간 |
|------|-------|------|-----------|
| P0 | Phase 1 | WSL 브리지 제거 — 네이티브 전환의 토대, 가장 안전 | 25분 |
| P0 | Phase 2 | status 네이티브 + 인증 상태 노출 — 게이팅의 데이터원 | 25분 |
| P1 | Phase 3 | codex 네이티브 spawn — Windows 실행 정합성 | 15분 |
| P1 | Phase 4 | 런타임 게이팅 — 미설치/미인증 의문사 방지 | 25분 |
| P1 | Phase 5 | installer 본체 — 선택설치 + Node + 로그인 기동 | 45분 |
| P2 | Phase 6 | 부트스트랩 한 줄 — 진입점 | 20분 |
| P2 | Phase 7 | 앱 로그인 런처 + 배너 | 25분 |

## 권장 실행 순서

1. Phase 1 / 2 / 3 / 5 (병렬 착수 가능)
2. Phase 4 (2,3 완료 후)
3. Phase 6 (5 완료 후)
4. Phase 7 (2,4 완료 후)

## 검증 체크리스트

### 공통 검증
- [ ] `npx tsc --noEmit` 통과
- [ ] `npx vitest run` 관련 테스트 통과 (claude / provider*)
- [ ] `grep -rn "wsl" studio/lib studio/server studio/app` 잔여 0 (Phase 1·2 후)
- [ ] Mac 실기: 시험지 제작 job 1건 end-to-end 정상 (네이티브 claude/codex)

### Windows 실기 스모크 (수동 게이트 — Phase 3·5·6)
- [ ] 네이티브 `codex exec --json --sandbox danger-full-access` 1회 동작 (+ `.cmd` spawn)
- [ ] `irm <raw>/bootstrap.ps1 | iex` → clone → install → 로그인 → 기동 완주
- [ ] winget Node/Git 무인 설치 확인

## Cross-Phase 메모
- [phase-4] cross-phase: studio/app/api/create/start/route.ts (호출부 CreatePageClient.tsx) — `/api/create/start` form-data에 `provider`/`stageOverrides` 미포함. 현재 `auto` 기본값으로 동작상 문제 없음. Phase 7(UI) 검토 후보.
- [phase-6] cross-phase: README.md (scope 밖) — 부트스트랩 한 줄 명령(`curl ... | bash` / `irm ... | iex`) README 안내 추가 권장. worker가 NOTES로만 보고(미수정).

## 관련 문서
- 설계서: [../../onboarding-design.md](../../onboarding-design.md)
