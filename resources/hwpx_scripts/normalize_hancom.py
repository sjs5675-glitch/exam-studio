#!/usr/bin/env python3
"""
Normalize a generated HWPX through Hancom HWP automation when available.

Generated HWPX files need lineSegArray data to render wrapped paragraphs
without text overlap. Hancom may still show a safety warning for hand-written
layout caches, so this script opens the file with HWP and saves it back as a
native-normalized HWPX package.

Usage:
  python normalize_hancom.py <file.hwpx>
"""

import os
import sys


def main():
    if len(sys.argv) < 2:
        print("Usage: python normalize_hancom.py <file.hwpx>", file=sys.stderr)
        return 1

    hwpx_path = os.path.abspath(sys.argv[1])
    if not os.path.exists(hwpx_path):
        print(f"Error: file not found: {hwpx_path}", file=sys.stderr)
        return 1

    if os.environ.get("EXAM_STUDIO_SKIP_HANCOM_NORMALIZE") == "1":
        print("[SKIP] Hancom normalization disabled by EXAM_STUDIO_SKIP_HANCOM_NORMALIZE")
        return 0

    if os.name != "nt":
        print("[SKIP] Hancom normalization is only available on Windows")
        return 0

    try:
        import pythoncom
        import win32com.client
    except Exception as exc:
        print(f"[SKIP] pywin32 is unavailable: {exc}")
        return 0

    tmp_path = f"{hwpx_path}.hancom_tmp.hwpx"
    if os.path.exists(tmp_path):
        os.remove(tmp_path)

    hwp = None
    pythoncom.CoInitialize()
    try:
        hwp = win32com.client.Dispatch("HWPFrame.HwpObject")
        try:
            hwp.SetMessageBoxMode(0)
        except Exception:
            pass

        opened = hwp.Open(hwpx_path, "HWPX", "")
        if not opened:
            raise RuntimeError("HWP Open returned false")

        saved = hwp.SaveAs(tmp_path, "HWPX", "")
        if not saved:
            raise RuntimeError("HWP SaveAs returned false")
    finally:
        if hwp is not None:
            try:
                hwp.Quit()
            except Exception:
                pass
        pythoncom.CoUninitialize()

    if not os.path.exists(tmp_path):
        raise RuntimeError(f"HWP did not create normalized file: {tmp_path}")

    os.replace(tmp_path, hwpx_path)
    print(f"Hancom-normalized HWPX: {hwpx_path}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"Error: Hancom normalization failed: {exc}", file=sys.stderr)
        sys.exit(1)
