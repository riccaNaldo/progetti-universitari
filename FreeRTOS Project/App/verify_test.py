# FreeRTOS Kernel <DEVELOPMENT BRANCH>
# Copyright (C) 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
#
# SPDX-License-Identifier: MIT
#
# Permission is hereby granted, free of charge, to any person obtaining a copy of
# this software and associated documentation files (the "Software"), to deal in
# the Software without restriction, including without limitation the rights to
# use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
# the Software, and to permit persons to whom the Software is furnished to do so,
# subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
# FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
# COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
# IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
# CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
#
# https://www.FreeRTOS.org
# https://github.com/FreeRTOS

#!/usr/bin/env python3
"""
FreeRTOS PTL/ATL Test Verifier
Usage: python3 verify_test.py <TEST_ID> <qemu_log_file>
"""
import sys
import re

TOLERANCE = 0  # ticks

# Log line format:
# [ tick ] | TaskName |  EventName  | JobMiss:N | DlMiss:True/False | {Queue items: N Free: N }
LINE_RE = re.compile(
    r'\[\s*(\d+)\s*\]\s*\|\s*(\S+)\s*\|\s*(\S+)\s*\|\s*JobMiss:(\d+)\s*\|\s*DlMiss:(\S+)'
)

def parse_log(log_file):
    events = []
    with open(log_file, 'r') as f:
        for line in f:
            m = LINE_RE.search(line)
            if m:
                tick, task, event, jobmiss, dlmiss = m.groups()
                events.append({
                    'tick': int(tick),
                    'task': task.strip(),
                    'event': event.strip(),
                    'jobmiss': int(jobmiss),
                    'dlmiss': dlmiss.strip().upper() == 'TRUE'
                })
    return events

results = []

def check(name, ok, detail=''):
    status = '[PASS]' if ok else '[FAIL]'
    msg = f"  {status} {name}"
    if detail and not ok:
        msg += f" — {detail}"
    print(msg)
    results.append(ok)

def find(events, task=None, event=None, after_tick=-1):
    for e in events:
        if task and e['task'] != task: continue
        if event and e['event'] != event: continue
        if e['tick'] > after_tick: return e
    return None

def find_all(events, task=None, event=None):
    return [e for e in events if
            (task is None or e['task'] == task) and
            (event is None or e['event'] == event)]

def check_tick(name, events, task, event, expected, after_tick=-1):
    e = find(events, task=task, event=event, after_tick=after_tick)
    if e is None:
        check(name, False, f"expected '{task}' '{event}' not found in log")
    else:
        ok = abs(e['tick'] - expected) <= TOLERANCE
        check(name, ok, f"tick={e['tick']} expected≈{expected} (±{TOLERANCE})" if not ok else '')

def check_no_dlmiss(events, task, name=None):
    misses = [e for e in events if e['task'] == task and e['dlmiss']]
    label = name or f"No deadline miss for {task}"
    check(label, len(misses) == 0,
          f"{task} had {len(misses)} deadline miss(es)" if misses else '')

def check_has_dlmiss(events, task, name=None):
    misses = [e for e in events if e['task'] == task and e['dlmiss']]
    label = name or f"Deadline miss logged for {task}"
    check(label, len(misses) > 0, f"No deadline miss found for {task}" if not misses else '')

def check_event_exists(events, task, event, name=None):
    e = find(events, task=task, event=event)
    label = name or f"{task} {event} logged"
    check(label, e is not None, f"event not found in log" if e is None else '')

# ── B1: Priority Preemption ───────────────────────────────────────────────────
def check_B1(events, verbose):
    """B1: T1(T=10,wcet=4,P=HIGH) preempts T2(T=20,wcet=8,P=LOW)"""
    check_no_dlmiss(events, 'T1')
    check_no_dlmiss(events, 'T2')
    check_tick("T1 starts at tick 0",  events, 'T1', 'Start', 0)
    check_tick("T1 ends at tick 4",    events, 'T1', 'End',   4)
    check_tick("T2 starts at tick 4",  events, 'T2', 'Start', 4)
    # T2 preempted at tick 10 by T1, resumes at 14, finishes at 16
    t2_end = find(events, task='T2', event='End')
    check("T2 completes before deadline=20",
          t2_end is not None and t2_end['tick'] <= 20 + TOLERANCE,
          f"T2 End at tick {t2_end['tick'] if t2_end else 'N/A'}")
    t1_at_10 = find(events, task='T1', event='Start', after_tick=9)
    check("T1 preempts T2 at tick 10",
          t1_at_10 is not None and t1_at_10['tick'] == 10,
          f"T1 did not start at tick 10")

