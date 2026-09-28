// Toolbar with VS Code's own icons (Codicons), laid out like Office Viewer's Markdown editor.
import bold from '@vscode/codicons/src/icons/bold.svg';
import checklist from '@vscode/codicons/src/icons/checklist.svg';
import code from '@vscode/codicons/src/icons/code.svg';
import discard from '@vscode/codicons/src/icons/discard.svg';
import editorLayout from '@vscode/codicons/src/icons/editor-layout.svg';
import exportIcon from '@vscode/codicons/src/icons/export.svg';
import fileMedia from '@vscode/codicons/src/icons/file-media.svg';
import goToFile from '@vscode/codicons/src/icons/go-to-file.svg';
import italic from '@vscode/codicons/src/icons/italic.svg';
import link from '@vscode/codicons/src/icons/link.svg';
import listOrdered from '@vscode/codicons/src/icons/list-ordered.svg';
import listTree from '@vscode/codicons/src/icons/list-tree.svg';
import listUnordered from '@vscode/codicons/src/icons/list-unordered.svg';
import quote from '@vscode/codicons/src/icons/quote.svg';
import redo from '@vscode/codicons/src/icons/redo.svg';
import save from '@vscode/codicons/src/icons/save.svg';
import settingsGear from '@vscode/codicons/src/icons/settings-gear.svg';
import strikethrough from '@vscode/codicons/src/icons/strikethrough.svg';
import table from '@vscode/codicons/src/icons/table.svg';
import textSize from '@vscode/codicons/src/icons/text-size.svg';
import type { ToolbarCommand } from '../protocol';

const builtin = (name: string, icon: string, tip: string) => ({ name, icon, tip, tipPosition: 's' });

export function toolbarItems(run: (command: ToolbarCommand) => void) {
  const custom = (name: string, icon: string, tip: string, command: ToolbarCommand) => ({
    name,
    icon,
    tip,
    tipPosition: 's',
    click: () => run(command),
  });
  return [
    builtin('outline', listTree, 'Outline'),
    '|',
    custom('md-open-text', goToFile, 'Open as Text Editor', 'openText'),
    custom('md-save', save, 'Save (Ctrl+S)', 'save'),
    custom('md-export', exportIcon, 'Export (HTML / PDF)…', 'export'),
    '|',
    builtin('headings', textSize, 'Heading'),
    builtin('bold', bold, 'Bold (Ctrl+B)'),
    builtin('italic', italic, 'Italic (Ctrl+I)'),
    builtin('strike', strikethrough, 'Strikethrough (Ctrl+D)'),
    builtin('link', link, 'Link (Ctrl+K)'),
    '|',
    builtin('list', listUnordered, 'Bulleted List'),
    builtin('ordered-list', listOrdered, 'Numbered List'),
    builtin('check', checklist, 'Task List'),
    builtin('table', table, 'Table'),
    '|',
    builtin('quote', quote, 'Quote'),
    builtin('code', code, 'Code Block'),
    builtin('upload', fileMedia, 'Insert Image'),
    '|',
    builtin('undo', discard, 'Undo (Ctrl+Z)'),
    builtin('redo', redo, 'Redo (Ctrl+Y)'),
    '|',
    builtin('edit-mode', editorLayout, 'Editing Mode'),
    custom('md-settings', settingsGear, 'Settings', 'settings'),
  ];
}
