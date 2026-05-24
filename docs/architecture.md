# 시험지 제작 시스템 아키텍처

## 에이전트 구조

```
ngd-exam-creator (오케스트레이터)
  │
  ├─[1] ngd-exam-reader    PDF → /tmp/exam_data.json
  │     - PyMuPDF로 PDF→JPG 변환
  │     - 멀티모달 LLM으로 문제/수식/해설 추출
  │     - HWP 수식 문법으로 변환 (hwp-equation 스킬)
  │
  ├─[2] ngd-exam-figure    그림 처리
  │     - PDF에서 그림 영역 crop
  │     - nano-banana(Gemini)로 재생성
  │     - 상하 트리밍 + 워터마크
  │     - outputs/images/에 저장
  │
  └─[3] ngd-exam-builder   JSON + 이미지 → HWPX
        - 양식지 ZIP 기반으로 section0.xml 재조립
        - 수식/테이블/이미지 삽입
        - 후처리: fix_namespaces.py → validate.py
        - outputs/에 최종 HWPX 저장
```

## 스킬 구조

```
.claude/skills/
  ├─ hwp-equation/           HWP 수식 문법 레퍼런스
  │    ├─ SKILL.md           자동 로딩 트리거
  │    └─ reference.md       수식 문법 상세
  │
  ├─ ngd-exam-create/        시험지 제작 워크플로우
  │    ├─ SKILL.md
  │    └─ scripts/
  │         ├─ fix_namespaces.py   네임스페이스 프리픽스 교정
  │         └─ validate.py         XML 검증 + 자동수정
  │
  └─ ngd-exam-review/        오검 워크플로우
       ├─ SKILL.md
       ├─ checklist.md        검수 체크리스트
       └─ scripts/
            └─ fix_namespaces.py
```

## 빌드 파이프라인

```
[양식지 HWPX]           [exam_data.json]         [images/]
     │                        │                      │
     └────────┬───────────────┘──────────────────────┘
              │
    ┌─────────▼──────────┐
    │  Python 빌드 스크립트  │
    │                      │
    │  1. 양식지 ZIP 열기   │
    │  2. section0.xml 생성 │  ← charPrIDRef, paraPrIDRef 매핑 주의
    │  3. 이미지 BinData 삽입│
    │  4. content.hpf 갱신  │
    │  5. masterpage0 갱신  │
    │  6. ZIP 재조립        │
    └─────────┬────────────┘
              │
    ┌─────────▼────────────┐
    │  fix_namespaces.py    │  ns0:/ns1: → hh:/hp:/hs:/hc:
    └─────────┬────────────┘
              │
    ┌─────────▼────────────┐
    │  validate.py --fix    │  이스케이프 + cellAddr + zOrder 수정/검증
    └─────────┬────────────┘
              │
         outputs/*.hwpx
```

## HWPX 파일 구조

```
*.hwpx (ZIP)
├── mimetype                    "application/hwp+zip" (STORED, 첫 번째)
├── version.xml
├── settings.xml
├── META-INF/
│   ├── container.xml
│   ├── container.rdf
│   └── manifest.xml
├── Contents/
│   ├── header.xml              서체/스타일/borderFill 정의 (charPr, paraPr)
│   ├── section0.xml            본문 (문제+수식+테이블+이미지+endNote)
│   ├── masterpage0.xml         머릿말 (학교명, 학년, 과목 등)
│   └── content.hpf             매니페스트 (파일 목록, 이미지 등록)
├── BinData/
│   ├── image1.bmp              머릿말 로고
│   └── image{N}.png            문제 그림
└── Preview/
    ├── PrvImage.png
    └── PrvText.txt
```

## section0.xml 핵심 구조

