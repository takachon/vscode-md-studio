import * as vscode from 'vscode';
import * as path from 'node:path';
import { MdStudioEditorProvider, MermaidStatus, VIEW_TYPE } from './editorProvider';
import { ExportPanels } from './export';
import { createLog } from './log';

/** The Markdown file of the active editor tab (text or MD Studio). */
function activeMarkdownUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText) return input.uri;
  return vscode.window.activeTextEditor?.document.uri;
}

export function activate(context: vscode.ExtensionContext): void {
  const log = createLog();
  const status = new MermaidStatus();
  const provider = new MdStudioEditorProvider(context, log, status);
  const exports = new ExportPanels(context, log);
  context.subscriptions.push(
    log,
    status,
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    }),

    vscode.commands.registerCommand('mdStudio.openEditor', async (uri?: vscode.Uri) => {
      const target = uri ?? activeMarkdownUri();
      if (target) await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE);
    }),

    vscode.commands.registerCommand('mdStudio.openTextEditor', async (uri?: vscode.Uri) => {
      const target = uri ?? activeMarkdownUri();
      if (!target) return;
      await provider.flush(target);
      await vscode.commands.executeCommand('vscode.openWith', target, 'default');
    }),

    ...(['export', 'exportHtml', 'exportPdf'] as const).map((name) =>
      vscode.commands.registerCommand(`mdStudio.${name}`, async (uri?: vscode.Uri) => {
        const source = uri instanceof vscode.Uri ? uri : activeMarkdownUri();
        if (!source) {
          void vscode.window.showErrorMessage('Open a Markdown file to export.');
          return;
        }
        await provider.flush(source);
        const doc = await vscode.workspace.openTextDocument(source);
        const format = name === 'exportHtml' ? 'html' : name === 'exportPdf' ? 'pdf' : undefined;
        await exports.show(doc, format);
      }),
    ),

    vscode.commands.registerCommand('mdStudio.showLog', () => log.show()),
  );
}

export function deactivate(): void {
  /* nothing to clean up: all resources are in context.subscriptions */
}
