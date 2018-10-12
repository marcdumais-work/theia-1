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
import {
    LanguagesMain,
    SerializedLanguageConfiguration,
    SerializedRegExp,
    SerializedIndentationRule,
    SerializedOnEnterRule,
    MAIN_RPC_CONTEXT,
    LanguagesExt
} from '../../api/plugin-api';
import { SerializedDocumentFilter, MarkerData } from '../../api/model';
import { RPCProtocol } from '../../api/rpc-protocol';
import { fromLanguageSelector } from '../../plugin/type-converters';
import { UriComponents } from '@theia/plugin-ext/src/common/uri-components';

export class LanguagesMainImpl implements LanguagesMain {

    private readonly proxy: LanguagesExt;
    private readonly disposables = new Map<number, monaco.IDisposable>();
    constructor(rpc: RPCProtocol) {
        this.proxy = rpc.getProxy(MAIN_RPC_CONTEXT.LANGUAGES_EXT);
    }

    $getLanguages(): Promise<string[]> {
        return Promise.resolve(monaco.languages.getLanguages().map(l => l.id));
    }

    $unregister(handle: number): void {
        const disposable = this.disposables.get(handle);
        if (disposable) {
            disposable.dispose();
            this.disposables.delete(handle);
        }
    }

    $setLanguageConfiguration(handle: number, languageId: string, configuration: SerializedLanguageConfiguration): void {
        const config: monaco.languages.LanguageConfiguration = {
            comments: configuration.comments,
            brackets: configuration.brackets,
            wordPattern: reviveRegExp(configuration.wordPattern),
            indentationRules: reviveIndentationRule(configuration.indentationRules),
            onEnterRules: reviveOnEnterRules(configuration.onEnterRules),
        };

        this.disposables.set(handle, monaco.languages.setLanguageConfiguration(languageId, config));
    }

    $registerCompletionSupport(handle: number, selector: SerializedDocumentFilter[], triggerCharacters: string[], supportsResolveDetails: boolean): void {
        this.disposables.set(handle, monaco.modes.SuggestRegistry.register(fromLanguageSelector(selector)!, {
            triggerCharacters,
            provideCompletionItems: (model: monaco.editor.ITextModel,
                position: monaco.Position,
                context: monaco.modes.SuggestContext,
                token: monaco.CancellationToken): Thenable<monaco.modes.ISuggestResult> =>
                Promise.resolve(this.proxy.$provideCompletionItems(handle, model.uri, position, context)).then(result => {
                    if (!result) {
                        return undefined!;
                    }
                    return {
                        suggestions: result.completions,
                        incomplete: result.incomplete,
                        dispose: () => this.proxy.$releaseCompletionItems(handle, (<any>result)._id)
                    };
                }),
            resolveCompletionItem: supportsResolveDetails
                ? (model, position, suggestion, token) => Promise.resolve(this.proxy.$resolveCompletionItem(handle, model.uri, position, suggestion))
                : undefined
        }));
    }

    $clearDiagnostics(id: string): void {
        const markers = monaco.editor.getModelMarkers({ owner: id });
        const clearedEditors = new Set<string>(); // uri to resource
        for (const marker of markers) {
            const uri = marker.resource;
            const uriString = uri.toString();
            if (!clearedEditors.has(uriString)) {
                const textModel = monaco.editor.getModel(uri);
                monaco.editor.setModelMarkers(textModel, id, []);
                clearedEditors.add(uriString);
            }
        }
    }

    $changeDiagnostics(id: string, delta: [UriComponents, MarkerData[]][]): void {
        for (const [uriComponents, markers] of delta) {
            const uri = monaco.Uri.revive(uriComponents);
            const textModel = monaco.editor.getModel(uri);
            monaco.editor.setModelMarkers(textModel, id, markers.map(reviveMarker));
        }
    }
}

function reviveMarker(marker: MarkerData): monaco.editor.IMarkerData {
    const monacoMarker: monaco.editor.IMarkerData = {
        code: marker.code,
        severity: marker.severity,
        message: marker.message,
        source: marker.source,
        startLineNumber: marker.startLineNumber,
        startColumn: marker.startColumn,
        endLineNumber: marker.endLineNumber,
        endColumn: marker.endColumn,
        relatedInformation: undefined
    };
    if (marker.relatedInformation) {
        monacoMarker.relatedInformation = [];
        for (const ri of marker.relatedInformation) {
            monacoMarker.relatedInformation.push({
                resource: monaco.Uri.revive(ri.resource),
                message: ri.message,
                startLineNumber: ri.startLineNumber,
                startColumn: ri.startColumn,
                endLineNumber: ri.endLineNumber,
                endColumn: ri.endColumn
            });
        }
    }

    return monacoMarker;
}

function reviveRegExp(regExp?: SerializedRegExp): RegExp | undefined {
    if (typeof regExp === 'undefined' || regExp === null) {
        return undefined;
    }
    return new RegExp(regExp.pattern, regExp.flags);
}

function reviveIndentationRule(indentationRule?: SerializedIndentationRule): monaco.languages.IndentationRule | undefined {
    if (typeof indentationRule === 'undefined' || indentationRule === null) {
        return undefined;
    }
    return {
        increaseIndentPattern: reviveRegExp(indentationRule.increaseIndentPattern)!,
        decreaseIndentPattern: reviveRegExp(indentationRule.decreaseIndentPattern)!,
        indentNextLinePattern: reviveRegExp(indentationRule.indentNextLinePattern),
        unIndentedLinePattern: reviveRegExp(indentationRule.unIndentedLinePattern),
    };
}

function reviveOnEnterRule(onEnterRule: SerializedOnEnterRule): monaco.languages.OnEnterRule {
    return {
        beforeText: reviveRegExp(onEnterRule.beforeText)!,
        afterText: reviveRegExp(onEnterRule.afterText),
        action: onEnterRule.action
    };
}

function reviveOnEnterRules(onEnterRules?: SerializedOnEnterRule[]): monaco.languages.OnEnterRule[] | undefined {
    if (typeof onEnterRules === 'undefined' || onEnterRules === null) {
        return undefined;
    }
    return onEnterRules.map(reviveOnEnterRule);
}
