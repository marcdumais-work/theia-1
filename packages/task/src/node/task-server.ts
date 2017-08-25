/*
 * Copyright (C) 2017 Ericsson and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { inject, injectable } from 'inversify';
import { ILogger, Disposable, DisposableCollection, MaybePromise } from '@theia/core/lib/common/';
import { ITaskServer, ITaskClient, ITaskOptions, ITaskInfo } from '../common/task-protocol';
import { Task } from './task';
import { RawProcess, RawProcessFactory, RawProcessOptions } from '@theia/process/lib/node/raw-process';
import { TerminalProcess, TerminalProcessFactory, TerminalProcessOptions } from '@theia/process/lib/node/terminal-process';
import { TaskManager } from './task-manager';
import * as fs from 'fs';
import * as path from 'path';
import URI from "@theia/core/lib/common/uri";
import * as jsoncparser from "jsonc-parser";
import { ParseError } from "jsonc-parser";
import { FileSystemWatcherServer, DidFilesChangedParams/*, FileChange*/ } from '@theia/filesystem/lib/common/filesystem-watcher-protocol';
import { FileSystem } from '@theia/filesystem/lib/common';
import { WorkspaceServer } from '@theia/workspace/lib/common';

export const TaskFileUri = Symbol("TaskFileURI");
export type TaskFileUri = MaybePromise<URI>;

@injectable()
export class TaskServer implements ITaskServer {

    /* Task client to send notifications to.  */
    protected client: ITaskClient | undefined = undefined;
    protected taskToDispose = new Map<number, DisposableCollection>();
    protected readonly toDispose = new DisposableCollection();

    // where we save tasks read from tasks.json, using label as key
    protected taskMap = new Map<string, ITaskOptions>();
    protected workspaceRoot: string;
    protected readonly taskFileUri: Promise<string>;

    constructor(
        @inject(ILogger) protected readonly logger: ILogger,
        @inject(RawProcessFactory) protected readonly rawProcessFactory: RawProcessFactory,
        @inject(TerminalProcessFactory) protected readonly terminalProcessFactory: TerminalProcessFactory,
        @inject(TaskManager) protected readonly taskManager: TaskManager,
        @inject(FileSystemWatcherServer) protected readonly watcherServer: FileSystemWatcherServer,
        @inject(WorkspaceServer) protected readonly workspaceServer: WorkspaceServer,
        @inject(FileSystem) protected readonly fileSystem: FileSystem,
        @inject(TaskFileUri) protected readonly taskFileUriPromise: TaskFileUri
    ) {
        this.taskFileUri = Promise.resolve(taskFileUriPromise).then(uri => {
            logger.info(`task server: attempting to us  using task file: ${uri.toString()}`);
            return uri.toString();
        });

        // watch task file for changes
        this.toDispose.push(watcherServer);
        watcherServer.setClient({
            onDidFilesChanged: p => this.onDidTaskFileChange(p)
        });

        this.taskFileUri.then(uri =>
            watcherServer.watchFileChanges(uri).then(id => {
                this.toDispose.push(Disposable.create(() =>
                    watcherServer.unwatchFileChanges(id))
                );
            })
        );

        taskManager.onDelete(id => {
            const toDispose = this.taskToDispose.get(id);
            if (toDispose !== undefined) {
                toDispose.dispose();
                this.taskToDispose.delete(id);
            }
        });
        this.workspaceServer.getRoot().then(root => {
            this.workspaceRoot = root;
        });

        this.readTasks();
    }

    protected onDidTaskFileChange(params: DidFilesChangedParams): void {
        this.taskFileUri.then(uri => {
            // task file changed? re-read it
            if (params.changes.some(c => c.uri === uri)) {
                this.taskMap.clear();
                this.readTasks();
            }
        });
    }

    getTasks(): Promise<string[]> {
        return Promise.resolve([...this.taskMap.keys()]);
    }

    run(task: ITaskOptions | string): Promise<ITaskInfo> {
        if (typeof task === 'string') {
            if (this.taskMap.has(task)) {
                return this.doRun(<ITaskOptions>this.taskMap.get(task));
            } else {
                throw (`Task with label ${task} not found`);
            }
        } else {
            return this.doRun(task);
        }
    }

