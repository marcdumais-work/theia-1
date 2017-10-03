/*
 * Copyright (C) 2017 Ericsson and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { ContainerModule } from 'inversify';
import { ConnectionHandler, JsonRpcConnectionHandler } from "@theia/core/lib/common/messaging";
import { Task } from './task';
import { ITaskClient, ITaskServer, taskPath } from '../common/task-protocol';
import { TaskServer, TaskFileUri } from './task-server';
import { TaskManager } from './task-manager';
import { TaskWatcher } from '../common/task-watcher';
import { ILogger } from '@theia/core/lib/common/logger';
import { WorkspaceServer } from '@theia/workspace/lib/common';
import URI from "@theia/core/lib/common/uri";
import { IOutputParser, OutputParser } from './output-parser/output-parser';

export default new ContainerModule(bind => {

    bind(IOutputParser).to(OutputParser);
    bind(TaskManager).toSelf().inSingletonScope();
    bind(ITaskServer).to(TaskServer).inSingletonScope();
    bind(Task).toSelf().inTransientScope();
    bind(TaskWatcher).toSelf().inSingletonScope();

    bind(ILogger).toDynamicValue(ctx => {
        const logger = ctx.container.get<ILogger>(ILogger);
        return logger.child({ 'module': 'task' });
    }).inSingletonScope().whenTargetNamed("task");

    bind(ConnectionHandler).toDynamicValue(ctx =>
        new JsonRpcConnectionHandler<ITaskClient>(taskPath, client => {
            const taskServer = ctx.container.get<ITaskServer>(ITaskServer);
            taskServer.setClient(client);
            return taskServer;
        })
    ).inSingletonScope();

    // tasks file path: ${workspace_root}/.theia/tasks.json
    bind(TaskFileUri).toDynamicValue(ctx => {
        const workspaceServer = ctx.container.get<WorkspaceServer>(WorkspaceServer);
        const taskFileUri = workspaceServer.getRoot().then(root => {
            const rootUri = new URI(root);
            return rootUri.withPath(rootUri.path.join('.theia', 'tasks.json'));
        });
        return taskFileUri;
    });

});

