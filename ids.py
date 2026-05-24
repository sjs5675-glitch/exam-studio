#!/usr/bin/env python3
"""
HWPX Builder — Global ID counters (isolated module)

Import direction: ids → equation → shapes → tables → assemble → build_hwpx
"""

# === Counters ===
eq_id_counter = 1654899650  # Start after header IDs
zorder_counter = 10
inst_id_counter = 1654899642  # endNote instIds start here


def reset_counters():
    """Reset all counters to initial values (call at start of each build)"""
    global eq_id_counter, zorder_counter, inst_id_counter
    eq_id_counter = 1654899650
    zorder_counter = 10
    inst_id_counter = 1654899642


def next_eq_id():
    global eq_id_counter
    eq_id_counter += 1
    return eq_id_counter


def next_zorder():
    global zorder_counter
    zorder_counter += 1
    return zorder_counter


def next_inst_id():
    global inst_id_counter
    inst_id_counter += 1
    return inst_id_counter
