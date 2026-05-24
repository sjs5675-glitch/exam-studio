---
name: nano-banana
description: "Nano Banana (Gemini) 이미지 생성 스킬. 텍스트 또는 참조 이미지를 기반으로 깔끔한 이미지를 생성한다. 'nano-banana', '그림 생성', 'image generation' 키워드에 사용."
user-invocable: false
---

# Nano Banana 이미지 생성 스킬

Nano Banana는 Google Gemini의 네이티브 이미지 생성 기능이다. 텍스트 프롬프트 또는 참조 이미지를 입력받아 고품질 이미지를 생성한다.

## 모델

| 이름 | Model ID | 속도 | 비용 |
|---|---|---|---|
| Nano Banana 2 (기본) | `gemini-3.1-flash-image-preview` | 4-8s | ~$0.08/image |
| Nano Banana Pro | `gemini-3-pro-image-preview` | 10-20s | ~$0.15/image |

기본 모델: `gemini-3.1-flash-image-preview` (Nano Banana 2)

## API 사용법

```python
import os
from google import genai
from google.genai import types
from PIL import Image

api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
client = genai.Client(api_key=api_key)

# 텍스트만으로 생성
response = client.models.generate_content(
    model="gemini-3.1-flash-image-preview",
    contents=["프롬프트 텍스트"],
    config=types.GenerateContentConfig(
        response_modalities=["TEXT", "IMAGE"],
        image_config=types.ImageConfig(
            aspect_ratio="1:1",   # "1:1", "16:9", "9:16", "3:4", "4:3"
            image_size="1K",      # "1K", "2K", "4K"
        ),
    ),
)

# 참조 이미지 + 텍스트로 재생성
ref_image = Image.open("reference.jpg")
response = client.models.generate_content(
    model="gemini-3.1-flash-image-preview",
    contents=["Redraw this figure cleanly", ref_image],
    config=types.GenerateContentConfig(
        response_modalities=["TEXT", "IMAGE"],
        image_config=types.ImageConfig(
            aspect_ratio="1:1",
            image_size="1K",
        ),
    ),
)

# 응답에서 이미지 추출
for part in response.candidates[0].content.parts:
    if part.inline_data is not None:
        image_data = part.inline_data.data
        with open("output.png", "wb") as f:
            f.write(image_data)
```

## 프롬프트 작성 규칙

1. **영어로 작성** — 영어 프롬프트가 품질이 높다
2. **Creative Director처럼** — 태그 나열이 아닌 서술형으로 구체적 기술
3. **시각적 요소 명시** — 도형, 선, 화살표, 축, 라벨 위치 등 구체적으로
4. **스타일 지정** — "simple, geometric, textbook-style, black-and-white, white background, clean crisp lines"
5. **제외 항목 명시** — "No text, no numbers, no labels, no handwriting"
6. **대화형 편집** — 80% 맞으면 전체 재생성보다 수정 요청이 효율적

### 수학 시험지 그림용 프롬프트 템플릿

```
Redraw this math exam figure cleanly and precisely as a simple diagram on a white background.
[도형 구성 요소 구체적 기술]
Simple, geometric, textbook-style, black-and-white, white background, clean crisp lines.
No text, no numbers, no labels, no handwriting.
```

## aspect_ratio 선택 가이드

- `1:1` — 정사각형 그림 (좌표평면, 원, 벤다이어그램 등)
- `4:3` — 가로가 약간 긴 그림 (그래프, 도형)
- `3:4` — 세로가 약간 긴 그림 (수직 구조)
- `16:9` — 넓은 가로 그림 (수직선, 타임라인)

## 의존성

```bash
pip install google-genai Pillow
```

## 환경변수

- `GEMINI_API_KEY` 또는 `GOOGLE_API_KEY` 필요
