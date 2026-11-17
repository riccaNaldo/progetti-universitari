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
#include <stdio.h>
#include "FreeRTOS.h"
#include "task.h"
#include "PTL.h"
#include "task_control_block.h"
#include "uart.h"
#include "logger.h"
#include "queue.h"
#include "generated_periodic_tasks.h"
#include "generated_aperiodic_tasks.h"
#include "ATL.h"

/*** PRIORITIES ***/
#define OVERRUN_TASK_MANAGER_PRIORITY ( configMAX_PRIORITIES - 1 )
#define PS_NOTIFIER_PRIORITY ( configMAX_PRIORITIES - 2 )
#define TRACE_PRINTER_TASK_PRIORITY ( tskIDLE_PRIORITY + 1 )



//Number of tasks = periodic tasks + polling server
#define TOTAL_SYSTEM_TASKS ( GEN_NUM_TASKS + 1 )
#define QUEUE_LENGTH    TOTAL_SYSTEM_TASKS
#define ITEM_SIZE       sizeof(uint8_t)


static StackType_t xNotifierStack[ 256 ];  
static StaticTask_t xNotifierTCB;
static TaskHandle_t xNotifierHandle = NULL;


/*** GLOBAL VARIABLES ***/
TaskControlBlock_t pxSystemTasks[ TOTAL_SYSTEM_TASKS ];

static StaticTask_t xManagerTCB;
static StackType_t xManagerStack[ 256 ];
                   

static StackType_t xTraceStack[ 512 ];
static StaticTask_t xTraceTCB;

static StackType_t xServerStack[512];
static StaticTask_t xServerStaticTCB;

/*** FUNCTIONS FIRMS ***/
void vStartSystem( void );	                /* User interface */

static void prvPeriodicTaskWrapper( void* pvParameters );
static void prvOverrunPolicyEnforcer( void * pvParameters );                /* FreeRTOS Task */


/* Queue for enforcment e deferrable */
static StaticQueue_t xStaticQueue;
static uint8_t ucQueueStorageArea[ QUEUE_LENGTH * ITEM_SIZE ];
QueueHandle_t xTaskQueue;


/*********************************************************************************************/
/*                                    THE CODE                                               */
/*********************************************************************************************/


