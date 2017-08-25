/*
 * Copyright (C) 2017 Ericsson and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import * as chai from 'chai';
import 'mocha';
import * as chaiAsPromised from 'chai-as-promised';
import { testContainer } from './test-resources/inversify.spec-config';
import { BackendApplication } from '@theia/core/lib/node/backend-application';
import { ITaskExitedEvent, ITaskInfo, ITaskServer, ITaskOptions, ProcessType } from '../common/task-protocol';
import { TaskWatcher } from '../common/task-watcher';
import { IShellTerminalServer } from '@theia/terminal/lib/common/shell-terminal-protocol';
import * as ws from 'ws';
import * as http from 'http';
import { isWindows } from '@theia/core/lib/common/os';
// import URI from "@theia/core/lib/common/uri";
// import { TaskFileUri } from './task-server';
// import { FileSystem } from '@theia/filesystem/lib/common';
import * as temp from 'temp';

chai.use(chaiAsPromised);

/**
 * Globals
 */

const expect = chai.expect;

const command_absolute_path = __dirname + '/test-resources/task';
const command_absolute_path__long_running = __dirname + '/test-resources/task-long-running';
const bogusCommand = 'thisisnotavalidcommand';
const command_to_find_in_path_unix = 'ls';
const command_to_find_in_path_windows = 'dir';

// TODO: test command that has relative path

