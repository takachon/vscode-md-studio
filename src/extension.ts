import * as vscode from 'vscode';
import * as path from 'node:path';
import { MdStudioEditorProvider, MermaidStatus, VIEW_TYPE } from './editorProvider';
import { exportHtml } from './export';
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

    vscode.commands.registerCommand('mdStudio.exportHtml', async (uri?: vscode.Uri) => {
      const source = uri ?? activeMarkdownUri();
      if (!source) {
        void vscode.window.showErrorMessage('Open a Markdown file to export.');
        return;
      }
      await provider.flush(source);
      const doc = await vscode.workspace.openTextDocument(source);
      const defaultUri =
        doc.uri.scheme === 'untitled'
          ? undefined
          : vscode.Uri.joinPath(doc.uri, '..', path.basename(doc.uri.path).replace(/\.[^.]+$/, '') + '.html');
      const target = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { HTML: ['html', 'htm'] },
        saveLabel: 'Export',
        title: 'Export to Single HTML File',
      });
      if (!target) return;
      try {
        const result = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Exporting ${path.basename(doc.uri.path)} to HTML` },
          () => exportHtml(context, log, doc, target),
        );
        const size = `${(result.bytes / 1024 / 1024).toFixed(1)} MB`;
        const summary = `Exported ${path.basename(target.path)} (${size}, ${result.images} image(s), ${result.diagrams} diagram(s)).`;
        const actions = result.problems.length ? ['Show Problems'] : [];
        const pick = result.problems.length
          ? await vscode.window.showWarningMessage(`${summary} ${result.problems.length} problem(s).`, ...actions)
          : await vscode.window.showInformationMessage(summary);
        if (pick === 'Show Problems') log.show();
      } catch (e) {
        log.error(`export failed: ${(e as Error).stack ?? e}`);
        void vscode.window.showErrorMessage(`HTML export failed: ${(e as Error).message}`);
      }
    }),

    vscode.commands.registerCommand('mdStudio.showLog', () => log.show()),
  );
}

export function deactivate(): void {
  /* nothing to clean up: all resources are in context.subscriptions */
}
