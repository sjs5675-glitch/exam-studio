#!/usr/bin/env python3
"""
HWPX Builder — Entry point

Usage: python3 build_hwpx.py <exam_data.json> <output_dir>

Delegates all work to assemble.main().
Module structure (import order):
  ids → equation → shapes → tables → assemble → build_hwpx
"""

from assemble import main

if __name__ == "__main__":
    main()