describe('Task server / back-end', function () {
    this.timeout(5000);
    let server: http.Server;

    let taskServer: ITaskServer;
    // let fileSystem: FileSystem;
    const taskWatcher = testContainer.get(TaskWatcher);
    let shellTerminalServer: IShellTerminalServer;
    const track = temp.track();

    // taskWatcher.onTaskError((event: ITaskErrorEvent) => {
    //     console.info(`### Task ${event.taskId} has encountered an error. Exit code: ${event.error}`);
    // });
    taskWatcher.onTaskExit((event: ITaskExitedEvent) => {
        console.info(`*** Task ${event.taskId} has terminated. Exit code: ${event.code}, signal: ${event.signal}`);
    });

    before(async function () {
        const application = testContainer.get(BackendApplication);
        taskServer = testContainer.get(ITaskServer);
        // fileSystem = testContainer.get(FileSystem);
        taskServer.setClient(taskWatcher.getTaskClient());
        shellTerminalServer = testContainer.get(IShellTerminalServer);
        server = await application.start();
    });

    it("task running in terminal - is expected data received from the terminal ws server", async function () {
        const someString = 'someSingleWordString';

        // create task using terminal process
        const command = isWindows ? command_absolute_path + '.bat' : command_absolute_path;
        const taskInfo: ITaskInfo = await taskServer.run(createTaskOptions('terminal', command, [someString]));
        const terminalId = taskInfo.terminalId;

        // hook-up to terminal's ws and confirm that it outputs expected tasks' output
        const p = new Promise((resolve, reject) => {
            const socket = new ws(`ws://localhost:${server.address().port}/services/terminals/${terminalId}`);
            socket.on('message', msg => {
                taskServer.kill(taskInfo.taskId);
                // check output of task on terminal is what we expect
                const expected = `tasking... ${someString}`;
                if (msg.toString().indexOf(expected) !== -1) {
                    resolve();
                } else {
                    reject(`expected sub-string not found in terminal output. Expected: "${expected}" vs Actual: "${msg.toString()}"`);
                }

                socket.close();
            });
            socket.on('error', error => {
                reject(error);
            });
        });
        return expect(p).to.be.eventually.fulfilled;
    });

    it("task using raw process - task server response shall not contain a terminal id", async function () {
        const someString = 'someSingleWordString';

        // create task using terminal process
        const taskInfo: ITaskInfo = await taskServer.run(createTaskOptions('raw', command_absolute_path, [someString]));
        return expect(taskInfo.terminalId).to.be.undefined;
    });

    it("task is executed successfully using terminal process, command has absolute path", async function () {
        const command = isWindows ? command_absolute_path + '.bat' : command_absolute_path;
        const taskInfo: ITaskInfo = await taskServer.run(createTaskOptions('terminal', command, []));

        const p = new Promise((resolve, reject) => {
            taskWatcher.onTaskExit((event: ITaskExitedEvent) => {
                if (event.taskId === taskInfo.taskId && event.code === 0) {
                    resolve();
                } else {
                    reject(event.code);
                }
            });
        });
        return expect(p).to.be.eventually.fulfilled;
    });

    it("task is executed successfully using raw process, command has absolute path", async function () {
        const command = isWindows ? command_absolute_path + '.bat' : command_absolute_path;
        const taskInfo: ITaskInfo = await taskServer.run(createTaskOptions('raw', command, []));

        const p = new Promise((resolve, reject) => {
            taskWatcher.onTaskExit((event: ITaskExitedEvent) => {
                if (event.taskId === taskInfo.taskId && event.code === 0) {
                    resolve();
                } else {
                    reject(event.code);
                }
            });
        });
        return expect(p).to.be.eventually.fulfilled;
    });

    it("task can successfully execute command found in system path using a terminal process", async function () {
        const command = isWindows ? command_to_find_in_path_windows : command_to_find_in_path_unix;
        const taskInfo: ITaskInfo = await taskServer.run(createTaskOptions('terminal', command, []));

        const p = new Promise((resolve, reject) => {
            taskWatcher.onTaskExit((event: ITaskExitedEvent) => {
                if (event.taskId === taskInfo.taskId && event.code === 0) {
                    resolve();
                } else {
                    reject(event.code);
                }
            });
        });
        return expect(p).to.be.eventually.fulfilled;
    });

    it("task can successfully execute command found in system path using a raw process", async function () {
        const command = isWindows ? command_to_find_in_path_windows : command_to_find_in_path_unix;
        const taskInfo: ITaskInfo = await taskServer.run(createTaskOptions('raw', command, []));

        const p = new Promise((resolve, reject) => {
            taskWatcher.onTaskExit((event: ITaskExitedEvent) => {
                if (event.taskId === taskInfo.taskId && event.code === 0) {
                    resolve();
                } else {
                    reject(event.code);
                }
            });
        });
        return expect(p).to.be.eventually.fulfilled;
    });

    it("task using terminal process can be killed", async function () {
        const command = isWindows ? command_absolute_path__long_running + '.bat' : command_absolute_path__long_running;
        const taskInfo: ITaskInfo = await taskServer.run(createTaskOptions('terminal', command, []));

        await taskServer.kill(taskInfo.taskId);

        const p = new Promise((resolve, reject) => {
            taskWatcher.onTaskExit((event: ITaskExitedEvent) => {
                if (event.taskId === taskInfo.taskId && event.code === 0 && event.signal !== '0') {
                    resolve();
                } else {
                    reject(event.code);
                }
            });
        });
        return expect(p).to.be.eventually.fulfilled;
    });

    it("task using raw process can be killed", async function () {
        const command = isWindows ? command_absolute_path__long_running + '.bat' : command_absolute_path__long_running;
        const taskInfo: ITaskInfo = await taskServer.run(createTaskOptions('raw', command, []));

        await taskServer.kill(taskInfo.taskId);

        const p = new Promise((resolve, reject) => {
            taskWatcher.onTaskExit((event: ITaskExitedEvent) => {
                // why is code null here?
                if (event.taskId === taskInfo.taskId && event.code === null && event.signal === 'SIGTERM') {
                    resolve();
                } else {
                    reject(event.code);
                }
            });
        });
        return expect(p).to.be.eventually.fulfilled;
    });

    it("task using terminal process can handle command that does not exist", async function () {
        const p = taskServer.run(createTaskOptions('terminal', bogusCommand, []));
        return expect(p).to.be.eventually.rejectedWith(`Command not found: ${bogusCommand}`);
    });

    it("task using raw process can handle command that does not exist", async function () {
        const p = taskServer.run(createTaskOptions('raw', bogusCommand, []));
        return expect(p).to.be.eventually.rejectedWith(`Command not found: ${bogusCommand}`);
    });

    it("task server returns list of tasks from tasks.json", async function () {
        const tasks = await taskServer.getTasks();
        return expect(tasks).to.deep.equal(['list all files', 'test task']);
    });

    it("task server re-reads tasks.json if modified", async function () {
        // create new (temp) tasks file, have task server start with it being
        // injected, then add a task to the file. Confirm that task server has
        // re-read task file by asking it for the list of tasks and checking that
        // the newly added one is returned
        track.mkdirSync();
        // see json-preference-server.spec.ts for example of using temp

        // https://github.com/bruce/node-temp

    });

});


function createTaskOptions(processType: ProcessType, command: string, args: string[]): ITaskOptions {
    return {
        label: "test task",
        isBuild: false,
        processType: processType,
        'command': command,
        'args': args,
        'cwd': '',
        'errorMatcherName': ''
    };
}

