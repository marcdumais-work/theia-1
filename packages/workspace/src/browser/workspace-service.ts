/********************************************************************************
 * Copyright (C) 2017 TypeFox and others.
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

import { injectable, inject, postConstruct } from 'inversify';
import URI from '@theia/core/lib/common/uri';
import { FileSystem, FileStat } from '@theia/filesystem/lib/common';
import { FileSystemWatcher } from '@theia/filesystem/lib/browser';
import { WorkspaceServer } from '../common';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { FrontendApplication, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Disposable, Emitter, Event } from '@theia/core/lib/common';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { ILogger } from '@theia/core/lib/common/logger';
import { WorkspacePreferences } from './workspace-preferences';

export interface WorkspaceDescription {
    workspaceFolder: FileStat | undefined;
    roots: FileStat[]
}

/**
 * The workspace service.
 */
@injectable()
export class WorkspaceService implements FrontendApplicationContribution {

    private _workspaceDescription: WorkspaceDescription;
    private deferredWorkspaceDescription = new Deferred<WorkspaceDescription>();

    private rootWatchers: { [uri: string]: Disposable } = {};

    private hasWorkspace: boolean = false;

    @inject(FileSystem)
    protected readonly fileSystem: FileSystem;

    @inject(FileSystemWatcher)
    protected readonly watcher: FileSystemWatcher;

    @inject(WorkspaceServer)
    protected readonly server: WorkspaceServer;

    @inject(WindowService)
    protected readonly windowService: WindowService;

    @inject(ILogger)
    protected logger: ILogger;

    @inject(WorkspacePreferences)
    protected preferences: WorkspacePreferences;

    @postConstruct()
    protected async init(): Promise<void> {
        this._workspaceDescription = {
            workspaceFolder: undefined,
            roots: []
        };
        await this.updateWorkspace();
        this.updateTitle();
        const configUri = this.getWorkspaceConfigFileUri();
        if (configUri) {
            const configUriString = configUri.toString();
            this.watcher.onFilesChanged(changes => {
                if (changes.some(change => change.uri.toString() === configUriString)) {
                    this.updateWorkspace();
                }
            });
        }
    }

    get workspace(): Promise<WorkspaceDescription> {
        return this.deferredWorkspaceDescription.promise;
    }
    tryGetWorkspace(): WorkspaceDescription {
        return this._workspaceDescription;
    }

    protected readonly onWorkspaceChangeEmitter = new Emitter<WorkspaceDescription>();
    get onWorkspaceChanged(): Event<WorkspaceDescription> {
        return this.onWorkspaceChangeEmitter.event;
    }

    protected async updateWorkspace(): Promise<void> {
        if (!this._workspaceDescription.workspaceFolder) {
            const rootUri = await this.server.getMostRecentlyUsedWorkspace();
            this._workspaceDescription.workspaceFolder = await this.toValidRoot(rootUri);
        }
        this.deferredWorkspaceDescription.resolve(this._workspaceDescription);

        await this.preferences.ready;
        if (this._workspaceDescription.workspaceFolder) {
            let roots: string[];
            if (this.preferences['workspace.supportMultiRootWorkspace']) {
                const rootConfig = await this.getRootConfig();
                roots = rootConfig.roots;
            } else {
                roots = [this._workspaceDescription.workspaceFolder.uri];
            }

            for (const rootBeingWatched of Object.keys(this.rootWatchers)) {
                if (roots.indexOf(rootBeingWatched) < 0) {
                    this.stopWatch(rootBeingWatched);
                }
            }
            this._workspaceDescription.roots = [];
            for (const rootToWatch of roots) {
                const valid = await this.toValidRoot(rootToWatch);
                if (!this.rootWatchers[rootToWatch]) {
                    await this.startWatch(valid);
                }
                if (valid) {
                    this._workspaceDescription.roots.push(valid);
                }
            }
            if (!this.rootWatchers[this._workspaceDescription.workspaceFolder.uri]) {
                // must watch the workspace folder for meta data changes, even if it is not in the workspace
                await this.startWatch(this._workspaceDescription.workspaceFolder);
            }
        }
        this.onWorkspaceChangeEmitter.fire(this._workspaceDescription);
    }

