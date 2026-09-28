import * as vscode from 'vscode';

export interface Log {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  show(): void;
}

export function createLog(): Log & vscode.Disposable {
  const channel = vscode.window.createOutputChannel('MD Studio', { log: true });
  return {
    info: (m) => channel.info(m),
    warn: (m) => channel.warn(m),
    error: (m) => channel.error(m),
    show: () => channel.show(true),
    dispose: () => channel.dispose(),
  };
}
