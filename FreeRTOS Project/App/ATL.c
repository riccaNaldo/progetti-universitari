/*
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
 */

#include <stdint.h>
#include "FreeRTOS.h"
#include "task.h"
#include "queue.h"
#include "ATL.h"
#include "logger.h"
#include "generated_periodic_tasks.h"           /* vDummyTask e WORKLOAD_1MS */
#include "generated_aperiodic_tasks.h" /* PS_BUDGET_TICKS */

#define ITEM_SIZE sizeof(AperiodicRequest_t)

QueueHandle_t xAperiodicPool = NULL;
static StaticQueue_t xStaticQueue;
static uint8_t ucQueueStorageArea[ GEN_NUM_APERIODIC_TASKS * ITEM_SIZE ];

void vInitAperiodicRequests(void)
{
    if(xAperiodicPool == NULL) {
        xAperiodicPool = xQueueCreateStatic(GEN_NUM_APERIODIC_TASKS, ITEM_SIZE,
                                            ucQueueStorageArea, &xStaticQueue);
    }
}

BaseType_t xAPI_SubmitAperiodic( AperiodicRequest_t *pxNewRequest )
{
    if( xAperiodicPool == NULL || pxNewRequest == NULL ) return pdFAIL;
    return xQueueSendToBack( xAperiodicPool, pxNewRequest, 0 );
}

void prvPSNotifier(void* pvParameters)
{
    (void)pvParameters; 
    static uint8_t ucRequestSent[GEN_NUM_APERIODIC_TASKS] = {0};

    for(;;)
    {
        TickType_t xCurrentTime = xTaskGetTickCount();
        TickType_t xMinDelay = portMAX_DELAY;
        uint8_t ucAllSent = 1; 

        for(int i = 0; i < GEN_NUM_APERIODIC_TASKS; i++)
        {
            if(ucRequestSent[i] == 0)
            {
                ucAllSent = 0; 
                TickType_t xActivation = g_xAperiodicRequests[i].xActivationTime;

                if(xCurrentTime >= xActivation)
                {
                    AperiodicRequest_t reqCopy = g_xAperiodicRequests[i];
                    if( xAPI_SubmitAperiodic(&reqCopy) == pdPASS )
                    {
                        ucRequestSent[i] = 1; 
                    }
                }
                else
                {
                    TickType_t diff = xActivation - xCurrentTime;
                    if(diff < xMinDelay) xMinDelay = diff;
                }
            }
        }
        
        if(ucAllSent == 1) vTaskSuspend(NULL); 
        else
        {
            if(xMinDelay != portMAX_DELAY && xMinDelay > 0) 
                vTaskDelay(xMinDelay); 
        }
    }
}


