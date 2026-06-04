#!/usr/bin/env python3
"""
Normalize a generated HWPX through Hancom HWP automation when available.

Generated HWPX files need lineSegArray data to render wrapped paragraphs
without text overlap. Hancom may still show a safety warning for hand-written
layout caches, so this script opens the file with HWP and saves it back as a
native-normalized HWPX package.

The Hancom COM step opens Hangul through automation and may trigger a local
security prompt. To avoid interrupting normal app runs, it is opt-in:
set EXAM_STUDIO_ENABLE_HANCOM_NORMALIZE=1 to enable it.

Usage:
  python normalize_hancom.py <file.hwpx>
"""

import os
import sys
import multiprocessing
import subprocess


def _hwp_pids():
    if os.name != "nt":
        return set()
    try:
        out = subprocess.check_output(
            ["tasklist", "/FI", "IMAGENAME eq Hwp.exe", "/FO", "CSV", "/NH"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        return set()
    pids = set()
    for line in out.splitlines():
        cols = [col.strip().strip('"') for col in line.split('","')]
        if len(cols) >= 2 and cols[0].lower() == "hwp.exe":
            try:
                pids.add(int(cols[1]))
            except ValueError:
                pass
    return pids


def _kill_new_hwp_processes(before_pids):
    for pid in _hwp_pids() - before_pids:
        try:
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
        except Exception:
            pass


def _normalize_worker(hwpx_path, queue):
    try:
        queue.put(("ok", _normalize_with_hancom(hwpx_path)))
    except Exception as exc:
        queue.put(("error", str(exc)))


def _normalize_with_hancom(hwpx_path):
    import pythoncom
    import win32com.client

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
    return hwpx_path


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

    if os.environ.get("EXAM_STUDIO_ENABLE_HANCOM_NORMALIZE") != "1":
        print("[SKIP] Hancom normalization is opt-in; set EXAM_STUDIO_ENABLE_HANCOM_NORMALIZE=1 to enable")
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

    timeout = int(os.environ.get("EXAM_STUDIO_HANCOM_TIMEOUT_SEC", "60"))
    before_pids = _hwp_pids()
    queue = multiprocessing.Queue()
    proc = multiprocessing.Process(target=_normalize_worker, args=(hwpx_path, queue))
    proc.start()
    proc.join(timeout)

    if proc.is_alive():
        proc.terminate()
        proc.join(5)
        _kill_new_hwp_processes(before_pids)
        tmp_path = f"{hwpx_path}.hancom_tmp.hwpx"
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        print(f"[SKIP] Hancom normalization timed out after {timeout}s")
        return 0

    if proc.exitcode != 0:
        _kill_new_hwp_processes(before_pids)
        print(f"[SKIP] Hancom normalization worker exited {proc.exitcode}")
        return 0

    status, payload = queue.get() if not queue.empty() else ("error", "worker returned no result")
    if status != "ok":
        _kill_new_hwp_processes(before_pids)
        print(f"[SKIP] Hancom normalization failed: {payload}")
        return 0

    print(f"Hancom-normalized HWPX: {hwpx_path}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"Error: Hancom normalization failed: {exc}", file=sys.stderr)
        sys.exit(1)