    protected async getRootConfig(): Promise<{ stat: FileStat | undefined, roots: string[] }> {
        const configUri = this.getWorkspaceConfigFileUri();
        if (configUri) {
            let fileStat = undefined;
            const uriStr = configUri.path.toString();
            if (await this.fileSystem.exists(uriStr)) {
                const { stat, content } = await this.fileSystem.resolveContent(uriStr);
                fileStat = stat;
                if (content) {
                    const roots = JSON.parse(content).roots || [];
                    return { stat, roots: this._workspaceDescription.workspaceFolder && roots.length === 0 ? [this._workspaceDescription.workspaceFolder.uri] : roots };
                }
            }
            return { stat: fileStat, roots: [this._workspaceDescription.workspaceFolder!.uri] };
        }
        return { stat: undefined, roots: [] };
    }

    protected getWorkspaceConfigFileUri(): URI | undefined {
        if (this._workspaceDescription.workspaceFolder) {
            const rootUri = new URI(this._workspaceDescription.workspaceFolder.uri);
            return rootUri.resolve('.theia').resolve('root.json');
        }
    }

    protected updateTitle(): void {
        if (this._workspaceDescription.workspaceFolder) {
            const uri = new URI(this._workspaceDescription.workspaceFolder.uri);
            document.title = uri.displayName;
        } else {
            document.title = window.location.href;
        }
    }

    /**
     * on unload, we set our workspace root as the last recently used on the backend.
     * @param app
     */
    onStop(app: FrontendApplication): void {
        if (this._workspaceDescription.workspaceFolder) {
            this.server.setMostRecentlyUsedWorkspace(this._workspaceDescription.workspaceFolder.uri);
        }
    }

    async onStart() {
        const allWorkspace = await this.recentWorkspaces();
        if (allWorkspace.length > 0) {
            this.hasWorkspace = true;
        }
    }

    get hasHistory(): boolean {
        return this.hasWorkspace;
    }

    async recentWorkspaces(): Promise<string[]> {
        return this.server.getRecentWorkspaces();
    }

    /**
     * Returns `true` if current workspace root is set.
     * @returns {boolean}
     */
    get opened(): boolean {
        return !!this._workspaceDescription.workspaceFolder;
    }

    /**
     * Returns `true` if there is an opened workspace in theia, and the workspace has more than one root.
     * @returns {boolean}
     */
    get isMultiRootWorkspaceOpened(): boolean {
        return this.opened && this.preferences['workspace.supportMultiRootWorkspace'];
    }

    /**
     * Opens the given URI as the current workspace root.
     */
    open(uri: URI, options?: WorkspaceInput): void {
        this.doOpen(uri, options);
    }

    protected async doOpen(uri: URI, options?: WorkspaceInput): Promise<void> {
        const rootUri = uri.toString();
        const valid = await this.toValidRoot(rootUri);
        if (valid) {
            // The same window has to be preserved too (instead of opening a new one), if the workspace root is not yet available and we are setting it for the first time.
            // Option passed as parameter has the highest priority (for api developers), then the preference, then the default.
            const rootToOpen = (await this.workspace).workspaceFolder;
            const { preserveWindow } = {
                preserveWindow: this.preferences['workspace.preserveWindow'] || !(rootToOpen),
                ...options
            };
            await this.server.setMostRecentlyUsedWorkspace(rootUri);
            if (preserveWindow) {
                this._workspaceDescription.workspaceFolder = valid;
            }
            await this.openWindow({ preserveWindow });
            return;
        }
        throw new Error('Invalid workspace root URI. Expected an existing directory location.');
    }

    /**
     * Adds a root folder to the workspace
     * @param uri URI of the root folder being added
     */
    async addRoot(uri: URI): Promise<void> {
        const workspaceRootChange = await this.workspace;
        const workspaceFolder = workspaceRootChange.workspaceFolder;
        if (!this.opened || !workspaceFolder) {
            throw new Error('Folder cannot be added as there is no active folder in the current workspace.');
        }

        const rootToAdd = uri.toString();
        const valid = await this.toValidRoot(rootToAdd);
        if (!valid) {
            throw new Error(`Invalid workspace root URI. Expected an existing directory location. URI: ${rootToAdd}.`);
        }
        if (this._workspaceDescription.workspaceFolder && !this._workspaceDescription.roots.find(r => r.uri === valid.uri)) {
            const configUri = this.getWorkspaceConfigFileUri();
            if (configUri) {
                if (!await this.fileSystem.exists(configUri.toString())) {
                    await this.fileSystem.createFile(configUri.toString());
                }
                await this.writeRootFolderConfigFile(
                    (await this.fileSystem.getFileStat(configUri.toString()))!,
                    [...this._workspaceDescription.roots, valid]
                );
            }
        }
    }