void vStartSystem( void )
{
    
    vTraceInit();
    
    /* Testing error handling */
    //configASSERT( 1 == 0 );
    
    xTaskQueue = xQueueCreateStatic( QUEUE_LENGTH, ITEM_SIZE, ucQueueStorageArea, &xStaticQueue );
    
    xTaskCreateStatic(
        prvOverrunPolicyEnforcer,    
        "OverrunManager",         
        256,                      
        NULL,                     
        OVERRUN_TASK_MANAGER_PRIORITY,     
        xManagerStack,            
        &xManagerTCB              
    );


    xTaskCreateStatic( vTracePrinterTask, "TraceTask", 512, NULL, TRACE_PRINTER_TASK_PRIORITY, xTraceStack, &xTraceTCB );


    /* Populating pxSystemTasks with PERIODIC TASKS*/
    for( uint8_t ucI = 0; ucI < GEN_NUM_TASKS; ucI++ )
    {
            
        TaskControlBlock_t * pxIntTask = &pxSystemTasks[ ucI ];
        const TaskConfig_t * pxCfg = &g_xGeneratedTasks[ ucI ];
        
        pxIntTask->xUserTask = pxCfg;
        pxIntTask->pxStackBuffer = pxCfg->pxStackBuffer;
        pxIntTask->pxTCB = pxCfg->pxTCBBuffer;

        pxIntTask->pxTaskHandle = xTaskCreateStatic( 
            prvPeriodicTaskWrapper, 
            pxIntTask->xUserTask->pcName, 
            pxIntTask->xUserTask->uxStackDepth, 
            ( void * ) pxIntTask, 
            pxIntTask->xUserTask->uxPriority, 
            pxIntTask->pxStackBuffer,
            pxIntTask->pxTCB
        );  
            
        pxIntTask->ucIsOverrunning = 0; 
        pxIntTask->ucIsRunning = 0;     
        pxIntTask->uiJobMiss = 0;       
        pxIntTask->xReleaseTick = 0;    
        pxIntTask->xOverrunTick = 0;
        pxIntTask->xCurrentPhase = pxIntTask->xUserTask->xPhase;
    }
    
    /* --- POLLING SERVER CREATION --- */
    
    // The PS occupies the last slot in pxSystemTasks
    // It is instantiated only if PS_BUDGET_TICKS > 0
    
    if( PS_BUDGET_TICKS > 0 )
    {
        TaskControlBlock_t * pxServerTask = &pxSystemTasks[ GEN_NUM_TASKS ];

        static TaskConfig_t xServerConfig = {
            .pcName = "PS",
            .pvTaskCode = vPollingServerTask, 
            .pvParameters = NULL,             
            .uxStackDepth = 512,
            .uxPriority = PS_PRIORITY,        
            .xPeriod = PS_PERIOD_TICKS,       
            .xDeadline = PS_PERIOD_TICKS,     
            .xPhase = 0,
            .ePolicy = NONE,                  
            .xIsPeriodic = pdTRUE, 
            .pxStackBuffer = xServerStack,
            .pxTCBBuffer = &xServerStaticTCB
        };

        pxServerTask->xUserTask = &xServerConfig;
        pxServerTask->pxStackBuffer = xServerConfig.pxStackBuffer;
        pxServerTask->pxTCB = xServerConfig.pxTCBBuffer;
        
        pxServerTask->ucIsOverrunning = 0;
        pxServerTask->ucIsRunning = 0;
        pxServerTask->uiJobMiss = 0;
        pxServerTask->xReleaseTick = 0;
        pxServerTask->xOverrunTick = 0;
        pxServerTask->xCurrentPhase = pxServerTask->xUserTask->xPhase;

        pxServerTask->pxTaskHandle = xTaskCreateStatic( 
            prvPeriodicTaskWrapper, 
            pxServerTask->xUserTask->pcName, 
            pxServerTask->xUserTask->uxStackDepth, 
            ( void * ) pxServerTask, 
            pxServerTask->xUserTask->uxPriority, 
            pxServerTask->pxStackBuffer,
            pxServerTask->pxTCB
        );
        
        xNotifierHandle = xTaskCreateStatic(
            prvPSNotifier,               
            "PS_Notifier",               
            256,                         
            NULL,                        
            PS_NOTIFIER_PRIORITY,    
            xNotifierStack,              
            &xNotifierTCB               
        );
    
        vInitAperiodicRequests();
    }
    else
    {
        vUART_PutString("---BUDGET cannot be 0: PS not instantiated---\n");
    }
    
    
    vTaskStartScheduler();
}


   
    


/* FreeRTOS Task: prvPeriodicTaskWrapper
 * One prvPeriodicTaskWrapper for each task
 */
void prvPeriodicTaskWrapper(void* pvParameters)
{
    TaskControlBlock_t *pxTCB = (TaskControlBlock_t *) pvParameters;

    TaskFunction_t pUserTaskFunctionBody = pxTCB->xUserTask->pvTaskCode;
    void* pvUserParameters = pxTCB->xUserTask->pvParameters;

    /* Waiting for initial phase */
    if( pxTCB->xCurrentPhase > 0 )
    {
        vTaskDelayUntil( &pxTCB->xReleaseTick, pdMS_TO_TICKS(pxTCB->xCurrentPhase) );
        pxTCB->xCurrentPhase = 0;
    }

    for(;;)
    {
        pxTCB->xOverrunTick  = pxTCB->xReleaseTick + pxTCB->xUserTask->xPeriod; 
		pxTCB->xDeadlineTick = pxTCB->xReleaseTick + pxTCB->xUserTask->xDeadline;
        pxTCB->ucIsRunning = 1;
	    pxTCB->ucIsOverrunning = 0;

	    /* Recording Starting time */
	    vRecordTraceEvent( xTaskGetTickCount(), eTraceTaskStart, pxTCB->xUserTask->pcName, pxTCB->uiJobMiss, 0);

        /* -- Start User body task execution --*/
        pUserTaskFunctionBody(pvUserParameters);

        pxTCB->ucIsRunning = 0;

	    /* Recording Ending time */
        TickType_t xEndTick = xTaskGetTickCount();
	    vRecordTraceEvent( xEndTick, eTraceTaskEnd, pxTCB->xUserTask->pcName, pxTCB->uiJobMiss, ( xEndTick > pxTCB->xDeadlineTick ));

        vTaskDelayUntil(&pxTCB->xReleaseTick, pdMS_TO_TICKS(pxTCB->xUserTask->xPeriod));
    }
}