# ── B2: Constrained Deadlines D<T ────────────────────────────────────────────
def check_B2(events, verbose):
    """B2: T1(T=20,D=10,wcet=5) meets deadline. T2(T=20,D=8,wcet=9) always misses."""
    check_no_dlmiss(events, 'T1')
    check_has_dlmiss(events, 'T2', "T2 always misses deadline (wcet=9 > D=8)")
    check_tick("T1 starts at tick 0", events, 'T1', 'Start', 0)
    check_tick("T1 ends at tick 5",   events, 'T1', 'End',   5)

# ── B3: High Utilization ~90% ─────────────────────────────────────────────────
def check_B3(events, verbose):
    """B3: T1(T=10,wcet=5), T2(T=10,wcet=4), T3(T=20,wcet=1). Total=95%. No misses."""
    check_no_dlmiss(events, 'T1')
    check_no_dlmiss(events, 'T2')
    check_no_dlmiss(events, 'T3')
    check_tick("T1 starts at tick 0", events, 'T1', 'Start', 0)
    check_tick("T1 ends at tick 5",   events, 'T1', 'End',   5)
    check_tick("T2 starts at tick 5", events, 'T2', 'Start', 5)
    check_tick("T2 ends at tick 9",   events, 'T2', 'End',   9)
    check_tick("T3 starts at tick 9", events, 'T3', 'Start', 9)
    t1_starts = find_all(events, task='T1', event='Start')
    check("T1 runs multiple periods", len(t1_starts) >= 3,
          f"only {len(t1_starts)} T1 starts")

# ── P1: SKIP Policy ───────────────────────────────────────────────────────────
def check_P1(events, verbose):
    """P1: T1(wcet=14>T=10, SKIP). T2(T=5,wcet=2,HIGH) preempts T1."""
    check_no_dlmiss(events, 'T2')
    check_event_exists(events, 'T1', 'Ovr_SKIP', "T1 Ovr_SKIP logged")
    skip_events = find_all(events, task='T1', event='Ovr_SKIP')
    check("Multiple Ovr_SKIP events", len(skip_events) >= 2,
          f"only {len(skip_events)} skip events")
    t1_dlmiss = find_all(events, task='T1', event='End')
    t1_misses = [e for e in t1_dlmiss if e['dlmiss']]
    check("T1 has deadline misses (expected)", len(t1_misses) >= 1,
          f"T1 had no deadline misses")

# ── P2: KILL Policy ───────────────────────────────────────────────────────────
def check_P2(events, verbose):
    """P2: T1(T=10,wcet=9,KILL). T2(T=20,wcet=5,phase=20) delays T1 causing overrun.
    T1 runs fine first two periods. At tick 25 T2 preempts T1 leaving only 5ms CPU.
    T1 overruns at tick 30 -> Ovr_KILL logged. T1 immediately restarted.
    """
    check_no_dlmiss(events, 'T2')
    check_event_exists(events, 'T1', 'Ovr_KILL', "T1 Ovr_KILL logged")
    t1_starts = find_all(events, task='T1', event='Start')
    check("T1 restarts after KILL", len(t1_starts) >= 3,
          f"only {len(t1_starts)} T1 starts found")
    kill_events = find_all(events, task='T1', event='Ovr_KILL')
    check("Multiple Ovr_KILL events", len(kill_events) >= 2,
          f"only {len(kill_events)} kill events")

# ── P3: CATCH_UP Policy ───────────────────────────────────────────────────────
def check_P3(events, verbose):
    """P3: T1(T=10,wcet=9,CATCH_UP). T2(T=200,phase=20) delays T1 causing overrun.
    T1 catches up — finishes naturally, immediately restarts, Ovr_CATCHUP logged.
    """
    check_event_exists(events, 'T1', 'Ovr_CATCHUP', "T1 Ovr_CATCHUP logged")
    t1_ends = find_all(events, task='T1', event='End')
    check("T1 completes naturally (not killed)", len(t1_ends) >= 1,
          "T1 never completed")
    catchup_events = find_all(events, task='T1', event='Ovr_CATCHUP')
    check("Multiple Ovr_CATCHUP events", len(catchup_events) >= 2,
          f"only {len(catchup_events)} catchup events")
    t1_starts = find_all(events, task='T1', event='Start')
    check("T1 restarts immediately after catch_up", len(t1_starts) >= 3,
          f"only {len(t1_starts)} T1 starts")

