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

import { interfaces } from 'inversify';
import { createPreferenceProxy, PreferenceProxy, PreferenceService, PreferenceContribution, PreferenceSchema } from '@theia/core/lib/browser';

// tslint:disable:max-line-length

export const FileNavigatorConfigSchema: PreferenceSchema = {
    'type': 'object',
    properties: {
        'navigator.autoReveal': {
            type: 'boolean',
            description: 'Selects file under editing in the navigator.',
            default: true
        },
        'navigator.exclude': {
            type: 'object',
            description: `
Configure glob patterns for excluding files and folders from the navigator. A resource that matches any of the enabled patterns, will be filtered out from the navigator. For more details about the exclusion patterns, see: \`man 5 gitignore\`.`,
            default: {
                "**/.git": true
            }
        }
    }
};

export interface FileNavigatorConfiguration {
    'navigator.autoReveal': boolean;
    'navigator.exclude': { [key: string]: boolean };
}

export const FileNavigatorPreferences = Symbol('NavigatorPreferences');
export type FileNavigatorPreferences = PreferenceProxy<FileNavigatorConfiguration>;

export function createNavigatorPreferences(preferences: PreferenceService): FileNavigatorPreferences {
    return createPreferenceProxy(preferences, FileNavigatorConfigSchema);
}

export function bindFileNavigatorPreferences(bind: interfaces.Bind): void {
    bind(FileNavigatorPreferences).toDynamicValue(ctx => {
        const preferences = ctx.container.get<PreferenceService>(PreferenceService);
        return createNavigatorPreferences(preferences);
    });
    bind(PreferenceContribution).toConstantValue({ schema: FileNavigatorConfigSchema });
}