    /**
     * Removes root folder(s) from workspace.
     */
    async removeRoots(uris: URI[]): Promise<void> {
        if (!this.opened) {
            throw new Error('Folder cannot be removed as there is no active folder in the current workspace.');
        }
        await this.writeRootFolderConfigFile(
            (await this.getRootConfig()).stat!,
            this._workspaceDescription.roots.filter(root => uris.findIndex(u => u.toString() === root.uri) < 0)
        );
    }

    private async writeRootFolderConfigFile(rootConfigFile: FileStat, rootFolders: FileStat[]): Promise<void> {
        const folders = rootFolders.slice();
        if (folders.length === 0 && this._workspaceDescription.workspaceFolder) {
            folders.push(this._workspaceDescription.workspaceFolder);
        }
        await this.fileSystem.setContent(rootConfigFile, JSON.stringify({ roots: folders.map(f => f.uri) }));
    }

    /**
     * Clears current workspace root.
     */
    close(): void {
        this._workspaceDescription.workspaceFolder = undefined;

        this._workspaceDescription.workspaceFolder = undefined;
        this._workspaceDescription.roots = [];

        this.server.setMostRecentlyUsedWorkspace('');
        this.reloadWindow();
    }

    /**
     * returns a FileStat if the argument URI points to an existing directory. Otherwise, `undefined`.
     */
    protected async toValidRoot(uri: string | undefined): Promise<FileStat | undefined> {
        if (!uri) {
            return undefined;
        }
        try {
            if (uri && uri.endsWith('/')) {
                uri = uri.slice(0, -1);
            }
            const fileStat = await this.fileSystem.getFileStat(uri);
            if (!fileStat) {
                return undefined;
            }
            if (fileStat.isDirectory) {
                return fileStat;
            }
            return undefined;
        } catch (error) {
            return undefined;
        }
    }

    protected openWindow(options?: WorkspaceInput): void {
        if (this.shouldPreserveWindow(options)) {
            this.reloadWindow();
        } else {
            try {
                this.openNewWindow();
            } catch (error) {
                // Fall back to reloading the current window in case the browser has blocked the new window
                this.updateWorkspace();
                this.logger.error(error.toString()).then(async () => await this.reloadWindow());
            }
        }
    }

    protected reloadWindow(): void {
        window.location.reload(true);
    }

    protected openNewWindow(): void {
        this.windowService.openNewWindow(window.location.href);
    }

    protected shouldPreserveWindow(options?: WorkspaceInput): boolean {
        return options !== undefined && !!options.preserveWindow;
    }

    /**
     * Return true if one of the paths in paths array is present in the workspace
     * NOTE: You should always explicitly use `/` as the separator between the path segments.
     */
    async containsSome(paths: string[]): Promise<boolean> {
        const workspaceFolder = (await this.workspace).workspaceFolder;
        if (workspaceFolder) {
            const uri = new URI(workspaceFolder.uri);
            for (const path of paths) {
                const fileUri = uri.resolve(path).toString();
                const exists = await this.fileSystem.exists(fileUri);
                if (exists) {
                    return exists;
                }
            }
        }
        return false;
    }

    protected async startWatch(validRoot: FileStat | undefined): Promise<void> {
        if (validRoot && !this.rootWatchers[validRoot.uri]) {
            const uri = new URI(validRoot.uri);
            const watcher = (await this.watcher.watchFileChanges(uri));
            this.rootWatchers[validRoot.uri] = watcher;
        }
    }

    protected stopWatch(uri?: string): void {
        if (uri) {
            if (this.rootWatchers[uri]) {
                this.rootWatchers[uri].dispose();
                delete this.rootWatchers[uri];
            }
        } else {
            for (const watchedUri of Object.keys(this.rootWatchers)) {
                this.rootWatchers[watchedUri].dispose();
            }
            this.rootWatchers = {};
        }
    }
}

export interface WorkspaceInput {

    /**
     * Tests whether the same window should be used or a new one has to be opened after setting the workspace root. By default it is `false`.
     */
    preserveWindow?: boolean;

}