void vOverrunMonitorTickHook ( TickType_t ulCurrentTick )
{
    BaseType_t xHigherPriorityTaskWoken = pdFALSE;

	ulCurrentTick++;

	/* Periodic Overrun Checks */
    TaskControlBlock_t * pxTCB;

    for( uint8_t ucIndex=0; ucIndex < GEN_NUM_TASKS; ucIndex++ )
    {
        pxTCB = &pxSystemTasks[ ucIndex ];
        if( pxTCB->ucIsRunning == 0 ) 		continue;
	    if( pxTCB->ucIsOverrunning == 1 )	continue;
        if( pxTCB->pxTaskHandle == NULL ) 	continue;	//safety check
        
        if( ulCurrentTick >= pxTCB->xOverrunTick )
        {
            xQueueSendFromISR( xTaskQueue, &ucIndex, &xHigherPriorityTaskWoken );
        }
    }

    portYIELD_FROM_ISR( xHigherPriorityTaskWoken );
}


void prvOverrunPolicyEnforcer( void * pvParameters )
{
    (void) pvParameters;
    uint8_t ucTaskID;
    TaskControlBlock_t * pxTCB;

    for(;;)
    {
		if( xQueueReceive( xTaskQueue, &ucTaskID, portMAX_DELAY ) == pdPASS )
		{
			pxTCB = &pxSystemTasks[ ucTaskID ];
			eTraceEventType_t eEvent = eTraceTaskStart;

			TickType_t xCurrentTick = xTaskGetTickCount();

            switch( pxTCB->xUserTask->ePolicy )
            {
                case KILL:
					eEvent = eTraceOverrunKill;
                    vTaskDelete( pxTCB->pxTaskHandle );
					pxTCB->pxTaskHandle = NULL; //safety
                    pxTCB->ucIsRunning = 0;
					pxTCB->xReleaseTick  = pxTCB->xOverrunTick;
					
                    pxTCB->pxTaskHandle = xTaskCreateStatic(
                        prvPeriodicTaskWrapper,
                        pxTCB->xUserTask->pcName,
                        pxTCB->xUserTask->uxStackDepth,
                        ( void * ) pxTCB,
                        pxTCB->xUserTask->uxPriority,
                        pxTCB->pxStackBuffer,
                        pxTCB->pxTCB
                    );
                    break;
                
                case CATCH_UP:
		    		eEvent = eTraceOverrunCatchUp;
					pxTCB->ucIsOverrunning = 1;
                    break;
                
                case SKIP:
                    eEvent = eTraceOverrunSkip;
                    pxTCB->uiJobMiss++;
                    pxTCB->xReleaseTick = pxTCB->xOverrunTick;
                    pxTCB->xOverrunTick = pxTCB->xReleaseTick + pxTCB->xUserTask->xPeriod;
                    break;
                
                case NONE:
		    		break;
	    	}

			vRecordTraceEvent( 	xCurrentTick,
								eEvent,
								pxTCB->xUserTask->pcName,
								pxTCB->uiJobMiss,
								(xCurrentTick >= pxTCB->xDeadlineTick)
			);
		}
	}
}

