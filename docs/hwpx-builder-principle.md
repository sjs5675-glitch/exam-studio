# HWPX 생성 원리

현재 앱에서 HWPX는 AI가 직접 만드는 파일이 아니라, Python 빌더가 한컴 HWPX의 XML 문서 구조를 직접 조립한 뒤 ZIP 패키지로 묶어서 생성한다.

## 전체 흐름

1. PDF에서 문제 영역을 잘라 문제 이미지로 저장한다.
2. AI가 각 문제 이미지를 읽어 `_extracted.json`을 만든다.
   - 문제 본문
   - 보기
   - 표/조건 박스
   - 그림 여부
   - 문제 유형
3. AI가 답과 해설을 만들어 `_solved.json`을 만든다.
4. 앱이 `_extracted.json`과 `_solved.json`을 합쳐 `exam_data.json`을 만든다.
5. 그림 처리 단계가 있으면 `figure_status.json`에 최종 그림 경로를 저장한다.
6. Python 빌더가 `exam_data.json`을 읽고 HWPX 본문 XML을 만든다.
7. 기본 HWPX 뼈대와 새 본문 XML, 이미지 리소스를 ZIP으로 묶어 `.hwpx` 파일을 만든다.
8. namespace 보정, 한컴 호환 정규화, validate/fix 단계를 거친다.

## HWPX 파일 구조

HWPX는 내부적으로 ZIP 파일이다. 앱은 `resources/hwpx_base`에 있는 기본 HWPX 뼈대를 사용하고, 그 안의 본문과 리소스 일부를 새로 생성한다.

주요 구성은 다음과 같다.

- `Contents/section0.xml`: 실제 본문 내용
- `Contents/content.hpf`: 이미지와 리소스 목록
- `BinData/*.bmp`: 삽입 이미지
- `META-INF/*`: 패키지 메타 정보
- `settings.xml`, `version.xml`, preview 파일 등

## 본문 생성 방식

Python 빌더는 문제 JSON을 읽어 한컴 XML 요소로 변환한다.

- 일반 텍스트: `<hp:t>...</hp:t>`
- 문단: `<hp:p>...</hp:p>`
- 수식: `<hp:equation>...</hp:equation>`
- 그림: PNG를 BMP로 변환한 뒤 `BinData`에 넣고 `<hp:pic>`으로 참조
- 보기, 표, 조건 박스: XML 템플릿과 생성 함수를 이용해 조립

주요 파일은 다음과 같다.

- `studio/server/stages/examData.ts`: 문제별 JSON을 합쳐 `exam_data.json` 생성
- `studio/server/stages/builder.ts`: HWPX 빌더 실행 순서 관리
- `build_hwpx.py`: HWPX 빌더 진입점
- `assemble.py`: `section0.xml`, `content.hpf`, ZIP 패키징 생성
- `equation.py`: 한컴 수식 XML 생성
- `shapes.py`: 그림과 도형 XML 생성
- `tables.py`: 표, 보기, 조건 박스 XML 생성

## 중요한 특징

일반 워드프로세서처럼 텍스트를 넣고 한컴이 모든 줄바꿈과 배치를 자동으로 처리하는 구조가 아니다.

앱은 XML 안에서 문단 높이, 줄 위치, 수식 폭, 이미지 크기, 표 크기 등을 직접 계산해서 넣는다. 이 계산이 실제 한컴 렌더링과 어긋나면 글자 겹침, 어색한 줄바꿈, 표 크기 문제, 수식 간격 문제가 생길 수 있다.

따라서 HWPX 품질을 개선하려면 단순히 AI 출력만 고치는 것이 아니라, `assemble.py`, `equation.py`, `shapes.py`, `tables.py` 쪽의 XML 조립 규칙과 레이아웃 계산도 함께 조정해야 한다.

## 한 줄 요약

AI는 문제 내용을 JSON으로 정리하고, HWPX는 Python 빌더가 한컴 XML 문서 구조를 직접 조립해서 ZIP으로 패키징하는 방식이다.
