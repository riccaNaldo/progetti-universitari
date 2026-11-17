#!/bin/bash
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

# ============================================================
#  FreeRTOS PTL/ATL Test Suite
#  Usage: ./run_all_tests.sh [TEST_ID ...]
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_CSV_DIR="$SCRIPT_DIR/user_interface/tests"
USER_PERIODIC="$SCRIPT_DIR/user_interface/user_periodic_tasks.csv"
USER_APERIODIC="$SCRIPT_DIR/user_interface/user_aperiodic_tasks.csv"
TEST_LOG_DIR="$SCRIPT_DIR/test_results"
MACHINE="mps2-an385"
CPU="cortex-m3"
ELF="$SCRIPT_DIR/Output/demo.elf"
QEMU_TIMEOUT=8

GREEN='\033[0;32m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'

mkdir -p "$TEST_LOG_DIR"
ALL_TESTS="B1 B2 B3 B4 B5 B6 P1 P2 P3 A1 A2 A4 A5"
TESTS_TO_RUN="${@:-$ALL_TESTS}"
PASS_COUNT=0; FAIL_COUNT=0; FAILED_TESTS=""

echo "============================================================"
echo "  FreeRTOS PTL/ATL Test Suite — $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================================"

for TEST_ID in $TESTS_TO_RUN; do
    TEST_PERIODIC="$TEST_CSV_DIR/${TEST_ID}_periodic.csv"
    TEST_APERIODIC="$TEST_CSV_DIR/${TEST_ID}_aperiodic.csv"
    QEMU_LOG="$TEST_LOG_DIR/${TEST_ID}_qemu.log"
    VERIFY_LOG="$TEST_LOG_DIR/${TEST_ID}_verify.log"
    COMPILE_LOG="$TEST_LOG_DIR/${TEST_ID}_compile.log"

    echo "────────────────────────────────────────────────────────────"
    echo "  Running test: $TEST_ID"
    echo "────────────────────────────────────────────────────────────"

    if [ ! -f "$TEST_PERIODIC" ] || [ ! -f "$TEST_APERIODIC" ]; then
        echo -e "  ${RED}[SKIP] CSV not found for $TEST_ID${NC}"
        FAIL_COUNT=$((FAIL_COUNT+1)); FAILED_TESTS="$FAILED_TESTS $TEST_ID"; continue
    fi

    echo -e "  ${BLUE}[1/3] Compiling...${NC}"
    cp "$TEST_PERIODIC" "$USER_PERIODIC"
    cp "$TEST_APERIODIC" "$USER_APERIODIC"
    make -C "$SCRIPT_DIR" clean > /dev/null 2>&1
    make -C "$SCRIPT_DIR" all > "$COMPILE_LOG" 2>&1
    if [ $? -ne 0 ]; then
        echo -e "  ${RED}[1/3] Compile FAILED${NC}"
        FAIL_COUNT=$((FAIL_COUNT+1)); FAILED_TESTS="$FAILED_TESTS $TEST_ID"; continue
    fi
    echo -e "  ${GREEN}[1/3] Compile OK${NC}"

    echo -e "  ${BLUE}[2/3] Running QEMU (timeout ${QEMU_TIMEOUT}s)...${NC}"
    rm -f "$QEMU_LOG"
    timeout "$QEMU_TIMEOUT" qemu-system-arm \
        -machine "$MACHINE" -cpu "$CPU" -kernel "$ELF" \
        -monitor none -nographic -serial "file:${QEMU_LOG}" \
        -icount shift=6,sleep=off > /dev/null 2>&1 || true
    [ -f "$QEMU_LOG" ] && head -150 "$QEMU_LOG" > "${QEMU_LOG}.tmp" && mv "${QEMU_LOG}.tmp" "$QEMU_LOG"
    LINES=$(wc -l < "$QEMU_LOG" 2>/dev/null || echo 0)
    if [ "$LINES" -eq 0 ]; then
        echo -e "  ${RED}[2/3] QEMU produced no output${NC}"
        FAIL_COUNT=$((FAIL_COUNT+1)); FAILED_TESTS="$FAILED_TESTS $TEST_ID"; continue
    fi
    echo -e "  ${GREEN}[2/3] QEMU done — ${LINES} lines${NC}"

    echo -e "  ${BLUE}[3/3] Verifying...${NC}"
    python3 "$SCRIPT_DIR/verify_test.py" "$TEST_ID" "$QEMU_LOG" 2>&1 | tee "$VERIFY_LOG" | sed 's/^/        /'

    if grep -q "FAILED\|✗" "$VERIFY_LOG" 2>/dev/null; then
        echo -e "  ${RED}✗  Test $TEST_ID: FAIL${NC}"
        FAIL_COUNT=$((FAIL_COUNT+1)); FAILED_TESTS="$FAILED_TESTS $TEST_ID"
    else
        echo -e "  ${GREEN}✓  Test $TEST_ID: PASS${NC}"
        PASS_COUNT=$((PASS_COUNT+1))
    fi
done

echo "============================================================"
echo -e "  SUMMARY: ${PASS_COUNT}/$(($PASS_COUNT+$FAIL_COUNT)) PASSED"
[ -n "$FAILED_TESTS" ] && echo -e "  ${RED}Failed:$FAILED_TESTS${NC}"
echo "  Logs: $TEST_LOG_DIR/"
echo "============================================================"