void vPollingServerTask(void *pvParameters)
{
    (void)pvParameters; 
    
    static AperiodicRequest_t xCurrentRequest;
    static uint8_t ucHasActiveRequest = 0;
    
    /* Static flag to remember if we have already logged the violation for this specific task */
    static uint8_t ucAlreadyLoggedMiss = 0; 
    
    TickType_t xRemainingBudget = PS_BUDGET_TICKS; 

    /* Prior check */
    if( ucHasActiveRequest == 0 && uxQueueMessagesWaiting( xAperiodicPool ) == 0 ) 
    {
        return;
    }

    while( xRemainingBudget > 0 )
    {
        /* If there is not an active request let's check into the queue for new aperiodic requests */
        if( ucHasActiveRequest == 0 )
        {
            if( xQueueReceive( xAperiodicPool, &xCurrentRequest, 0 ) == pdPASS )
            {
                ucHasActiveRequest = 1;
                ucAlreadyLoggedMiss = 0; // Reset flag for the new task
                vRecordTraceEvent( xTaskGetTickCount(), eTraceTaskStart, xCurrentRequest.pcName, xCurrentRequest.ulId, 0 );
            }
            else
            {
                break;
            }
        }
        
        TickType_t xCurrentTick = xTaskGetTickCount();
        TickType_t xAbsoluteDeadline = xCurrentRequest.xActivationTime + xCurrentRequest.xRelativeDeadline;

        /* --- POLICY CHECK AND LOGGING (BOTH PREVENTIVELY AND DURING EXECUTION) ---
                It triggers if the timer has expired, the task still has to run, and we haven't yet logged the error. */
        if (xCurrentTick >= xAbsoluteDeadline && xCurrentRequest.xWcetLeft > 0 && ucAlreadyLoggedMiss == 0)
        {
            vRecordTraceEvent(xCurrentTick, eTraceDeadlineMiss, xCurrentRequest.pcName, xCurrentRequest.ulId, 1);
            
            if (xCurrentRequest.ePolicy == KILL)
            {
                vRecordTraceEvent(xCurrentTick, eTraceOverrunKill, xCurrentRequest.pcName, xCurrentRequest.ulId, 1);
                vRecordTraceEvent(xCurrentTick, eTraceTaskEnd, xCurrentRequest.pcName, xCurrentRequest.ulId, 1);
                
                xCurrentRequest.xWcetLeft = 0; // Remaining time for the killed task is deleted
                ucHasActiveRequest = 0; 
                continue; // Starts from the while to extract the next aperiodic request in the queue
            }
            else if (xCurrentRequest.ePolicy == OVERRUN)
            {
                vRecordTraceEvent(xCurrentTick, eTraceOverrun, xCurrentRequest.pcName, xCurrentRequest.ulId, 1);
                ucAlreadyLoggedMiss = 1; 
            }
        }

        /* --- CHUNK CALCULATION AND CUTTING --- */
        TickType_t xChunkToExecute;
        if( xCurrentRequest.xWcetLeft <= xRemainingBudget )
        {
            xChunkToExecute = xCurrentRequest.xWcetLeft;
        }
        else
        {
            xChunkToExecute = xRemainingBudget;
        }
                                

        /* If the deadline occurs DURING this loop, we stop execution
            exactly when it expires, so that the exact log will be generated on the next while loop. */
        if (xCurrentTick < xAbsoluteDeadline)
        {
            TickType_t xTicksToDeadline = xAbsoluteDeadline - xCurrentTick;
            if (xChunkToExecute > xTicksToDeadline)
            {
                xChunkToExecute = xTicksToDeadline;
            }
        }

       /* --- EXECUTION --- */
       
       // [Total Cycles] = [Tick] * [ms / Tick] * [Cycles / ms] 
        uint32_t ulWorkloadLoops = xChunkToExecute * WORKLOAD_1MS * portTICK_PERIOD_MS;
        
        /* If the aperiodic lasts less than 1 tick --> it executes for 1 tick */
        if(ulWorkloadLoops == 0) ulWorkloadLoops = 1;

        TickType_t xStartTick = xTaskGetTickCount(); 
        
        vDummyTask(&ulWorkloadLoops); 
        
        TickType_t xEndTickExecution = xTaskGetTickCount(); 
        
        /* --- REAL-TIME STATE UPDATING --- */
        TickType_t xActualCost = xEndTickExecution - xStartTick; 
        
        /* FreeRTOS measures time in discrete ticks. If the physical CPU
          executes the dummy task extremely fast (e.g., 0.5 ms), and this execution happens 
          entirely between two consecutive tick boundaries, 'xEndTickExecution - xStartTick' 
          will evaluate to 0. 
          If xActualCost is 0, the server budget never decreases, causing an infinite 
          loop that stalls the system. We force 'xActualCost' to be at least the nominal 
          'xChunkToExecute' to ensure the budget accounting always moves forward. */
        if (xActualCost < xChunkToExecute) {
            xActualCost = xChunkToExecute;
        } 
        
        /* In an ideal theoretical model, the server stops exactly when the budget reaches zero 
          (ActualCost == RemainingBudget). However, in a simulated environment, 
           OS jitter and overhead can cause the physical execution time to 
          slightly exceed the theoretical allocated chunk. We use '>=' to catch these physical overruns. */
        if(xActualCost >= xRemainingBudget)
        {
            xRemainingBudget = 0;
        }
        else
        { 
            xRemainingBudget -= xActualCost;
        }

        /* Look at the previous comment */
        if(xActualCost >= xCurrentRequest.xWcetLeft)
        {
            xCurrentRequest.xWcetLeft = 0;
        }
        else
        {
            xCurrentRequest.xWcetLeft -= xActualCost;
        }

        /* --- NATURAL-END CHECK --- */
        if(xCurrentRequest.xWcetLeft == 0)
        {
            TickType_t xEndTick = xTaskGetTickCount();
            vRecordTraceEvent(xEndTick, eTraceTaskEnd, xCurrentRequest.pcName, xCurrentRequest.ulId, ucAlreadyLoggedMiss);
            ucHasActiveRequest = 0; 
        }
    }
}
