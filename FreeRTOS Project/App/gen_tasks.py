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
import sys
import csv
import math

# --- CONSTANTS ---
WORKLOAD_1MS = 1250
MIN_STACK = 256
MIN_PRIO = 2 
MAX_PRIO = 11 
MIN_PS_BUDGET = 3 
#Round-Robin quantum
QUANTUM = 1
FREERTOS_LICENSE_HEADER = """/*
 * FreeRTOS Kernel <DEVELOPMENT BRANCH>
 * Copyright (C) 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * SPDX-License-Identifier: MIT
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * https://www.FreeRTOS.org
 * https://github.com/FreeRTOS
 *
 */"""

VALID_PERIODIC_POLICIES = {"SKIP", "KILL", "CATCH_UP"}
VALID_APERIODIC_POLICIES = {"OVERRUN", "KILL"}

def error(msg):
    print("ERROR:", msg)
    sys.exit(1)

def main():
    if len(sys.argv) != 3:
        print("Usage: python3 gen_tasks.py <periodic_tasks.csv> <aperiodic_tasks.csv>")
        return 1

    periodic_path = sys.argv[1]
    aperiodic_path = sys.argv[2]

    periodic_tasks = []
    aperiodic_tasks = []
    # Global counter for unique task IDs (ulId)
    task_id_counter = 1 

    # =========================================================================
    # 1. PARSING PERIODIC TASKS CSV
    # Format: Name, Period, Deadline, Priority, Stack, WCET, Policy, Phase
    # =========================================================================
    with open(periodic_path, "r", encoding="utf-8") as f:
        reader = csv.reader(f, skipinitialspace=True)
        for row_num, parts in enumerate(reader, start=1):
            
            # Ignore intentionally empty lines
            if not parts or all(p.strip() == "" for p in parts):
                continue

            # Ignore comments
            if parts[0].strip().startswith("#"):
                continue

            # Check if the name is missing but other data is present
            if parts[0].strip() == "":
                error(f"Line {row_num}: Task name is missing, but other data is present.")

            if len(parts) < 6:
                error(f"{periodic_path} Line {row_num}: Requires at least 6 fields (Name, Period, Deadline, Prio, Stack, WCET).")

            name = parts[0].strip()
            
            try: period = int(parts[1])
            except ValueError: error(f"{periodic_path} Line {row_num}: Period must be an integer.")

            try: deadline = int(parts[2]) if parts[2].strip() != "" else period
            except ValueError: error(f"{periodic_path} Line {row_num}: Deadline must be an integer.")

            try: prio = int(parts[3]) if parts[3].strip() != "" else MIN_PRIO
            except ValueError: error(f"{periodic_path} Line {row_num}: Priority must be an integer.")

            try: stack = int(parts[4])
            except ValueError: error(f"{periodic_path} Line {row_num}: Stack must be an integer.")

            try: wcet = int(parts[5])
            except ValueError: error(f"{periodic_path} Line {row_num}: WCET must be an integer.")

            policy = parts[6].strip().upper() if len(parts) > 6 and parts[6].strip() != "" else "SKIP"
            
            if policy not in VALID_PERIODIC_POLICIES:
                print(f"WARNING: Periodic task '{name}' policy '{policy}' is invalid or not allowed. Defaulting to SKIP.")
                policy = "SKIP"

            # Phase shifts to index 7 since Type was removed
            try: phase = int(parts[7]) if len(parts) > 7 and parts[7].strip() != "" else 0
            except ValueError: error(f"{periodic_path} Line {row_num}: Phase must be an integer.")

            # Validations
            if period <= 0: error(f"{periodic_path} Line {row_num}: Period must be > 0.")
            if wcet <= 0: error(f"{periodic_path} Line {row_num}: WCET must be > 0.")
            if deadline <= 0: deadline = period
            if stack < MIN_STACK: stack = MIN_STACK
            if prio < MIN_PRIO: prio = MIN_PRIO
            if prio > MAX_PRIO: prio = MAX_PRIO
            if phase < 0: phase = 0

            ident = "".join([ch if ch.isalnum() else "_" for ch in name])

            periodic_tasks.append({
                "name": name,
                "ident": ident,
                "period": period,
                "deadline": deadline,
                "phase": phase,
                "prio": prio,
                "stack": stack,
                "wcet": wcet,
                "policy": policy
            })
            task_id_counter += 1

    # =========================================================================
    # 2. PARSING APERIODIC TASKS CSV
    # Format: Name, Activation Time, Relative Deadline, WCET, Policy
    # =========================================================================
    with open(aperiodic_path, "r", encoding="utf-8") as f:
        reader = csv.reader(f, skipinitialspace=True)
        for row_num, parts in enumerate(reader, start=1):
            
            # Ignore intentionally empty lines
            if not parts or all(p.strip() == "" for p in parts):
                continue

            # Ignore comments
            if parts[0].strip().startswith("#"):
                continue

            # Check if the name is missing but other data is present
            if parts[0].strip() == "":
                error(f"Line {row_num}: Task name is missing, but other data is present.")

            if len(parts) < 4:
                error(f"{aperiodic_path} Line {row_num}: Requires at least 4 fields (Name, Activation Time, Rel Deadline, WCET).")

            name = parts[0].strip()
            
            try: activation_time = int(parts[1])
            except ValueError: error(f"{aperiodic_path} Line {row_num}: Activation Time must be an integer.")

            try: deadline = int(parts[2])
            except ValueError: error(f"{aperiodic_path} Line {row_num}: Relative Deadline must be an integer.")

            try: wcet = int(parts[3])
            except ValueError: error(f"{aperiodic_path} Line {row_num}: WCET must be an integer.")

            policy = parts[4].strip().upper() if len(parts) > 4 and parts[4].strip() != "" else "OVERRUN"
            
            if policy not in VALID_APERIODIC_POLICIES:
                print(f"WARNING: Aperiodic task '{name}' policy '{policy}' is invalid or not allowed. Defaulting to OVERRUN.")
                policy = "OVERRUN"

            if activation_time < 0: error(f"{aperiodic_path} Line {row_num}: Activation Time cannot be negative.")
            if deadline <= 0: error(f"{aperiodic_path} Line {row_num}: Relative Deadline must be > 0.")
            if wcet <= 0: error(f"{aperiodic_path} Line {row_num}: WCET must be > 0.")

            aperiodic_tasks.append({
                "name": name,
                "activation_time": activation_time,
                "deadline": deadline,
                "wcet": wcet,
                "policy": policy,
                "id": task_id_counter # For the .ulId field in AperiodicRequest_t
            })
            task_id_counter += 1

    # =========================================================================
    # 3. POLLING SERVER DIMENSIONING (RTA)
    # =========================================================================
    def check_rta(tasks_to_check, q):
        
        for i, task_i in enumerate(tasks_to_check):
        
            # Initial Response Time (R) starts as the task's own WCET.
            R = task_i["wcet"]
        
            while True:
                # If the calculated response time exceeds the deadline, the task is not schedulable
                if R > task_i["deadline"]:
                    return False
            
                interference_hp = 0
                interference_sp = 0
            
                for j, task_j in enumerate(tasks_to_check):
                
                    # SCENARIO A: Tasks with STRICTLY HIGHER priority (Preemption)
                    if task_j["prio"] > task_i["prio"]:
                        # Calculate how many times task_j activates during the current window R
                        activations_hp = math.ceil(R / task_j["period"])
                        interference_hp += activations_hp * task_j["wcet"]
                    
                    # SCENARIO B: Tasks with the SAME priority (Round-Robin Interference)
                    elif i != j and task_j["prio"] == task_i["prio"]:
                        # Total workload generated by task_j's activations within window R
                        activations_sp = math.ceil(R / task_j["period"])
                        total_sp_workload = activations_sp * task_j["wcet"]
                    
                        # Maximum structural limit imposed by the Round-Robin quantum.
                        # Represents how much time task_j can steal based on task_i's time slices.
                        time_slices_i = math.ceil(task_i["wcet"] / q)
                        rr_structural_limit = time_slices_i * q
                    
                        # The actual interference is bounded by the worst-case structural limit
                        interference_sp += min(total_sp_workload, rr_structural_limit)
            
                # Recalculate the new Response Time by combining all components
                R_new = task_i["wcet"] + interference_hp + interference_sp
            
                # Convergence check: If R stops growing, we found the Worst-Case Response Time
                if R_new == R:
                    break 
            
                R = R_new
            
        return True

    # Notify the user if the pessimistic Round-Robin logic will impact the PS budget
    if periodic_tasks:
        priorities = [t["prio"] for t in periodic_tasks]
    
        if len(priorities) != len(set(priorities)):
            print("\nINFO: Multiple tasks share the same priority.")
            print("      RTA will apply dynamic Round-Robin interference logic.")
            print("      This guarantees safety but may reduce the Polling Server budget.")

    ps_period = 1000
    ps_budget = 0

    if periodic_tasks:
        ps_period = min([t["period"] for t in periodic_tasks])
    
        # Validate the basic task set with the updated RTA function
        if not check_rta(periodic_tasks, QUANTUM):
            print("WARNING: The periodic task set is NOT schedulable on its own!")
            ps_budget = 0
        else:
            test_budget = 1
            while True:
                server_task = {
                    "name": "Polling_Server",
                    "period": ps_period,
                    "deadline": ps_period,
                    "prio": MAX_PRIO + 1,
                    "wcet": test_budget
                }
            
                test_set = periodic_tasks + [server_task]
            
                # Incrementally increase the Polling Server budget until RTA fails
                if check_rta(test_set, QUANTUM):
                    ps_budget = test_budget
                    test_budget += 1
                else:
                    break 
    else: # If no periodic tasks are present
        ps_period = 50
        ps_budget = 5
    
    if ps_budget > 0 and ps_budget < MIN_PS_BUDGET:
        print(f"INFO: Calculated PS Budget ({ps_budget} ms) is below the threshold ({MIN_PS_BUDGET} ms).")
        print("      Polling Server will be disabled to avoid context switch overhead.")
        ps_budget = 0

    print("\n--- POLLING SERVER DIMENSIONING (RTA) ---")
    if ps_budget > 0:
        print(f"Server Period (Ts): {ps_period} ms")
        print(f"Server Capacity (Cs): {ps_budget} ms")
        print(f"Server Priority: {MAX_PRIO + 1}")
    else:
        print("WARNING: Not enough idle time. Polling Server budget is 0.")
        
    # =========================================================================
    # 4. CODE GENERATION HELPER
    # =========================================================================
    def generate_periodic_files(tasks_list):
        base_name = "generated_periodic_tasks"
        prefix = "g_xGeneratedTasks"
        num_macro = "GEN_NUM_TASKS"
        
        with open(f"{base_name}.h", "w", encoding="utf-8") as h:
            h.write(FREERTOS_LICENSE_HEADER)
            h.write(f"#ifndef {base_name.upper()}_H\n")
            h.write(f"#define {base_name.upper()}_H\n\n")
            h.write('#include "PTL.h"\n\n')
            h.write(f"#define WORKLOAD_1MS ({WORKLOAD_1MS}UL)\n\n")
            h.write(f"#define {num_macro} {len(tasks_list)}\n\n")
            h.write(f"extern const TaskConfig_t {prefix}[{num_macro}];\n\n")
            h.write("void vDummyTask(void *pvParameters);\n\n")
            h.write("#endif\n")

        with open(f"{base_name}.c", "w", encoding="utf-8") as c:
            c.write(FREERTOS_LICENSE_HEADER)
            c.write(f'#include "{base_name}.h"\n')
            c.write('#include "FreeRTOS.h"\n')
            c.write('#include "task.h"\n')
            c.write("#include <stdint.h>\n\n")
            
            c.write("void vDummyTask(void *pvParameters) {\n")
            c.write("    uint32_t workload = *(uint32_t*)pvParameters;\n")
            c.write("    for (volatile uint32_t i = 0; i < workload; i++) {\n")
            c.write("        __asm volatile (\"nop\");\n")
            c.write("    }\n")
            c.write("}\n\n")

            for t in tasks_list:
                loops = t["wcet"] * WORKLOAD_1MS
                c.write(f"static uint32_t ulWork_{t['ident']} = {loops}UL;\n")
                c.write(f"static StackType_t xStack_{t['ident']}[ {t['stack']} ];\n")
                c.write(f"static StaticTask_t xTCB_{t['ident']};\n\n")

            c.write(f"const TaskConfig_t {prefix}[{num_macro}] = {{\n")
            for t in tasks_list:
                c.write("  {\n")
                c.write(f'    .pcName = "{t["name"]}",\n')
                c.write("    .pvTaskCode = vDummyTask,\n")
                c.write(f"    .pvParameters = &ulWork_{t['ident']},\n")
                c.write(f"    .uxStackDepth = {t['stack']},\n")
                c.write(f"    .uxPriority = {t['prio']},\n")
                c.write(f"    .xPeriod = {t['period']},\n")
                c.write(f"    .xDeadline = {t['deadline']},\n")
                c.write(f"    .xPhase = {t['phase']},\n")
                c.write(f"    .ePolicy = {t['policy']},\n")
                c.write(f"    .xIsPeriodic = pdTRUE,\n")
                c.write(f"    .pxStackBuffer = xStack_{t['ident']},\n")
                c.write(f"    .pxTCBBuffer = &xTCB_{t['ident']}\n")
                c.write("  },\n")
            c.write("};\n")

    def generate_aperiodic_files(tasks_list, t_s, c_s, max_prio):
        base_name = "generated_aperiodic_tasks"
        prefix = "g_xAperiodicRequests"
        num_macro = "GEN_NUM_APERIODIC_TASKS"
        
        with open(f"{base_name}.h", "w", encoding="utf-8") as h:
            h.write(FREERTOS_LICENSE_HEADER)
            h.write(f"#ifndef {base_name.upper()}_H\n")
            h.write(f"#define {base_name.upper()}_H\n\n")
            h.write('#include "ATL.h"\n\n') 
            
            h.write("// --- POLLING SERVER PARAMETERS ---\n")
            h.write(f"#define PS_PERIOD_TICKS pdMS_TO_TICKS({t_s})\n")
            h.write(f"#define PS_BUDGET_TICKS pdMS_TO_TICKS({c_s})\n\n")
            h.write(f"#define PS_PRIORITY ({max_prio})\n\n")
            
            h.write(f"#define {num_macro} {len(tasks_list)}\n\n")
            h.write(f"extern const AperiodicRequest_t {prefix}[{num_macro}];\n")
            h.write("#endif\n")

        with open(f"{base_name}.c", "w", encoding="utf-8") as c:
            c.write(FREERTOS_LICENSE_HEADER)
            c.write(f'#include "{base_name}.h"\n')
            c.write('#include "FreeRTOS.h"\n')
            c.write('#include "task.h"\n')
            c.write("#include <stdint.h>\n\n")

            c.write(f"const AperiodicRequest_t {prefix}[{num_macro}] = {{\n")
            for t in tasks_list:
                c.write("  {\n")
                c.write(f'    .pcName = "{t["name"]}",\n') 
                c.write(f"    .xRelativeDeadline = pdMS_TO_TICKS({t['deadline']}),\n")
                c.write(f"    .xActivationTime = pdMS_TO_TICKS({t['activation_time']}),\n")
                c.write(f"    .xWcet = pdMS_TO_TICKS({t['wcet']}),\n")
                c.write(f"    .xWcetLeft = pdMS_TO_TICKS({t['wcet']}),\n") 
                c.write(f"    .ePolicy = {t['policy']},\n")
                c.write(f"    .ulId = {t['id']}\n")
                c.write("  },\n")
            c.write("};\n")
            
    # =========================================================================
    # 5. EXECUTION & OUTPUT
    # =========================================================================
    if periodic_tasks:
        generate_periodic_files(periodic_tasks)
        print("\nOK: generated_periodic_tasks.c and generated_periodic_tasks.h created successfully.")
    
    effective_budget = ps_budget if aperiodic_tasks else 0
    generate_aperiodic_files(aperiodic_tasks, ps_period, effective_budget, MAX_PRIO + 1)
    print("OK: generated_aperiodic_tasks.c and generated_aperiodic_tasks.h created successfully.")

    total_load = 0.0
    for t in periodic_tasks:
        total_load += t["wcet"] / t["period"]
    
    if ps_budget > 0 and ps_period > 0:
        total_load += ps_budget / ps_period

    load_percentage = round(total_load * 100, 2)
    print(f"\nTotal CPU Load: {load_percentage}%")
    
    if total_load > 1.0 or ps_budget == 0:
        print("==========================================================")
        print(" WARNING: System is NOT schedulable or Server budget is 0.")
        print("==========================================================")

    return 0

if __name__ == "__main__":
    sys.exit(main())
