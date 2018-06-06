/********************************************************************************
 * Copyright (C) 2018 Red Hat, Inc. and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

import { injectable, inject } from 'inversify';
import URI from '@theia/core/lib/common/uri';
import { MessageService, Command, Emitter, Event } from '@theia/core/lib/common';
import { LabelProvider, isNative, AbstractDialog } from '@theia/core/lib/browser';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { FileSystem } from '@theia/filesystem/lib/common';
import { FileDialogFactory, DirNode } from '@theia/filesystem/lib/browser';
import { HostedPluginServer } from '../../common/plugin-protocol';

/**
 * Commands to control Hosted plugin instances.
 */
export namespace HostedPluginCommands {
    export const START: Command = {
        id: 'hosted-plugin:start',
        label: 'Hosted Plugin: Start Instance'
    };
    export const STOP: Command = {
        id: 'hosted-plugin:stop',
        label: 'Hosted Plugin: Stop Instance'
    };
    export const RESTART: Command = {
        id: 'hosted-plugin:restart',
        label: 'Hosted Plugin: Restart Instance'
    };
    export const SELECT_PATH: Command = {
        id: 'hosted-plugin:select-path',
        label: 'Hosted Plugin: Select Path'
    };
}

/**
 * Available states of hosted plugin instance.
 */
export enum HostedPluginState {
    Stopped = 'stopped',
    Starting = 'starting',
    Running = 'running',
    Stopping = 'stopping',
    Failed = 'failed'
}

/**
 * Responsible for UI to set up and control Hosted Plugin Instance.
 */
@injectable()
export class HostedPluginManagerClient {
    private readonly openNewTabAskDialog: OpenHostedInstanceLinkDialog;

    // path to the plugin on the file system
    protected pluginLocation: URI | undefined;

    // URL to the running plugin instance
    protected pluginInstanceURL: string | undefined;

    protected readonly stateChanged = new Emitter<HostedPluginState>();

    get onStateChanged(): Event<HostedPluginState> {
        return this.stateChanged.event;
    }

    constructor(
        @inject(HostedPluginServer) protected readonly hostedPluginServer: HostedPluginServer,
        @inject(MessageService) protected readonly messageService: MessageService,
        @inject(FileDialogFactory) protected readonly fileDialogFactory: FileDialogFactory,
        @inject(LabelProvider) protected readonly labelProvider: LabelProvider,
        @inject(WindowService) protected readonly windowService: WindowService,
        @inject(FileSystem) protected readonly fileSystem: FileSystem,
        @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService
    ) {
        this.openNewTabAskDialog = new OpenHostedInstanceLinkDialog(windowService);
    }

    async start(): Promise<void> {
        if (!this.pluginLocation) {
            await this.selectPluginPath();
            if (!this.pluginLocation) {
                // selection was cancelled
                return;
            }
        }

        try {
            this.stateChanged.fire(HostedPluginState.Starting);
            this.messageService.info('Starting hosted instance server ...');

            this.pluginInstanceURL = await this.hostedPluginServer.runHostedPluginInstance(this.pluginLocation.toString());
            await this.openPluginWindow();

            this.messageService.info('Hosted instance is running at: ' + this.pluginInstanceURL);
            this.stateChanged.fire(HostedPluginState.Running);
        } catch (error) {
            this.messageService.error('Failed to run hosted plugin instance: ' + this.getErrorMessage(error));
            this.stateChanged.fire(HostedPluginState.Failed);
        }
    }

    async stop(): Promise<void> {
        try {
            this.stateChanged.fire(HostedPluginState.Stopping);
            await this.hostedPluginServer.terminateHostedPluginInstance();
            this.messageService.info((this.pluginInstanceURL ? this.pluginInstanceURL : 'The instance') + ' has been terminated.');
            this.stateChanged.fire(HostedPluginState.Stopped);
        } catch (error) {
            this.messageService.warn(this.getErrorMessage(error));
        }
    }