```xml
<hs:sec>
  <!-- 첫 문단: secPr (페이지 설정, 2단 레이아웃) -->
  <hp:p><hp:run><hp:secPr>...</hp:secPr></hp:run></hp:p>

  <!-- 문제 문단: endNote(정답+해설) + 본문 -->
  <hp:p>
    <hp:run><hp:ctrl><hp:endNote>...</hp:endNote></hp:ctrl></hp:run>
    <hp:run><hp:t>문제 텍스트</hp:t><hp:equation>...</hp:equation></hp:run>
  </hp:p>

  <!-- 선지 문단 -->
  <hp:p><hp:run><hp:t>① ... ② ... ③ ...</hp:t></hp:run></hp:p>
  <hp:p><hp:run><hp:t>④ ... ⑤ ...</hp:t></hp:run></hp:p>

  <!-- 메타 문단 -->
  <hp:p><hp:run><hp:t>[중단원] 값</hp:t></hp:run></hp:p>
  <hp:p><hp:run><hp:t>[난이도] 값</hp:t></hp:run></hp:p>

  <!-- 빈줄 (문제 간격 조절) ×15 -->
  <hp:p><hp:run charPrIDRef="1"/></hp:p>

  <!-- COLBREAK / PAGEBREAK -->
  <hp:p columnBreak="1"><hp:run charPrIDRef="1"/></hp:p>

  <!-- 서답형 구분 -->
  <hp:p><hp:run><hp:t>※ 여기서 부터는 서답형 문제입니다.</hp:t></hp:run></hp:p>
  <hp:p><hp:run><hp:t>[서술형 1]</hp:t></hp:run></hp:p>
  <hp:p>(endNote + 서술형 문제)</hp:p>

  <!-- 해설 분리 -->
  <hp:p columnBreak="1"/>
  <hp:p pageBreak="1"/>
</hs:sec>
```

## Exam Studio (웹 UI)

로컬에서 Claude Code CLI를 호출하여 시험지 제작/오검을 웹 브라우저에서 조작하는 프론트엔드.

### 구조

```
studio/
├── app/                   Next.js 프론트엔드
├── lib/
│   ├── claude.ts          CLI spawn + stream-json 파싱 + SSE 변환
│   └── prompts.ts         제작/오검 프롬프트 생성
├── server/
│   └── sse.ts             독립 SSE 서버 (Next.js 버퍼링 우회용)
└── scripts/
    └── start.sh           Next.js + SSE 서버 동시 실행
```

### CLI 호출 방식

Node.js `child_process.spawn`으로 `claude` CLI를 외부 프로세스로 실행하고,
stdout의 stream-json을 파싱하여 SSE로 프론트엔드에 전달.

```
[브라우저] → POST /api/run → [SSE 서버] → spawn claude CLI → [stdout stream-json]
                              ↓                                      ↓
                         SSE 스트림 ←──── 이벤트 변환 ←──────── JSON 파싱
```

### 핵심 spawn 설정

```typescript
spawn("claude", [
  "-p", prompt,
  "--output-format", "stream-json",
  "--verbose",                       // stream-json에 필수
  "--dangerously-skip-permissions",  // 자동화 서버에서 권한 프롬프트 방지
  "--max-turns", "100",
], {
  stdio: ["ignore", "pipe", "pipe"],  // stdin 반드시 ignore (열린 파이프→CLI 무한대기)
});
```

**주의**: `stdio`의 stdin(첫 번째 값)을 `"pipe"`(기본값)로 두면
Claude CLI가 추가 입력을 대기하며 영원히 멈춘다. 반드시 `"ignore"`로 설정할 것.

### 프롬프트 → Skill 호출

프롬프트에서 Skill 도구 호출을 지시하면, CLI가 해당 skill을 로드하여 실행:

```
"Skill 도구로 "ngd-exam-create" 스킬을 호출해서 진행해."
→ Claude가 Skill tool 호출 → ngd-exam-create 스킬 실행 → 5개 서브에이전트 순차 실행
```

## 현재 상태 및 미해결 과제

### 완료

- [x] 에이전트 5개 구조 설계 및 문서화
- [x] reader → figure → builder 파이프라인 동작 확인
- [x] XML 이스케이프 버그 수정 + 검증 자동화
- [x] cellAddr rowAddr 버그 수정 + 검증 자동화
- [x] zOrder 중복 수정 + 검증 자동화
- [x] 페이지 레이아웃 규칙 문서화 (Break 패턴, 빈줄, 서답형)
- [x] validate.py 검증/자동수정 스크립트

### 미해결

- [ ] **charPrIDRef 매핑 문제**: 양식지 header.xml의 ID 정의 문서화 필요
  - 양식지 charPr[7] = 3pt (엉망) vs 샘플 charPr[7] = 10pt (정상)
  - 빌더가 올바른 IDRef를 사용하도록 매핑 테이블 작성 필요
- [ ] 오검(ngd-exam-reviewer) 에이전트 테스트
- [ ] 그림 처리(ngd-exam-figure) 에이전트 단독 테스트
- [ ] 빌더의 endNote 해설 수식 품질 검증
