# Exam Studio 프론트엔드 개선 작업

## 이슈 목록 및 체크리스트

### [P0] 이슈 3: 에이전트 스테이지 오인식 -- DONE
- **증상**: builder/checker 에이전트가 "solver"로 표시됨
- **원인**: `detectStage()` / `detectStageFromTool()`이 텍스트 패턴(예: "해설")에 반응하여 잘못된 스테이지 감지
- **수정**: Agent `subagent_type` 기반 정확한 매칭으로 변경
- **수정 파일**: `lib/claude.ts`
- [x] `agentTypeToStage` 맵 추가 (ngd-exam-reader → reader 등)
- [x] `detectStageFromTool`: subagent_type → description → prompt 3단계 우선순위
- [x] `detectStage`: 에이전트 이름 패턴 1순위, 일반 키워드는 엄격한 조합 패턴으로 폴백
- [x] Skill 도구 호출(ngd-exam-create, nano-banana) 감지 추가
- [x] 빌드 확인

### [P0] 이슈 4: 파일 다운로드 실패 -- DONE
- **증상**: 완료 후 다운로드 버튼 클릭해도 파일 안 받아짐
- **원인**: job JSON에 `outputFile` 미저장, .hwpx 파일 이벤트 미발행
- **수정**: 다단계 outputFile 추적 (이벤트 → outputs/ 스캔 폴백)
- **수정 파일**: `lib/claude.ts`, `server/sse.ts`, `app/api/download/[jobId]/route.ts`
- [x] `claude.ts`: Write .hwpx → file 이벤트 발행
- [x] `claude.ts`: Bash zip/cp/mv .hwpx 감지 → file 이벤트 발행
- [x] `sse.ts`: file 이벤트에서 hwpx 경로 추적
- [x] `sse.ts`: 폴백 — 완료 시 outputs/ 최신 .hwpx 스캔 (작업 시작 이후 파일만)
- [x] `sse.ts`: job JSON에 outputFile, resultSummary 저장
- [x] `sse.ts`: 절대경로 → 상대경로 정규화
- [x] `download/route.ts`: 절대경로/상대경로 모두 처리
- [x] 빌드 확인

### [P1] 이슈 5: 이미지 미표시 -- DONE
- **증상**: 이미지 생성되어도 "아직 생성되지 않았습니다" 표시
- **원인**: ResultTabs에서 플레이스홀더 SVG만 표시. 이미지 서빙 API 없음
- **수정 파일**: `app/api/file/route.ts` (신규), `components/results/ResultTabs.tsx`
- [x] `/api/file?path=` 이미지/JSON 서빙 API 라우트 추가 (경로 트래버설 방지)
- [x] ResultTabs `ImageFileItem`: 실제 `<img>` 렌더링, 에러 시 SVG 폴백
- [x] 빌드 확인

### [P1] 이슈 2: 타이머 실시간 갱신 -- DONE
- **증상**: 타이머가 로그 업데이트 시에만 갱신됨
- **원인**: StageCard가 외부 리렌더 없으면 getElapsed 재계산 안 함
- **수정 파일**: `components/pipeline/StageCard.tsx`
- [x] running 상태일 때 1초 간격 setInterval → 강제 리렌더
- [x] 빌드 확인

### [P2] 이슈 1: JSON 호버 팝업 -- DONE
- **증상**: JSON 파일 항목에 커서 올려도 내용 확인 불가
- **수정 파일**: `components/results/ResultTabs.tsx`
- [x] `JsonFileItem`: 호버 시 `/api/file` API로 내용 로드
- [x] JSON 파싱 후 포맷팅하여 팝업 표시 (5000자 제한)
- [x] 빌드 확인

### [P2] 이슈 6: 완료 리포트 마크다운 팝업 -- DONE
- **증상**: 결과가 "요약" 탭에 텍스트로만 표시
- **수정 파일**: `components/results/ResultTabs.tsx`
- [x] `ReportModal`: 완료 시 자동 팝업, ESC/배경 클릭으로 닫기
- [x] `MarkdownRenderer`: 외부 의존성 없이 제목/목록/[태그]/bold/code 렌더링
- [x] 요약 탭에 "리포트 보기" 버튼 추가
- [x] 빌드 확인

## 수정된 파일 목록

| 파일 | 변경 내용 | 관련 이슈 |
|------|-----------|-----------|
| `lib/claude.ts` | subagent_type 기반 스테이지 감지, .hwpx 파일 이벤트 | 3, 4 |
| `server/sse.ts` | outputFile 추적, outputs/ 스캔 폴백, job JSON 저장 | 4 |
| `app/api/download/[jobId]/route.ts` | 절대/상대 경로 처리 | 4 |
| `app/api/file/route.ts` | 이미지/JSON 파일 서빙 API (신규) | 1, 5 |
| `components/results/ResultTabs.tsx` | 이미지 렌더링, JSON 호버, 리포트 모달 | 1, 5, 6 |
| `components/pipeline/StageCard.tsx` | 1초 interval 타이머 | 2 |
