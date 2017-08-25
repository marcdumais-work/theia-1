/*
 * Copyright (C) 2017 Ericsson and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */
import { injectable, inject } from 'inversify';
import { TaskManager } from './task-manager';
import { Process } from '@theia/process/lib/node/process';
import { IOutputParser, OutputParser, IPattern, IMatcher, FileLocationKind, IParsedEntry } from './output-parser/output-parser';
import { ILogger } from '@theia/core/lib/common/';

// tsc error pattern
const tscErrorPattern: IPattern = {
    "patternName": "lerna tsc",
    "regexp": '(.*):\\s(.*)\\s?\\(([\\d,]+)\\):\\serror\\s(.*):\\s(.*)',
    "file": 2,
    "location": 3,
    "code": 4,
    "message": 5
};
const tscErrorMatcher: IMatcher = {
    "name": "TypeScript compiler 2.5.2",
    "label": "TypeScript errors",
    "owner": "tsc",
    "fileLocation": FileLocationKind.RELATIVE,
    // "filePrefix": '$workspace',
    "filePrefix": '/opt/ericsson-dev/theia/',
    "pattern": tscErrorPattern
};

@injectable()
export class Task {
    protected taskId: number;
    protected taskProcess: Process;
    protected taskParser: OutputParser;

    constructor(
        @inject(TaskManager) protected readonly taskManager: TaskManager,
        @inject(IOutputParser) protected readonly errorParser: OutputParser,
        @inject(ILogger) protected readonly logger: ILogger,
        process: Process,
        cwd: string,
        matcherName: string
    ) {
        this.taskId = this.taskManager.register(this);
        this.taskProcess = process;
        this.taskParser = errorParser;

        // let parser take care of the output of the task's process
        // TODO: lookup the matcher that corresponds to the name
        // passed as argument to constructor
        this.taskParser.parse(tscErrorMatcher, this.taskProcess.output);

        this.taskParser.on('entry-found', entry => {
            this.handleTaskOutputEntry(entry);
        });
    }

    kill() {
        // this.process.kill();
        // this.taskManager.taskTerminated(this);
        this.taskManager.delete(this);
        // this.errorParser.dispose();
    }

    get process() {
        return this.taskProcess;
    }

    get id() {
        return this.taskId;
    }

    get parser() {
        return this.taskParser;
    }

    // error/warning found in current task output
    // Markers are created per URI and owner, so we can have distinct markers vs the
    // language server, even if there is overlap in the problems found. We then can
    // have a distinct handling of their lifecycle compare to LS markers
    //
    // we want to create error markers for these entries
    // TODO: figure-out how/when to clear those markers. e.g. maybe clear them when we
    //       detect that the file has changed, and let the task find them again
    //       -> would work for tsc run watch but not for othet compilers, like gcc,
    //          that needs to be run "manually" again to re-detect errors. In this case
    //          we would want to clear the errors upon starting the build task again?
    //
    // - re-run a given task: clear all markers from previous run
    // - for background tasks, clear markers as files are changed, markers will be
    //   re-created if some errors persist
    protected handleTaskOutputEntry(entry: IParsedEntry) {

    }

}