# ── A1: PS Single-Period Execution ────────────────────────────────────────────
def check_A1(events, verbose):
    """A1: T1(T=10,wcet=4). AP1(wcet=5) fits within PS budget. No deadline miss."""
    check_no_dlmiss(events, 'T1')
    check_tick("T1 starts at tick 0", events, 'T1', 'Start', 0)
    check_tick("T1 ends at tick 4",   events, 'T1', 'End',   4)
    check_event_exists(events, 'PS', 'Start', "PS activates")
    check_event_exists(events, 'AP1', 'Start', "AP1 starts")
    ap1_end = find(events, task='AP1', event='End')
    check("AP1 completes without deadline miss",
          ap1_end is not None and not ap1_end['dlmiss'],
          f"AP1 End dlmiss={ap1_end['dlmiss'] if ap1_end else 'N/A'}")

# ── A2: Multi-Period Spanning ────────────────────────────────────────────────
def check_A2(events, verbose):
    """A2: AP1(wcet=7) > PS budget -> spans 2 PS activations. No deadline miss."""
    check_no_dlmiss(events, 'T1')
    check_event_exists(events, 'AP1', 'Start', "AP1 starts")
    # AP1 should complete without deadline miss (deadline=30ms is generous)
    ap1_end = find(events, task='AP1', event='End')
    check("AP1 completes", ap1_end is not None, "AP1 never completed")
    check("AP1 no deadline miss", ap1_end is not None and not ap1_end['dlmiss'],
          f"AP1 missed deadline")
    # PS should activate at least twice (AP1 spans 2 budget slots)
    ps_starts = find_all(events, task='PS', event='Start')
    check("PS activates at least twice (AP1 spans 2 periods)", len(ps_starts) >= 2,
          f"PS activated only {len(ps_starts)} time(s)")

# ── A3: PS Overrun Policy (OVERRUN) ──────────────────────────────────────────
def check_A3(events, verbose):
    """A3: AP1 misses soft deadline. OVERRUN policy: continues naturally."""
    check_no_dlmiss(events, 'T1')
    check_event_exists(events, 'AP1', 'Start', "AP1 starts")
    check_event_exists(events, 'AP1', 'DL_MISS', "AP1 deadline miss logged")
    check_event_exists(events, 'AP1', 'OVERRUN', "AP1 OVERRUN logged")
    ap1_end = find(events, task='AP1', event='End')
    check("AP1 completes naturally after deadline miss",
          ap1_end is not None,
          "AP1 never completed")

# ── A4: OVERRUN_SERVER ───────────────────────────────────────────────────────
def check_A4(events, verbose):
    """A4: AP1 misses soft deadline (OVERRUN); AP2 queued after AP1, completes without miss."""
    check_no_dlmiss(events, 'T1')
    check_event_exists(events, 'AP1', 'Start', "AP1 starts")
    check_event_exists(events, 'AP1', 'DL_MISS', "AP1 deadline miss logged")
    check_event_exists(events, 'AP1', 'OVERRUN', "AP1 OVERRUN logged")
    ap1_end = find(events, task='AP1', event='End')
    check("AP1 completes naturally after deadline miss (OVERRUN policy)",
          ap1_end is not None, "AP1 never completed")
    check_event_exists(events, 'AP2', 'Start', "AP2 starts after AP1")
    ap2_end = find(events, task='AP2', event='End')
    check("AP2 completes without deadline miss",
          ap2_end is not None and not ap2_end['dlmiss'], "AP2 missed deadline")

# ── A5: PS KILL Policy ───────────────────────────────────────────────────────
def check_A5(events, verbose):
    """A5: AP1 misses deadline, KILL terminates it. AP2 promoted and completes."""
    check_no_dlmiss(events, 'T1')
    check_event_exists(events, 'AP1', 'Start', "AP1 starts")
    check_event_exists(events, 'AP1', 'DL_MISS', "AP1 deadline miss logged")
    check_event_exists(events, 'AP1', 'Ovr_KILL', "AP1 Ovr_KILL logged")
    ap1_end = find(events, task='AP1', event='End')
    check("AP1 terminated (End logged after kill)", ap1_end is not None, "AP1 End not found")
    check_event_exists(events, 'AP2', 'Start', "AP2 promoted after AP1 killed")
    ap2_end = find(events, task='AP2', event='End')
    check("AP2 completes without deadline miss",
          ap2_end is not None and not ap2_end['dlmiss'], "AP2 missed deadline")