    protected doRun(options: ITaskOptions): Promise<ITaskInfo> {
        let task: Task;
        let proc: TerminalProcess | RawProcess;
        const command: string = options.command;

        try {
            // check that command exists before creating process from it
            const resolved_command = this.findCommand(command);

            if (resolved_command === undefined) {
                throw (`Command not found: ${command}`);
            }

            // create process launch config
            const processOptions = {
                command: resolved_command,
                args: options.args,
                options: {
                    env: process.env,
                    cwd: options.cwd
                }
            };

            if (options.processType === 'terminal') {
                this.logger.info('Task: creating underlying terminal process');
                proc = this.terminalProcessFactory(<TerminalProcessOptions>processOptions);
            } else {
                this.logger.info('Task: creating underlying raw process');
                proc = this.rawProcessFactory(<RawProcessOptions>processOptions);
            }

            task = new Task(
                this.taskManager,
                proc,
                options.errorMatcherName
            );

            // when underlying process exits, notify tasks listeners
            const toDispose = new DisposableCollection();

            // WIP - commented-out for now because breaks the 'kill task' unit tests
            // toDispose.push(
            proc.onExit(event => {
                if (this.client !== undefined) {
                    this.client.onTaskExit(
                        {
                            'taskId': task.id,
                            'code': event.code,
                            'signal': event.signal
                        });
                }
                // task.kill();
            })
                // )
                ;

            this.taskToDispose.set(task.id, toDispose);

            // need to listen for process errors? does this actually happen? I have not seen it yet

            return Promise.resolve(
                {
                    taskId: task.id,
                    osProcessId: proc.pid,
                    terminalId: (options.processType === 'terminal') ? proc.id : undefined,
                    processId: proc.id
                }
            );

        } catch (error) {
            this.logger.error(`Error occured while creating task: ${error}`);
            return Promise.reject(new Error(error));
        }
    }

    kill(id: number): Promise<void> {
        const taskToKill = this.taskManager.get(id);
        if (taskToKill !== undefined) {
            taskToKill.kill();
        }
        return Promise.resolve();
    }

    dispose() {
        //
    }

    /* Set the client to receive notifications on. */
    setClient(client: ITaskClient | undefined) {
        this.client = client;
    }

    protected readTasks(): void {
        this.taskFileUri.then(uri =>
            this.fileSystem.exists(uri).then(exists => {
                if (!exists) {
                    return;
                }
                this.fileSystem.resolveContent(uri).then(({ stat, content }) => {
                    const strippedContent = jsoncparser.stripComments(content);
                    const errors: ParseError[] = [];
                    const tasks = jsoncparser.parse(strippedContent, errors);
                    this.parseTasks(tasks['tasks']);

                    if (errors.length) {
                        for (const error of errors) {
                            this.logger.error("JSON parsing error", error);
                        }
                    }

                    return;
                });
            }).catch(reason => {
                if (reason) {
                    this.logger.error(`Failed to read tasks ${uri}:`, reason);
                }
                return;
            })
        );
    }

    private parseTasks(tasks: ITaskOptions[]): void {
        for (const task of tasks) {
            if (!this.taskMap.has(task.label)) {
                this.taskMap.set(task.label, task);
            } else {
                this.taskFileUri.then(uri => {
                    this.logger.error(`Error parsing ${uri}: found duplicate entry for label ${task.label}`);
                    // TODO: create error marker for task.json?
                    // or maybe not. We might be able to use a JSON schema to validate the
                    // JSON file in the Monaco editor. I think it probably could cover that
                    // case
                });
            }
        }
    }

    // Check if task command can be found, if so return its resolved
    // absolute path, else returns undefined
    private findCommand(command: string): string | undefined {
        // TODO: make this platform-independent
        const systemPath = process.env.PATH;

        // command has absolute path? easy - check if command exists there
        // command has relative path? check relative to workspace
        // command has no path? maybe it's in the system path?

        if (path.isAbsolute(command) && fs.existsSync(command)) {
            return command;
        } else {
            // no path at all?
            // search for command in workspace root first
            this.fileSystem.exists(`${this.workspaceRoot}/${command}`).then(exists => {
                if (exists) {
                    return `${this.workspaceRoot}/${command}`;
                }
            });


            // ) {
            //         return `${this.workspaceRoot}/${command}`;
            //     }
            // if (fs.existsSync(`${this.workspaceRoot}/${command}`)) {
            //     return `${this.workspaceRoot}/${command}`;
            // }

            if (path.basename(command) === command) {
                // search for this command in the path
                if (systemPath !== undefined) {
                    const pathArray: string[] = systemPath.split(/:/);
                    for (const p of pathArray) {
                        if (fs.existsSync(`${p}/${command}`)) {
                            return `${p}/${command}`;
                        }
                    }
                }
            }
        }

        return undefined;
    }
}

