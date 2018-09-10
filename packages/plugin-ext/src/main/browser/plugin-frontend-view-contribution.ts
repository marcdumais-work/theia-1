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
import { MessageService } from '@theia/core';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { PluginWidget } from './plugin-ext-widget';

@injectable()
export class PluginFrontendViewContribution extends AbstractViewContribution<PluginWidget> {

    public static PLUGINS_WIDGET_FACTORY_ID = 'plugins';

    @inject(MessageService) protected readonly messageService: MessageService;

    constructor() {
        super({
            widgetId: PluginFrontendViewContribution.PLUGINS_WIDGET_FACTORY_ID,
            widgetName: 'Plugins',
            defaultWidgetOptions: {
                area: 'left',
                rank: 300
            },
            toggleCommandId: 'pluginsView:toggle',
            toggleKeybinding: 'ctrlcmd+shift+y'
        });
    }

}
