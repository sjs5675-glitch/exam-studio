# Builder 에이전트 업그레이드 TODO

## 현재 상태 (2026-03-07)

v3 builder로 HWPX가 **한글에서 열리는 수준**까지 도달했다.
Sample 기반 구조, ZIP 규칙, endNote #0, `<hp:tab>` 등 핵심 구조는 해결됨.

### 해결된 문제
- [x] header.xml: sample 기반(운유고) 사용 (38KB, charPr 10개, paraPr 12개)
- [x] charPrIDRef/paraPrIDRef: sample과 동일한 ID 매핑
- [x] ZIP: mimetype/version.xml STORED, PrvImage.png STORED, 파일 순서 sample과 동일
- [x] endNote number="0" (빈 미주) 포함
- [x] p[0] 구조: secPr + colPr + footer + 정보테이블 + 저작권 + 로고
- [x] 선지: `<hp:tab>` XML 요소 사용
- [x] 문단 id 규칙: 내용=2147483648, 빈=0
- [x] 정보테이블, 저작권 고지, 로고 포함

---

## 2026-03-07 업그레이드 완료

### 1. JSON 포맷 Interleaved Parts 재설계 (완료)
- **Reader**: `text` + `equations[]` → `parts: [{"t":"..."}, {"eq":"..."}]` 배열
- **Builder**: parts 배열 → `<hp:t>` + `<hp:equation>` 시퀀스 변환
- 선지, 해설도 동일한 parts 구조

### 2. 수식 처리 범위 확대 (완료)
- Reader: 단순 숫자(1,2,3), 변수(x,a), 배점(3.6), 좌표, 각도 등 모두 수식으로 추출
- Builder: 모든 `{"eq": ...}` → `<hp:equation>` XML 생성
- Sample 검증: 85개 단순 숫자 수식, 배점 수식 모두 일치

### 3. 선지 구조 정밀화 (완료)
- 단순 선지: `T:"①" + EQ + TAB×3 + T:"②" + EQ` (3+2 패턴)
- 혼합 선지: 각 선지를 별도 문단으로 (parts→XML 동일 변환)
- charPrIDRef="7", TAB width="4000" × 3개

### 4. 보기 테이블 양식지 기반 (완료)
- 양식지에서 XML 추출 → `resources/hwpx_base/bogi_box_3items.xml`, `bogi_box_4items.xml`, `bogi_box_6items.xml`
- 플레이스홀더 `{{ITEM_N_CONTENT}}` 치환 방식
- Builder에 condition_box 처리 로직 추가

### 5. 정보테이블 구조 (변경 불필요)
- Sample 2개(운유고, 광명고) 모두 2행3열 (년도|학교|과목+범위)
- 기존 TODO의 "2열 + 학교명 별도" 제안은 sample과 불일치 → 취소

### 6. 데이터 테이블 (추가)
- 상용로그표 등 데이터 테이블 지원 추가
- charPrIDRef="9", paraPrIDRef="2" CENTER
- Reader JSON에 `data_table` 필드 추가

---

## 참고 파일

- Sample 분석: `.claude/skills/ngd-exam-create/sample_analysis.md`
- Base 템플릿: `resources/hwpx_base/`
- 양식지: `studio/inputs/시험지 제작/기출작업양식지.hwpx`
- Sample 1 (광명고): `sample/시험지 제작/[04039]...[광명고]...hwpx`
- Sample 2 (운유고): `sample/시험지 제작/[04039]...[운유고]...hwpx`
