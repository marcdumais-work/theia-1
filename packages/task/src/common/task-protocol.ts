/*
 * Copyright (C) 2017 Ericsson and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { JsonRpcServer } from '@theia/core/lib/common/messaging/proxy-factory';
// todo: move error marker interface in common and use that instead
import { Marker } from '@theia/markers/lib/browser/';

export const taskPath = '/services/task';
export const ITaskServer = Symbol('ITaskServer');
export const ITaskClient = Symbol('ITaskClient');

export type ProcessType = 'terminal' | 'raw';

export interface ITaskInfo {
    /** internal unique task id */
    taskId: number,
    /** terminal id. Defined if task is run as a terminal process */
    terminalId?: number,
    /** internal unique process id */
    processId?: number,
    /** OS PID of the process running the task */
    osProcessId: number
}


export interface ITaskOptions {
    label: string,
    processType: ProcessType,
    command: string,
    args: string[],
    cwd: string,
    /** is this a build task? */
    isBuild: boolean,
    errorMatcherName: string,
    errorMatcherOptions?: object
}

export interface ITaskServer extends JsonRpcServer<ITaskClient> {
    /** Get a list of avaialble task labels, for tasks configured in tasks.json */
    getTasks(): Promise<string[]>
    /** Run a task - either pass details of task or its label */
    run(task: ITaskOptions | string): Promise<ITaskInfo>;
    /** Kill a task */
    kill(id: number): Promise<void>;
}

export interface ITaskExitedEvent {
    taskId: number;
    code: number;
    signal?: string;
}

export interface ITaskOutputEntryFoundEvent {
    taskId: number,
    entry: Marker<object>
}

export interface ITaskClient {
    onTaskExit(event: ITaskExitedEvent): void;
    onTaskOutputEntryFound(event: ITaskOutputEntryFoundEvent): void;
}
