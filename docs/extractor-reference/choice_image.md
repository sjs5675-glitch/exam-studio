# choice_image extractor reference

## 목적

extractor stage 가 PDF / 이미지에서 선지가 그림(이미지)인 5선지 테이블 (①~⑤ 번호 + 이미지 5개, 2열 배치) 을 감지했을 때 emit 해야 할 dict 형식 명세. 이 문서는 generator (`tables.py` `make_choice_table`) 가 기대하는 입력과 1:1 align.

---

## choice_image (그림 5선지)

### 입력 dict 스키마

```json
{
  "type": "choice_table",
  "table_type": "choice_image",
  "rows": []
}
```

### 필드 설명

| 필드 | 타입 | 설명 |
|------|------|------|
| `type` | `"choice_table"` | 고정값. `make_choice_table` 디스패치 키 |
| `table_type` | `"choice_image"` | fixture 선택 키. 옛 키 `"9x4"` 도 호환 허용 |
| `rows` | 배열 | 일반적으로 빈 배열 `[]`. 이미지 placeholder 는 figure stage 에서 처리 |

### 셀 규칙

이 fixture 는 **이미지 placeholder** 구조다. 텍스트/수식 내용을 extractor 가 직접 지정하지 않고, figure stage (nano-banana) 와 builder stage 가 BinData 이미지 삽입을 담당한다.

| fixture 구조 | 설명 |
|-------------|------|
| `choice_image_5options.xml` | 9행 4열 (rowSpan=3 × 5 이미지 블록) |
| col1 row0/3/6 (rowSpan=3) | 이미지 placeholder ①, ③, ⑤ |
| col3 row0/3 (rowSpan=3) | 이미지 placeholder ②, ④ |
| col0/col2 | ①②③④⑤ 번호 (fixture 박힘) |

**extractor 역할**: `table_type: "choice_image"` 와 `rows: []` 만 emit. 이미지 내용 지정은 extractor 범위 밖.

**figure stage 역할**: PDF 에서 각 선지 이미지를 crop → nano-banana 재생성 → BinData 삽입.

### 예시 1 — 기본 (rows 생략 가능)

```json
{
  "type": "choice_table",
  "table_type": "choice_image",
  "rows": []
}
```

### 예시 2 — figure stage 에 전달할 이미지 메타 (선택적 확장)

extractor 는 이미지 파일 경로 또는 crop 좌표를 별도 `figure_hints` 필드로 제공할 수 있으나, 현재 phase 에서는 지원하지 않음. builder 가 placeholder 셀에 이미지 삽입하는 방식으로 처리.

```json
{
  "type": "choice_table",
  "table_type": "choice_image",
  "rows": []
}
```

---

## generator 연결 (tables.py)

`make_choice_table(condition_box, base_path)` → `CHOICE_TABLE_MAP["choice_image"]` = `choice_image_5options.xml` 로드.

- `rows` 가 빈 배열이면 fixture 원본을 그대로 반환 (이미지 placeholder 셀 보존)
- 이미지 실제 삽입: `ngd-exam-builder` agent 가 `<hp:pic>` 태그 주입

**이 reference 문서가 extractor 출력과 generator 입력 사이의 계약을 정의한다.**