# ── B4: Overlapping HRT Tasks ────────────────────────────────────────────────
def check_B4(events, verbose):
    """B4: Concurrent overrun policies. T1(KILL) and T2(SKIP) both overrun
    due to T3 preemption. Both policies applied simultaneously."""
    check_no_dlmiss(events, 'T3')
    check_event_exists(events, 'T1', 'Ovr_KILL', "T1 Ovr_KILL logged")
    check_event_exists(events, 'T2', 'Ovr_SKIP', "T2 Ovr_SKIP logged")
    kill_events = find_all(events, task='T1', event='Ovr_KILL')
    skip_events = find_all(events, task='T2', event='Ovr_SKIP')
    check("Multiple T1 Ovr_KILL events", len(kill_events) >= 2,
          f"only {len(kill_events)} kill events")
    check("Multiple T2 Ovr_SKIP events", len(skip_events) >= 2,
          f"only {len(skip_events)} skip events")

# ── B5: Edge-Case Tight Boundary ─────────────────────────────────────────────
def check_B5(events, verbose):
    """B5: Edge-case — T1 wcet=D=5ms (zero slack). T1 must finish exactly at deadline.
    T2(wcet=8ms) runs after T1. No preemption issues since T1 is higher priority.
    """
    check_no_dlmiss(events, 'T1')
    check_no_dlmiss(events, 'T2')
    check_tick("T1 starts at tick 0", events, 'T1', 'Start', 0)
    check_tick("T1 ends at tick 5",   events, 'T1', 'End',   5)
    check_tick("T2 starts at tick 5", events, 'T2', 'Start', 5)
    # T1 must always finish within its deadline (D=5ms from release)
    t1_starts = find_all(events, task='T1', event='Start')
    t1_ends = find_all(events, task='T1', event='End')
    pairs = list(zip(t1_starts[:5], t1_ends[:5]))
    ok = all((e['tick'] - s['tick']) <= 5 + TOLERANCE for s, e in pairs)
    check("T1 always meets zero-slack deadline (wcet=D=5ms)",
          ok and len(pairs) >= 3,
          "T1 exceeded zero-slack deadline")


# ── B6: Equal Priority Tasks ─────────────────────────────────────────────────
def check_B6(events, verbose):
    """B6: T1, T2, T3 same priority with Round-Robin enabled.
    All tasks start within first few ticks, all end at same tick (interleaved).
    """
    check_no_dlmiss(events, 'T1')
    check_no_dlmiss(events, 'T2')
    check_no_dlmiss(events, 'T3')
    # All must meet deadline=20ms
    check("All tasks meet D=20ms deadline",
          all(find(events, task=t, event='End') is not None and 
              find(events, task=t, event='End')['tick'] <= 20 
              for t in ['T1', 'T2', 'T3']),
          "At least one task missed deadline")


# ── Dispatch ──────────────────────────────────────────────────────────────────
CHECKS = {
    'B1': check_B1, 'B2': check_B2, 'B3': check_B3, 'B4': check_B4, 'B5': check_B5, 'B6': check_B6,
    'P1': check_P1, 'P2': check_P2, 'P3': check_P3,
    'A1': check_A1, 'A2': check_A2,
    'A4': check_A4, 'A5': check_A5,
}

TEST_NAMES = {
    'B1': 'Priority Preemption',
    'B2': 'Constrained Deadlines D<T',
    'B3': 'High Utilization ~95% Stress',
    'B4': 'Overlapping HRT Tasks',
    'B5': 'Edge-Case Tight Boundary',
    'B6': 'Equal Priority Tasks (Round-Robin Enabled)',
    'P1': 'SKIP Policy',
    'P2': 'KILL Policy',
    'P3': 'CATCH_UP Policy',
    'A1': 'PS Single-Period Execution',
    'A2': 'PS Multi-Period Spanning',
    'A4': 'PS OVERRUN_SERVER',
    'A5': 'PS KILL Policy',
}

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print("Usage: verify_test.py <TEST_ID> <qemu_log>")
        sys.exit(1)

    test_id = sys.argv[1].upper()
    log_file = sys.argv[2]

    if test_id not in CHECKS:
        print(f"Unknown test: {test_id}")
        sys.exit(1)

    events = parse_log(log_file)
    CHECKS[test_id](events, verbose=True)

    passed = sum(results)
    total = len(results)
    failed = total - passed
    name = TEST_NAMES.get(test_id, test_id)

    if failed == 0:
        print(f"Test {test_id} — {name}: PASSED ({passed}/{total})")
        sys.exit(0)
    else:
        print(f"Test {test_id} — {name}: FAILED ({failed}/{total} checks failed)")
        sys.exit(1)
