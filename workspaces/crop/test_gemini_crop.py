import importlib.util
import os
from pathlib import Path

from PIL import Image


def load_module():
    path = Path(__file__).resolve().with_name("gemini_crop.py")
    spec = importlib.util.spec_from_file_location("gemini_crop", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class DummyResponse:
    text = (
        '[{"page":1,"answer_page":false,'
        '"questions":[{"number":1,"kind":"regular","box_2d":[0,0,100,100]}]}]'
    )


class DummyModel:
    def generate_content(self, contents):
        prompt = contents[0]
        assert '"number": 1' in prompt
        assert len(contents) == 2
        return DummyResponse()


class DummyGenai:
    def configure(self, api_key):
        assert api_key == "dummy"

    def GenerativeModel(self, name):
        assert name == "gemini-2.5-flash"
        return DummyModel()


def test_prompt_builds_and_guards_bad_pages():
    module = load_module()
    old_key = os.environ.get("GEMINI_API_KEY")
    module.genai = DummyGenai()
    os.environ["GEMINI_API_KEY"] = "dummy"
    try:
        result = module.detect_questions_gemini([Image.new("RGB", (8, 8), "white")])
    finally:
        if old_key is None:
            os.environ.pop("GEMINI_API_KEY", None)
        else:
            os.environ["GEMINI_API_KEY"] = old_key

    assert result[0]["page"] == 1
    assert result[0]["questions"][0]["number"] == 1
    assert module._resolve_page_index({"page": 25}, 24) is None
    assert module._resolve_page_index({"page": 24}, 24) == 23
    assert module._resolve_page_index({"_source_page_index": 7, "page": 1}, 24) == 7
    assert module._normalize_box([-10, 0, 1200, 100]) == [0, 0, 1000, 100]
    assert module._expand_box_for_reading_area([100, 180, 500, 550])[1] == 35
    assert module._expand_box_for_reading_area([100, 620, 500, 900])[1] == 500
    boxes = [[200, 35, 300, 450], [100, 500, 220, 950], [120, 35, 180, 450]]
    assert sorted(boxes, key=module._reading_order_key_from_bbox) == [
        [120, 35, 180, 450],
        [200, 35, 300, 450],
        [100, 500, 220, 950],
    ]


def test_page_by_page_detection_anchors_source_page_index():
    module = load_module()
    old_key = os.environ.get("GEMINI_API_KEY")
    module.genai = DummyGenai()
    os.environ["GEMINI_API_KEY"] = "dummy"
    try:
        result = module.detect_questions_gemini_all([
            Image.new("RGB", (8, 8), "white"),
            Image.new("RGB", (8, 8), "white"),
        ])
    finally:
        if old_key is None:
            os.environ.pop("GEMINI_API_KEY", None)
        else:
            os.environ["GEMINI_API_KEY"] = old_key

    assert len(result) == 2
    assert result[0]["_source_page_index"] == 0
    assert result[1]["_source_page_index"] == 1


if __name__ == "__main__":
    test_prompt_builds_and_guards_bad_pages()
    test_page_by_page_detection_anchors_source_page_index()
    print("gemini_crop self-test ok")
