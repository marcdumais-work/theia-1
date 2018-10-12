/********************************************************************************
 * Copyright (C) 2018 TypeFox and others.
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
import { JSONExt, JSONObject, JSONValue } from '@phosphor/coreutils';
import { Configurations, ConfigurationChangeEvent, WorkspaceConfiguration } from 'monaco-languageclient';
import { Event, Emitter } from '@theia/core/lib/common';
import { PreferenceServiceImpl, PreferenceChange } from '@theia/core/lib/browser';

const debounce = require('lodash.debounce');

@injectable()
export class MonacoConfigurations implements Configurations {

    protected readonly onDidChangeConfigurationEmitter = new Emitter<ConfigurationChangeEvent>();
    readonly onDidChangeConfiguration: Event<ConfigurationChangeEvent> = this.onDidChangeConfigurationEmitter.event;

    @inject(PreferenceServiceImpl)
    protected readonly preferences: PreferenceServiceImpl;

    protected tree: JSONObject = {};
    protected changes: PreferenceChange[] = [];

    @postConstruct()
    protected init(): void {
        this.doReconcileData();
        this.preferences.onPreferenceChanged(change => {
            this.changes.push(change);
            this.reconcileData();
        });
    }

    protected readonly reconcileData = debounce(() => this.doReconcileData(), 50);
    protected doReconcileData(): void {
        const changes = [...this.changes];
        this.changes = [];
        this.tree = MonacoConfigurations.parse(this.preferences.getPreferences());
        this.onDidChangeConfigurationEmitter.fire({
            affectsConfiguration: section => {
                if (!changes.length) {
                    return true;
                }
                return changes.some(({ preferenceName }) => section.startsWith(preferenceName) || preferenceName.startsWith(section));
            }
        });
    }

    protected fireDidChangeConfiguration({ preferenceName }: PreferenceChange): void {
        this.onDidChangeConfigurationEmitter.fire({
            affectsConfiguration: section => section.startsWith(preferenceName) || preferenceName.startsWith(section)
        });
    }

    getConfiguration(section?: string, resource?: string): WorkspaceConfiguration {
        const tree = section ? MonacoConfigurations.lookUp(this.tree, section) : this.tree;
        // TODO take resource into the account when the multi-root is supported by preferences
        return new MonacoWorkspaceConfiguration(tree);
    }

}
export namespace MonacoConfigurations {
    export function parse(raw: { [section: string]: Object | undefined }): JSONObject {
        const tree = {};
        for (const section of Object.keys(raw)) {
            const value = raw[section];
            if (value) {
                assign(tree, section, <JSONValue>value);
            }
        }
        return tree;
    }
    export function assign(data: JSONObject, section: string, value: JSONValue): void {
        let node: JSONValue = data;
        const parts = section.split('.');
        while (JSONExt.isObject(node) && parts.length > 1) {
            const part = parts.shift()!;
            node = node[part] || (node[part] = {});
        }
        if (JSONExt.isObject(node) && parts.length === 1) {
            node[parts[0]] = value;
        }
    }
    export function lookUp(tree: JSONValue | undefined, section: string | undefined): JSONValue | undefined {
        if (!section) {
            return undefined;
        }
        let node: JSONValue | undefined = tree;
        const parts = section.split('.');
        while (node && JSONExt.isObject(node) && parts.length > 0) {
            node = node[parts.shift()!];
        }
        return !parts.length ? node : undefined;
    }
}

export class MonacoWorkspaceConfiguration implements WorkspaceConfiguration {

    constructor(
        protected readonly tree: JSONValue | undefined
    ) {
        if (tree && JSONExt.isObject(tree)) {
            Object.assign(this, tree);
        }
    }

    readonly [key: string]: any;

    has(section: string): boolean {
        return typeof MonacoConfigurations.lookUp(this.tree, section) !== 'undefined';
    }

    get<T>(section: string, defaultValue?: T): T | undefined {
        const value = MonacoConfigurations.lookUp(this.tree, section);
        if (typeof value === 'undefined') {
            return defaultValue;
        }
        const result = JSONExt.isObject(value) ? JSONExt.deepCopy(value) : value;
        return result as any;
    }

}