    async restart(): Promise<void> {
        if (await this.hostedPluginServer.isHostedTheiaRunning()) {
            await this.stop();

            this.messageService.info('Starting hosted instance server ...');

            // It takes some time before OS released all resources e.g. port.
            // Keeping tries to run hosted instance with delay.
            this.stateChanged.fire(HostedPluginState.Starting);
            let lastError;
            for (let tries = 0; tries < 15; tries++) {
                try {
                    this.pluginInstanceURL = await this.hostedPluginServer.runHostedPluginInstance(this.pluginLocation!.toString());
                    await this.openPluginWindow();
                    this.messageService.info('Hosted instance is running at: ' + this.pluginInstanceURL);
                    this.stateChanged.fire(HostedPluginState.Running);
                    return;
                } catch (error) {
                    lastError = error;
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
            this.messageService.error('Failed to run hosted plugin instance: ' + this.getErrorMessage(lastError));
        } else {
            this.messageService.warn('Hosted Plugin instance is not running.');
        }

        this.stateChanged.fire(HostedPluginState.Failed);
    }

    /**
     * Creates directory choose dialog and set selected folder into pluginLocation field.
     */
    async selectPluginPath(): Promise<void> {
        const workspaceFolder = (await this.workspaceService.workspace).workspaceFolder || await this.fileSystem.getCurrentUserHome();
        if (!workspaceFolder) {
            throw new Error('Unable to find the root');
        }
        const rootUri = new URI(workspaceFolder.uri);
        const rootStat = await this.fileSystem.getFileStat(rootUri.toString());
        if (!rootStat) {
            throw new Error('Unable to find the rootStat');
        }

        const name = this.labelProvider.getName(rootUri);
        const label = await this.labelProvider.getIcon(workspaceFolder);
        const rootNode = DirNode.createRoot(rootStat, name, label);
        const dialog = this.fileDialogFactory({ title: HostedPluginCommands.SELECT_PATH.label! });
        dialog.model.navigateTo(rootNode);
        const node = await dialog.open();
        if (node) {
            if (await this.hostedPluginServer.isPluginValid(node.uri.toString())) {
                this.pluginLocation = node.uri;
                this.messageService.info('Plugin folder is set to: ' + node.uri.toString());
            } else {
                this.messageService.error('Specified folder does not contain valid plugin.');
            }
        }
    }

    /**
     * Opens window with URL to the running plugin instance.
     */
    protected async openPluginWindow(): Promise<void> {
        // do nothing for electron browser
        if (isNative) {
            return;
        }

        if (this.pluginInstanceURL) {
            try {
                this.windowService.openNewWindow(this.pluginInstanceURL);
            } catch (err) {
                // browser blocked opening of a new tab
                this.openNewTabAskDialog.showOpenNewTabAskDialog(this.pluginInstanceURL);
            }
        }
    }

    protected getErrorMessage(error: Error): string {
        return error.message.substring(error.message.indexOf(':') + 1);
    }
}

class OpenHostedInstanceLinkDialog extends AbstractDialog<string> {
    protected readonly windowService: WindowService;
    protected readonly openButton: HTMLButtonElement;
    protected readonly messageNode: HTMLDivElement;
    protected readonly linkNode: HTMLAnchorElement;
    value: string;

    constructor(windowService: WindowService) {
        super({
            title: 'Your browser prevented opening of a new tab'
        });
        this.windowService = windowService;

        this.linkNode = document.createElement('a');
        this.linkNode.target = "_blank";
        this.linkNode.setAttribute('style', 'color: var(--theia-ui-dialog-font-color);');
        this.contentNode.appendChild(this.linkNode);

        const messageNode = document.createElement('div');
        messageNode.innerText = 'Hosted instance is started at: ';
        messageNode.appendChild(this.linkNode);
        this.contentNode.appendChild(messageNode);

        this.appendCloseButton();
        this.openButton = this.appendAcceptButton('Open');
    }

    showOpenNewTabAskDialog(uri: string): void {
        this.value = uri;

        this.linkNode.innerHTML = uri;
        this.linkNode.href = uri;
        this.openButton.onclick = () => {
            this.windowService.openNewWindow(uri);
        };

        this.open();
    }
}
