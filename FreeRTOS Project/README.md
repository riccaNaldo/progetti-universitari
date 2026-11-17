# Priority-Based Scheduler for Periodic Tasks with Polling Server 
This project implements a Priority-Based Scheduler on FreeRTOS that supports both periodic tasks (handled by the Periodic Task Layer (PTL)) and aperiodic tasks with a Polling Server (handled by the Aperiodic Task Layer (ATL)). The system is emulated using a QEMU emulator.

---
## Table Of Contents
1. [Architecture](#1-architecture)
2. [Periodic Task Layer](#2-periodic-task-layer)
3. [Aperiodic Task Layer](#3-aperiodic-task-layer)
4. [Memory Management](#4-memory-management)
5. [Empirical Overhead](#5-empirical-overhead)
6. [Logs](#6-logs)
7. [Test](#7-test)
8. [Python Suite](#8-python-suite)
9. [Usage](#9-usage)

--- 
## 1. Architecture

### 1.1 System Priority Hierarchy
The system is configured with 15 priority levels. Here we show how they are assigned:

| Priority Level | Task Category | Description |
| :---: | :--- | :--- |
| `configMAX_PRIORITIES - 1` (**14**) | **Overrun Policy Enforcement Task** | The highest priority task. It applies overrun policies to the periodic tasks. |
| **13**| **PS Notifier** | It guarantees immediate preemption to send aperiodic requests to the Polling Server queue without being delayed by standard periodic tasks. |
| **12**| **Polling Server** | The PS has a priority strictly greater than periodic tasks to ensure maximum promptitude to the satisfaction of aperiodic requests |
| **[2-11]** | **Periodic Tasks** | Hard Real-Time user tasks defined in `periodic_tasks.csv`. Developers assign these priorities freely. |
| **1** | **LOGGER** | Low-priority task that logs the events. |
| `tskIDLE_PRIORITY` (**0**) | **FreeRTOS Idle Task** | The system idle task. It runs exclusively when the CPU is completely free and the Polling Server is dormant. |

### 1.2 Task Control Block 
Each task is described by the data structure `TaskConfig_t` with all static metadata.

This datastructure is wrapped in the `TaskControlBlock_t` data structure that contains all values that will be modified runtime. This data structure is the *image* of the status of our periodic Task. As we will see in later sections this will be the data structure used for managing periodic Tasks.
```C
---PTL.h---
typedef struct{
TaskConfig_t * xUserTask;
TaskHandle_t pxTaskHandle; /* Unique task identifier */
TickType_t xReleaseTick;
TickType_t xOverrunTick;
TickType_t xStartingTick; 
TickType_t xDeadlineTick;
uint8_t ucIsOverrunning;
uint8_t ucIsRunning; /* N.B. job running != status of the FreeRTOS Task!!!!! */
uint32_t uiJobMiss;
BaseType_t xValidDeadline; 
StaticTask_t * pxTCB;
StackType_t * pxStackBuffer;
} TaskControlBlock_t;
```

### 1.3 Aperiodic Request
```C
typedef struct{
    const char* pcName;
    TickType_t xRelativeDeadline;
    TickType_t xActivationTime;
    TickType_t xWcet;
    TickType_t xWcetLeft;
    uint8_t ePolicy;
    uint32_t ulId;
} AperiodicRequest_t;
```
Unlike the Periodic Layer, aperiodic requests are not instantiated as actual FreeRTOS tasks. Instead, the polling server simulates their execution by running `vDummyTask`, moreover the aperiodic requests can have one of two policies: KILL or OVERRUN.
Each `AperiodicRequest_t` carries the `xWcetLeft` field to track remaining execution time: it is initialized to the original wcet and decremented by the polling server at each execution chunk.
If the budget runs out before the request is completed, `xWcetLeft` will be equal to the remaining execution time, and in the next period the request will be treated as pending and resumed.

## 2. Periodic Task Layer

### 2.1 Periodic Task Wrapper
The `prvPeriodicTaskWrapper` is the function in which the task are executed. Once a task is created, its tcb gets wrapped. In the wrapper it will execute its function and update variables such as ticks and booleans.

Let's make `prvPeriodicTaskWrapper` simple:

1. From the parameter **retrieve itself** (all it's infos give as parameter) `TaskControlBlock_t *pxTCB = (TaskControlBlock_t *) pvParameters;`. This must be done since the wrapper is generic and is created for every different task.
2. Delays its execution according to initial phase.
3. Enter in the *inifite* `for(;;)`
    - Set status variables: `xOverrunTick`,`xDeadlineTick`,`ucIsRunning`,`ucIsOverrunning`
    - Logs the start
    - Executes the *user level* task
    - Set `ucIsRunning = 0;`
    - Logs the end
    - Wait until the next wake-up time

Basically this wrapper is only reporting his status by updating status variables.

The only problem is that the *wrapper has no any kind of control on itself* rather than sleeping on the next wake-up time.

This is where the **Hook Callback Function** `vOverrunMonitorTickHook`and its **deferred interrupt processing task** `prvOverrunPolicyEnforcer` come into play.

> We managed to use the `traceTASK_INCREMENT_TICK` hook function since **maximum portability** is one of the requirements. The idea behind this decision is that we didn't want to deprive the user from being able to exploit the `vApplicationTickHook` hook function made public by the FreeRTOS developers, moreover we didn't want to change the FreeRTOS `task.c` at all, avoiding the insertion of any kind of lines of code. So we managed to use a "debugging" hook for our scope. This enhances 100% portability and also highly reduces the intrusion into the user level space.

Since the `vOverrunMonitorTickHook` runs into a ISR context is light and fast. Check *every single* overrun tick of all the *suitable* tasks and if a policy must be applied it will push the ID of the task into a queue and then enables the **deferrable interrupt mechanism** by executing `portYIELD_FROM_ISR( xHigherPriorityTaskWoken );`.

This last instruction will wake up `prvOverrunPolicyEnforcer` that is in a blocked state on the ID's queue.

Basically `prvOverrunPolicyEnforcer` waits for any taskID that is overruning, and it wakes up when 
`vOverrunMonitorTickHook` find one or more of them.

![image](./others/queu.svg)

> The of having an **array** of `TaskControlBlock_t` and go through all of them is 'ok' since from the requirements \#Tasks $\ge8$. For ID we are referring to the index of the `TaskControlBlock_t` array. This solution is not scalable BUT with little modification same results can be achieved by using a queue of ready tasks and passing it's `TaskControlBlock_t` to the `prvOverrunPolicyEnforcer`

### 2.2 Policy Enforcement
The policies are handled by the `prvOverrunPolicyEnforcer`, which upon receiving a notify it checks and applies the policy to the time-exceeding task and raises and records the event.
- **KILL**: the task gets deleted and then recreated

![image](./others/KILL.svg)
- **CATCH UP**: the task's status variable `ucIsOverrunning` is set to 1. This will let the task run and be invisible to the `vOverrunMonitorTickHook` *until he CATCHes UP*.
- **SKIP**: job miss counter is increased and the **time window** is shifted. This allow to shift the starting time, hence when the task will be finished the wrapper will wait unitl the shifted starting tick. This creates a **"hole"** in the scheduling that is not present in the Catch Up.
```C
case SKIP:
    pxTCB->uiJobMiss++;
    /* Sliding window */
    pxTCB->xReleaseTick = pxTCB->xOverrunTick;
    pxTCB->xOverrunTick = pxTCB->xReleaseTick + pxTCB->xUserTask->xPeriod;
    break;
```

![image](./others/SKIP_CATCHUP.svg)

## 3. Aperiodic Task Layer
### 3.1 Basic workflow
The ATL follows the idea of the PTL, but instead of using actual task we simulated it by using requests. The system works like this:
1. The `prvPSNotifier` takes the request generated by the framework using the user's input and places them in the `xStaticQueue` through a dedicated API (`xAPI_SubmitAperiodic`), designed to allow any part of the system to submit aperiodic requests. In this implementation the notifier is the only one using it, but the interface is general.
2. The Polling Server checks if there is a pending request (`ucHasActiveRequest == 1`) or if there're requests in the queue it schedules them, otherwise it returns.
3. If the available budget (`xRemainingBudget`) is greater than 0, the polling server first checks if for a pending request (i.e. one with `xWcetLeft > 0` partially executed in a previous period) and resumes it. Only once there's no pending request left, it dequeues and schedules new ones via `xQueueReceive` from `xAperiodicPool`. If the remaining budget is not sufficient, the first request will be executed partially and its remaining `xWcetLeft` is carried over for next period.
### 3.2 Aperiodic Policies
If the execution of a request exceeds the deadline (`xCurrentTick >= xAbsoluteDeadline`), instead of relying on the `prvOverrunTaskManager`, the polling server handles it by itself in order to make it simplify it.
As said in the Architecture section, an aperiodic request can have one of two possible policies:
1. KILL: the request gets their `xWcetLeft` set to 0 and the `ucHasActiveRequest` is set to 0 in order to prevent the polling server to execute it that same request in a new cycle 
2. OVERRUN: the request gets `ucAlreadyLoggedMiss` set to 1, the logger prints the deadline miss via `vRecordTraceEvent`, and the polling server executes it normally

```C
 if (xCurrentRequest.ePolicy == KILL)
            {

                vRecordTraceEvent(xCurrentTick, eTraceOverrunKill, xCurrentRequest.pcName, xCurrentRequest.ulId, 1);

                vRecordTraceEvent(xCurrentTick, eTraceTaskEnd, xCurrentRequest.pcName, xCurrentRequest.ulId, 1);

                xCurrentRequest.xWcetLeft = 0; // Remaining time for the killed task is deleted
                
                ucHasActiveRequest = 0;
                continue; // Starts from the while to extract the next aperiodic request in the queue

            }
            
            else if (xCurrentRequest.ePolicy == OVERRUN){
                vRecordTraceEvent(xCurrentTick, eTraceOverrun, xCurrentRequest.pcName, xCurrentRequest.ulId, 1);

                ucAlreadyLoggedMiss = 1;
            }
```
### 3.3 Chunk Dimensioning
The chunk (`xChunkToExecute`) is dimensioned in two steps:
1. If `zWcetLeft <= xRemainingBudget`, then `xChunkToExecute = xWcetLeft`; otherwise `xChunkToExecute = xRemainingBudget`.
2. If the deadline is in the current loop (`xCurrentTick < xAbsoluteDeadline`), we compute the ticks from the current tick to the absolute deadline (`xTicksToDeadline = xAbsoluteDeadline - xCurrentTick`): if `xChunkToExecute > xTicksToDeadline`, the chunk will be shrunk to said value (`xChunksToExecute = xTicksToDeadline`).  In this way the next cycle will start exactly when the deadline will be missed, allowing the prior check to log the deadline exactly when it occurs.

## 4. Memory Management

To guarantee deterministic execution and make memory management safer this architecture completely discards dynamic heap allocation. Instead, it enforces a strict **static allocation** paradigm. The following sections detail the mechanisms, software tools, and kernel configurations deployed to securely manage the system's memory layout.

### 4.1 Advantages of Disabling Dynamic Allocation
Dynamic memory provisioning (using standard malloc or FreeRTOS functions like pvPortMalloc) presents two risks for RTOS: **heap fragmentation** and **non-deterministic execution**. During execution, fragmentation can lead to allocation failures despite having adequate total free memory. Additionally, the variable time required to locate an available memory block fundamentally breaks real-time predictability.
By setting `configSUPPORT_DYNAMIC_ALLOCATION` to 0 in `FreeRTOSConfig.h`, the dynamic heap manager is entirely removed. All kernel objects, Task Control Blocks, task stacks, and queues are allocated statically. This allows memory usage to be verified at link time.

### 4.2 Python Framework as a Compile-Time Bridge
While static allocation guarantees predictability, it typically lacks flexibility when handling variable application configurations. To achieve structural agility without sacrificing deterministic properties, the architecture utilizes an offline Python script (`gen_tasks.py`) as an intermediary code generator.

The Python framework parses the system workload requirements directly from user-defined CSV files. It automatically computes scheduling parameters (see [RTA Analysis](#83-response-time-analysis-rta-and-polling-server-dimensioning)) and writes these variables directly into static C arrays and structures (`generated_periodic_tasks.c/.h` and `generated_aperiodic_tasks.c/.h`).  This design allows to statically allocate the tasks from the user without knowing any parameter a-priori.

### 4.3 Memory Protection and the 'const' Qualifier
Memory integrity and robustness against data corruption are actively enforced through both hardware offloading and active kernel monitoring:

* **`const` qualifier:** All generated task configuration structures (such as the `g_xGeneratedTasks` and `g_xAperiodicRequests` arrays) are declared using the C `const` keyword. This allows the compiler to put these objects into `.rodata`, which are mapped by the linker script into the microcontroller's FLASH memory. Consequently, task configuration data remain immutable throughout execution, preventing accidental or unauthorized modification while reducing SRAM usage.

* **xPhase attribute:** Because task configuration structures are stored in read-only memory, their fields cannot be modified during execution. To support runtime scheduling, the initial activation offset (`xPhase`) is preserved as an immutable configuration parameter, while the runtime value (`xCurrentPhase`) is stored separately inside the corresponding `TaskControlBlock_t`. This separation prevents the scheduler from attempting to modify data residing in read-only FLASH memory.

* **Const Pointer for Task Configurations:** Within `TaskControlBlock_t`, the task configuration is referenced through a pointer declared as `const TaskConfig_t *xUserTask`. This denotes a pointer to constant data, ensuring that the configuration object cannot be modified through this reference. Since the referenced `TaskConfig_t` instances are stored in the read-only `.rodata` section (mapped to FLASH by the linker), this qualifier provides compile-time protection against accidental writes to immutable task parameters such as `xPeriod`, `xDeadline`, and `uxPriority`.

* **Kernel Overrun Protection:** To catch execution bugs before they cause silent data corruption in adjacent memory regions, stack sanity is monitored via FreeRTOS runtime hooks. Activating stack overflow checking via `configCHECK_FOR_STACK_OVERFLOW` in `FreeRTOSConfig.h` allows the kernel to intercept tasks that breach their pre-allocated boundaries, immediately halting the system.

### 4.4 Role of `static_kernel_functions.c`
When dynamic memory allocation is fully disabled, the FreeRTOS kernel loses its native ability to automatically provision memory for its own internal system tasks. Consequently, the program itself is required to explicitly supply the memory buffers needed for these baseline functions.

The file `static_kernel_functions.c` implements the mandatory kernel callback `vApplicationGetIdleTaskMemory()`. Within this function, static variables are defined to hold the Idle Task's Control Block (`xIdleTaskTCB`) and its dedicated execution stack array (`uxIdleTaskStack`). When `vTaskStartScheduler()` is called, the kernel invokes this hook to safely obtain the exact hardware memory addresses for the Idle Task, enabling a clean system boot without any hidden dynamic dependencies.




## 5. Empirical Overhead
In this section will be discussed the entire pipeline followed for achieving a empirical overhead evaluation of our system.

### 5.1 Hardware independent virtualization speed
Execution time is independent from the host machine's physical hardware to guarantee repeatable real-time evaluation. 

This is achieved via the Makefile QEMU parameters:
```Makefile
 qemu_start:  
    qemu-system-arm -machine mps2-an385 -cpu cortex-m3 -kernel \\
    $(ELF) -monitor none -nographic -serial stdio \\
    -icount shift=6,sleep=off
```
where `-icount shift=6` forces the QEMU clock period to $2^6 = 64 ns$. Hence $f=15.625 MHz$. Also `sleep=off` disables synchronization with the host wall-clock time.
In `FreeRTOSConfig.h`, `configTICK_RATE_HZ` is set to $1000$, yielding a deterministic scheduler resolution of $|\text{Tick}| = 1 ms$.

### 5.2 FreeRTOS Scheduling overhead
![image](./others/Calibr.svg)

In this section we will evaluate the **FreeRTOS empirical scheduling overhead**.

This evaluation was conducted using standalone code. Below is a high-level explanation of the calibration methodology.

The calibration reflects a best-case scenario. Since `vCalibrationTask` is the only running task, the scheduler does not perform any context switches.

`vCalibrationTask`:
1. It executes a massive, deterministic *loop workload* at the highest priority while recording Starting and Ending Tick.
2. It computes the execution time ($\Delta$) as: $\Delta = \text{Ending tick} - \text{Starting tick}$.
3. By dividing the total number of iterations by this time delta, it derives the precise constant required for the main application's mathematical benchmarks:  
```C  
#define LOOPS_PER_MS  1213UL
```
### 5.3 Empirical overhead
![image](./others/overhead.svg)

From requirements: System overhead (PTL deadline tracking and policies application) must strictly remain $\leq 10\%$. This is empirically measured at runtime using `vOverheadProbeTask`.

---

The probe operates at the *lowest priority*. It attempts to execute a loop calibrated to take exactly $10,000 ms$ of uninterrupted CPU time. This calibration is made using the `LOOPS_PER_MS` value (calculated with the `vCalibrationTask`).

Since we know that `LOOPS_PER_MS` is the maximum amount of loops in a single tick that can be made considering FreeRTOS Scheduling best case scenario. Than we can evaluate the **overhead** introduced by out ATL and PTL layers by evaluating the $\Delta$ of the Starting and Ending tick.

$$
Overhead(\%) = \left(\frac{\Delta}{10000 ms} -1\right)\cdot100
$$

> (Critical observation) The loops that perform the worload **MUST BE THE SAME** for both `vOverheadProbeTask` and `vCalibrationTask`.

This rigorous empirical profiling guarantees deterministic operational bounds.

#### 5.4 Mathematical Model of the Profiling Tool
* $T$: Total theoretical CPU time available within a specified measurement period.
* $F$: Empirical scheduling overhead introduced by the FreeRTOS baseline.
* $PTL$: Target overhead introduced by the Periodic Task Layer logic.
* $C$: Measured CPU time dedicated strictly to payload execution during the baseline calibration (system without PTL).
* $P$: Measured CPU time dedicated strictly to payload execution during the probe task (system with PTL active).
* $\mathbb{E}[\cdot]$: Expected value function, representing the empirical average over multiple sampling iterations.

The execution time distribution for the calibration and probe phases can be modeled as follows:

$$\mathbb{E}[C] = T - F$$

$$\mathbb{E}[P] = T - F - PTL$$

By substituting the expected calibration time into the probe equation, we isolate the $PTL$ variable to compute the final expected overhead:


$$PTL = \mathbb{E}[C] - \mathbb{E}[P]$$

### 5.5 Operation boundries
The worst case scenario that can happen is a enormous amount of KILL policy that needs to be applied in a very short time.

This can be made exploting our dummy task as follow:
```C
void vDummyTask(void *pvParameters) {
    vTaskDelay(pdMS_TO_TICKS(2 * PERIOD));
}
```
With this specific configuration, the dummy task will exist and therefore scheduled, since it exist is also visible from our PTL and thus policy will be applied accordingly. Moreover it will have the minimum impact possible on the overhead becuase it will instantly call `vTaskDelay`.

Since the maximum number of task is 8, we take 8 task with all the same period and all under the KILL policy and in the following images are the results of our Tool where $x$ is the PERIOD and the $y$ is the Overhead \%:

![image](./others/graph.png)

The precision of this profiling tool is strictly bounded by the accuracy of the initial FreeRTOS scheduling calibration. Any jitter or noise captured during the baseline measurement inherently propagates to the final calculation. Furthermore, because this mathematical framework relies on expected values, the result quantifies the average systemic overhead rather than the Worst-Case Execution Time (WCET). Consequently, this empirical approach successfully identifies the system's typical operational mean, but it does not guarantee a strict deterministic upper bound for critical boundary scenarios.

### 5.6 Limitations
Something strange happen when $PERIOD=11$. The output is the following

`Target: 10000ms | Real: 9973 ms | OH: 4294967269 ms (4294.69%)`

In this case this weird result come from $\Delta = \text{Real}-\text{Target} < 0$

So it clear that this empirical method which logic is based on loops and counters is not the perfect solution. The program is limited by the micro-overhead of its own tracking functions, as executing `xTaskGetTickCount` and managing the PTL logic consumes clock cycles during the measurement window. Because these measurement delays are embedded directly within the runtime loop, obtaining perfectly precise timestamps of the task boundaries is extremely difficult. Moreover the act of measuinr overhead introduce overhead itself.

### 5.7 Future Works
For future development, adding special hooks connected directly to the hardware timer will allow us to count the exact clock cycles used by each software operation. This will overcome the resolution limits of the system tick.

**Note:** The scheduling logic and fault management models remain mathematically correct and valid. This hardware-level change would only be implemented to make the measurements more precise.

## 6. Logs
This module implements a deterministic, queue-based event logging subsystem for FreeRTOS, coupled with a bare-metal UART driver. It is designed to track task execution, overruns, and deadline misses while adhering to strict real-time and static-memory constraints.  

### 6.1 Trace Event Architecture

Every log message uses a standardized `TraceEvent_t` structure to ensure a uniform memory footprint in the queue. This struct captures the exact timing (`xTimestamp`), the executing task name (`pcTaskName`), job misses (`usJobMiss`), and deadline misses (`ucDeadlineMiss`). System behavior is explicitly categorized by the `eTraceEventType_t` enumeration, which defines standard scheduling milestones and overrun mitigation states (e.g., Kill, Skip, Catch-Up).

### 6.2 UART Driver Subsystem

To eliminate the overhead of external libraries, output is routed through a custom, bare-metal UART driver. Configured with a fixed Baud Rate divider (`UART0_BAUDDIV = 16UL`), transmission relies on deterministic, busy-wait polling. By masking the` UART_STATE_TXBF` register, the software guarantees the hardware buffer is clear before transmitting the next byte, ensuring reliable output without requiring interrupts.

### 6.3 Logger Layer (Producer-Consumer)

Logging directly to a peripheral from high-priority tasks creates unacceptable real-time latency. This architecture decouples the process: producers (tasks or ISRs) populate an event struct and push it to `xTraceQueue` with zero block time. This guarantees mission-critical execution is never delayed. A low-priority consumer (`vTracePrinterTask`) pends on this queue, waking only to format and transmit the buffered data via UART.

### 6.4 Static Memory Management

Aligning with the system's static allocation paradigm, the logger bypasses dynamic heap allocation. The event queue is provisioned at compile time for exactly 256 events (`TRACE_BUFFER_SIZE`) using `xQueueCreateStatic`. A hard system assertion (`configASSERT`) verifies queue initialization to guarantee kernel safety before any task runs. 

### 6.5 Deterministic Formatting

Standard C library formatting routines (like `printf`) are bloated and non-deterministic. The logger bypasses them entirely, utilizing custom, lightweight static functions (`prvUIntToString`, `prvStrCpy`, and enum-to-string mappers). This guarantees predictable execution times and clean, aligned terminal output without burning unnecessary stack space.

## 7. Test
# FreeRTOS PTL/ATL Automated Test Suite

## 7.1 Overview

This directory contains an automated test framework for validating the **Periodic Task Library (PTL)** and **Aperiodic Task Library (ATL)** scheduler implementations. Tests are defined via CSV files, compiled, executed on QEMU, and verified automatically with pass/fail checks.

## 7.2 How to Run

```bash
# Run all tests
./run_all_tests.sh

# Run a specific test
./run_all_tests.sh B1

# Run multiple tests
./run_all_tests.sh B1 B2 A1
```

Results are saved in `test_results/` — each test produces three log files:
- `<ID>_compile.log` — compilation output
- `<ID>_qemu.log`   — QEMU serial output
- `<ID>_verify.log` — pass/fail check results

---

## 7.3 Test Structure

Each test consists of two CSV files in `user_interface/tests/`:

| File | Description |
|------|-------------|
| `<ID>_periodic.csv`  | Periodic (HRT) task configuration |
| `<ID>_aperiodic.csv` | Aperiodic (SRT) task configuration |

**Periodic CSV format:**
```
# Name, Period, Deadline, Priority, Stack, WCET, Policy, Phase
T1, 10, 10, 6, 256, 4, NONE, 0
```

**Aperiodic CSV format:**
```
# Name, Activation Time, Relative Deadline, WCET, Policy
AP1, 4, 20, 5, OVERRUN
```

When `run_all_tests.sh` runs a test, it copies the CSVs to `user_interface/`, triggers `make all` (which runs `gen_tasks.py` to generate C code), executes on QEMU, and verifies the output with `verify_test.py`.

---

## 7.4 Test Scenarios

### 7.4.1 Stress and Edge Case Tests (B)

| ID | Name | Description |
|----|------|-------------|
| B1 | Priority Preemption | T1 (high priority) preempts T2 at every period boundary. Tick-level timing verified. |
| B2 | Constrained Deadlines (D < T) | T2 is structurally unschedulable (WCET > D). Verifies mandatory deadline miss detection. |
| B3 | High Utilization ~95% | 3 tasks at 95% CPU load. All must meet deadlines with only 5% idle time. |
| B4 | Overlapping HRT Tasks | T1 (KILL) and T2 (SKIP) both overrun due to T3 preemption. Verifies both overrun policies are correctly applied on overlapping hard real-time tasks. |
| B5 | Zero Slack (wcet = D) | T1 WCET equals its deadline exactly. Validates scheduler precision at the timing boundary. |
| B6 | Equal Priority (Round-Robin) | 3 tasks with equal priority, round-robin enabled. Tasks interleave every tick, finish simultaneously. |

### 7.4.2 Overrun Policy Tests (P)

| ID | Name | Description |
|----|------|-------------|
| P1 | SKIP Policy | T1 overruns due to T2 preemption. `xLastWakeTime` advanced, missed slot skipped. |
| P2 | KILL Policy | T1 overruns due to T2 preemption. T1 immediately terminated and restarted. |
| P3 | CATCH_UP Policy | T1 overruns due to T2 preemption. T1 finishes naturally, immediately restarts — base period unchanged. |

### 7.4.3 Polling Server Tests (A)

| ID | Name | Description |
|----|------|-------------|
| A1 | Single-Period Execution | AP1 WCET fits within PS budget. Completes in one PS activation with no deadline miss. |
| A2 | Multi-Period Spanning | AP1 WCET exceeds PS budget. Suspended at budget exhaustion, resumed next PS period. |
| A4 | OVERRUN Policy with Queue | AP1 misses soft deadline while running inside PS (deadline expires during execution). OVERRUN policy logged — AP1 continues naturally. AP2 queued behind AP1, completes without deadline miss. |
| A5 | KILL Policy with Queue | AP1 misses soft deadline while running inside PS. KILL policy — AP1 immediately terminated. AP2 promoted from queue and completes successfully. |

---

## 7.5 Timing Precision

All tick-based checks pass with **TOLERANCE = 0** (exact tick matching). The scheduler produces deterministic, theoretically-exact timing under QEMU emulation with `-icount shift=6`.

---

## 7.6 Configuration Notes

- **Round-Robin:** `configUSE_TIME_SLICING = 1` in `FreeRTOSConfig.h` (enabled)
- **QEMU timeout:** 8 seconds per test
- **Log limit:** 150 lines per test
- **PS Budget:** auto-calculated by `gen_tasks.py` via RTA. If budget < 3ms, PS is disabled.
- **Workload calibration:** `WORKLOAD_1MS = 1250` cycles (QEMU Cortex-M3, icount shift=6)

---

## 7.7 Files

```
App/
├── run_all_tests.sh              # Main test runner
├── verify_test.py                # Pass/fail verifier
├── gen_tasks.py                  # CSV → C code generator (RTA dimensioning)
├── user_interface/
│   ├── tests/                    # Test CSV files (one pair per test)
│   │   ├── B1_periodic.csv
│   │   ├── B1_aperiodic.csv
│   │   └── ...
│   ├── user_periodic_tasks.csv   # Active periodic config (overwritten per test)
│   └── user_aperiodic_tasks.csv  # Active aperiodic config (overwritten per test)
└── test_results/                 # Auto-generated logs
```

## 8. Python Suite

The `gen_tasks.py` script acts as a bridge between the user input and the C code. Specifically, it prepares, validates, optimizes and computes the CPU load of the system before the C code is compiled. 

### 8.1 Periodic Task Parameter Management

The framework parses the `periodic_tasks.csv` file and automatically writes the static C arrays and header files (`generated_periodic_tasks.c/.h`). It distinguishes between *Fundamental* parameters (required for the script to run) and *Optional* parameters (which have safe defaults).

| Parameter | Type   | Fundamental? | Handling of Missing or inconsistent values |
------------|--------|:------------:|--------------------------------------------|
|NAME       |String  |Yes|          If missing, the script prints an error and exits.|
|PERIOD     |Integer |Yes|          Must be $> 0$. If missing or not an integer, the script prints an error and exits.|
|REL. DEADLINE   |Integer |No|           If missing or $\leq 0$, it is automatically set equal to the Period.|
|PRIORITY   |Integer |No|           If missing, it defaults to`MIN_PRIO`$=2$, that is the lowest one for user tasks. The maximum value is `MAX_PRIO`$=11$.
|STACK      |Integer |Yes|          Must be an integer. If missing, the script exits. If $<$ `MIN_STACK`, it is forced to `MIN_STACK`.
|WCET       |Integer |Yes|          Must be $> 0$. If missing, invalid, or $\leq 0$, the script exits to prevent underflow bugs in C.
|POLICY     |String  |No|           Must be `SKIP`, `KILL`, or `CATCH_UP`. Invalid strings default to `SKIP`.
|PHASE      |Integer |No|           If missing or $< 0$, it defaults to 0.


### 8.2 Aperiodic Task Parameter Management
The framework parses the `aperiodic_tasks.csv` file and automatically writes the static C arrays and header files (`generated_aperiodic_tasks.c/.h`)

| Parameter | Type   | Fundamental? | Handling of Missing or inconsistent values |
------------|--------|:------------:|--------------------------------------------|
|NAME       |String  |Yes|          If missing, the script prints an error and exits.|
|ACTIVATION TIME     |Integer |Yes|          Must be $\ge 0$. If missing or not an integer, the script prints an error and exits.|
|REL. DEADLINE   |Integer |Yes|           Must be $> 0$. If missing, the script exits.|
|WCET       |Integer |Yes|          Must be $> 0$. If missing, invalid, or $\leq 0$, the script exits to prevent underflow bugs in C.
|POLICY     |String  |No|           Must be `OVERRUN` or `KILL`. Invalid strings default to `OVERRUN`.|


### 8.3 Response Time Analysis (RTA) and Polling Server Dimensioning
The framework includes a mathematical engine to verify if the system can meet all its deadlines by calculating the **Worst-Case Response Time** ($R$) for every task.

In a strictly hierarchical system (where every task has a unique priority), a task's response time is calculated by adding its own execution time to the delays caused by higher-priority tasks stealing the CPU (Interference):
$$R_i = C_i + \sum_{j \in HP(i)} \left\lceil \frac{R_i}{T_j} \right\rceil \times C_j$$

* $C_i$: The WCET of the task being analyzed;
* $HP(i)$: The set of tasks with a priority strictly higher than task $i$ (including the PS);
* $T_j$: The Period of the interfering task $j$;
* $C_j$: The WCET of the interfering task $j$;
* $\lceil R_i/T_j \rceil$: The "ceiling" function, representing the maximum number of times task $j$ can preempt task $i$.

To give developers maximum flexibility, our framework allows multiple tasks to share the same priority level. In this case, as the project requirements dictate, Round-Robin is used and, therefore, we need to extend the previous formula to encompass such a scenario. 

The response time $R_i$ for a task $\tau_i$ under Round-Robin with a time quantum $q$ has to take into account that everytime $\tau_i$ executes for $q$, it has to wait for the other tasks with the same priority executing their quanta:

$$R_i = C_i + \sum_{j \in HP(i)} \left\lceil \frac{R_i}{T_j} \right\rceil C_j + \sum_{k \in SP(i)} \text{Interf}_{RR}(k, C_i, R_i, q)$$

where $SP(i)$ is the set of tasks that share the same priority with $\tau_i$. 
The interference $\text{Interf}_{RR}(k, C_i, R_i, q)$ of a task $\tau_k \in SP(i)$ is the amount of time that $\tau_k$ steals to $\tau_i$:

$$\text{Interf}_{RR}(k, C_i, R_i, q) = \min \left( \left\lceil \frac{R_i}{T_k} \right\rceil C_k, \left\lceil \frac{C_i}{q} \right\rceil q \right)$$

where:
* the term $\left\lceil \frac{C_i}{q} \right\rceil$ calculates how many time slices $\tau_i$ (the task under analysis) needs to complete its Worst-Case Execution Time ($C_i$). The ceiling operator is necessary because if $C_i$ is not an exact multiple of the quantum $q$, the final execution will only take up a fraction of a quantum, but it still counts as a unique time slice. By multiplying this number by the quantum duration $q$, we get the theoretical limit of the stolen time: $\left\lceil \frac{C_i}{q} \right\rceil q$, which represents the worst case, namely when $\tau_k$ is scheduled before $\tau_i$.

* The term $\lceil \frac{R_i}{T_k}\rceil$ represents the maximum number of jobs for task $\tau_k$​ that can occur during the response time of $\tau_i$​, specifically when $R_i​>T_k$​. By multiplying this number by $C_k$​, we get the total execution time required by $\tau_k$​ within that time window.

As FreeRTOS forces the time quantum $q= 1$ tick, the previous formula for interference becomes:

$$\text{Interf}_{RR}(k, C_i, R_i) = \min \left( \left\lceil \frac{R_i}{T_k} \right\rceil C_k, \space C_i \right)$$

Therefore, there are two scenarios:

* If the total workload generated by $\tau_k$ is sufficiently large, $\tau_k$ will continue to alternate with $\tau_i$ the entire time. The interference is simply $C_i$.

* If the total workload generated by $\tau_k$ is small, in the worst-case every job released by $\tau_k$ within the time window $R_i$ will fully complete its execution before $\tau_i$ finishes its own quanta. Consequently, $\tau_k$ never consumes its maximum potential number of time slices, and the total interference suffered by $\tau_i$ is exactly the cumulative execution time of those completed jobs, namely $\left\lceil \frac{R_i}{T_k} \right\rceil C_k$.

When calculating the maximum budget for the Polling Server, the script incrementally increases the Server's capacity until the RTA formula fails.

If shared priorities are used, the pessimistic RTA will hit the deadline limit much sooner because it is accounting for the interference due to the other same-priority tasks. As a result, the final Polling Server budget will be smaller (and safer) than it might be in a purely hierarchical system. More precisely, while in the latter case we obtain the **maximum capacity** that allows schedulability, in the former one we have only a **pessimistic estimate**.

For the other parameters:
* **Period**: Automatically set to the minimum period found in the periodic task set to maximize reactivity;
* **Priority**: `MAX_PRIO` + 1, right in the middle of the priority range for periodic tasks and that of management tasks;
* **Efficiency Threshold**: If the final calculated budget is below `MIN_PS_BUDGET` (3 ticks), the framework automatically sets the budget to 0 and disables the Server to avoid excessive context-switching overhead.


## 9. Usage

### 9.1 Configure Tasks

Edit the task configuration files:

    App/user_interface/user_periodic_tasks.csv
    App/user_interface/user_aperiodic_tasks.csv  

**Periodic task format:**

    # Name, Period, Deadline, Priority, Stack, WCET, Policy, Phase
    T1, 10, 10, 6, 256, 4, NONE, 0

**Aperiodic task format:**

    # Name, Activation Time, Relative Deadline, WCET, Policy
    AP1, 5, 30, 8, OVERRUN

Leave `user_aperiodic_tasks.csv` with only the header line to disable the Polling Server.

---

### 9.2 Compile

    cd App
    make clean && make all

This runs `gen_tasks.py` to generate C code from the CSVs, then compiles the project.

---

### 9.2 Run on QEMU

    make qemu_start

---

## References
* **[1] R. Racu, L. Li, R. Henia, A. Hamann, and R. Ernst**, "Improved response time analysis of tasks scheduled under preemptive Round-Robin," in *Proceedings of the 5th IEEE/ACM/IFIP international conference on Hardware/software codesign and system synthesis (CODES+ISSS '07)*, Salzburg, Austria, 2007, pp. 179–184.
* **[2] G. C. Buttazzo**, *Hard Real-Time Computing Systems: Predictable Scheduling Algorithms and Applications*, 3rd ed. New York, NY: Springer, 2011.

* **[3] FreeRTOS Official Website**: [https://www.freertos.org/](https://www.freertos.org/).
