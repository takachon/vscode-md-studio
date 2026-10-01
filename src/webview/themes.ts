// Color themes of the editor. `auto` uses VS Code's colors; the others override the VS Code color
// variables the page is styled with, so every part (document, toolbar, outline, menus) follows.
import type { EditorTheme } from '../protocol';

interface Palette {
  dark: boolean;
  /** Document area. */
  page: string;
  /** Toolbar and outline, a step away from the page so the editing area stands out. */
  chrome: string;
  fg: string;
  muted: string;
  border: string;
  link: string;
  hover: string;
  selection: string;
  accent: string;
  quote: string;
}

const PALETTES: Record<Exclude<EditorTheme, 'auto'>, Palette> = {
  light: {
    dark: false, page: '#ffffff', chrome: '#f0f1f3', fg: '#1f2328', muted: '#656d76', border: '#d4d7dc',
    link: '#0969da', hover: 'rgba(31,35,40,.08)', selection: '#dde6f3', accent: '#0969da', quote: '#f6f8fa',
  },
  warm: {
    dark: false, page: '#fdf9ec', chrome: '#f2ead3', fg: '#2e2a22', muted: '#6f6553', border: '#e0d5b8',
    link: '#1f5fa8', hover: 'rgba(90,70,20,.09)', selection: '#ebdfb8', accent: '#9a6700', quote: '#f6efda',
  },
  sepia: {
    dark: false, page: '#f4ecd8', chrome: '#e8dbbd', fg: '#4a3a28', muted: '#7a6650', border: '#d6c29c',
    link: '#8a4b12', hover: 'rgba(90,60,20,.10)', selection: '#e0cda6', accent: '#8a4b12', quote: '#ece1c6',
  },
  dark: {
    dark: true, page: '#1e1e1e', chrome: '#2a2a2b', fg: '#d4d4d4', muted: '#9d9d9d', border: '#3c3c3c',
    link: '#4daafc', hover: 'rgba(255,255,255,.08)', selection: '#37373d', accent: '#4daafc', quote: '#262626',
  },
  midnight: {
    dark: true, page: '#161b26', chrome: '#10141d', fg: '#c9d1d9', muted: '#8b96a8', border: '#2a3242',
    link: '#6cb6ff', hover: 'rgba(160,190,255,.09)', selection: '#243049', accent: '#6cb6ff', quote: '#1c2230',
  },
};

export const THEME_IDS: EditorTheme[] = ['auto', 'light', 'warm', 'sepia', 'dark', 'midnight'];

function variables(p: Palette): Record<string, string> {
  return {
    'editor-background': p.page,
    'editor-foreground': p.fg,
    foreground: p.fg,
    descriptionForeground: p.muted,
    'icon-foreground': p.fg,
    'textLink-foreground': p.link,
    'textBlockQuote-background': p.quote,
    'editorGroup-border': p.border,
    'widget-border': p.border,
    'widget-shadow': p.dark ? 'rgba(0,0,0,.5)' : 'rgba(0,0,0,.16)',
    'sideBar-background': p.chrome,
    'sideBarSectionHeader-foreground': p.fg,
    'editorWidget-background': p.chrome,
    'editorWidget-foreground': p.fg,
    'editorWidget-border': p.border,
    'editorHoverWidget-background': p.chrome,
    'editorHoverWidget-foreground': p.fg,
    'editorHoverWidget-border': p.border,
    'toolbar-hoverBackground': p.hover,
    'inputOption-activeBackground': p.selection,
    'inputOption-activeForeground': p.accent,
    'inputOption-activeBorder': p.accent,
    'list-hoverBackground': p.hover,
    'list-inactiveSelectionBackground': p.selection,
    'list-inactiveSelectionForeground': p.fg,
    'menu-background': p.page,
    'menu-foreground': p.fg,
    'menu-border': p.border,
    'menu-selectionBackground': p.selection,
    'menu-selectionForeground': p.fg,
    'menu-separatorBackground': p.border,
    'button-secondaryBackground': p.selection,
    'button-secondaryForeground': p.fg,
    'focusBorder': p.accent,
    // Otherwise the scroll bars keep VS Code's colors (dark bars on a light theme and vice versa).
    'scrollbarSlider-background': p.dark ? 'rgba(121,121,121,.4)' : 'rgba(100,100,100,.4)',
    'scrollbarSlider-hoverBackground': 'rgba(100,100,100,.7)',
    'scrollbarSlider-activeBackground': p.dark ? 'rgba(191,191,191,.4)' : 'rgba(0,0,0,.6)',
  };
}

const vscodeDark = () =>
  document.body.classList.contains('vscode-dark') ||
  (document.body.classList.contains('vscode-high-contrast') && !document.body.classList.contains('vscode-high-contrast-light'));

let current: EditorTheme = 'auto';

/** True when the document is shown on a dark background. */
export const isDarkTheme = () => (current === 'auto' ? vscodeDark() : PALETTES[current].dark);

/** Applies a theme to the page (sets the variables on <body>, which wins over VS Code's on <html>). */
export function applyTheme(theme: EditorTheme): void {
  current = THEME_IDS.includes(theme) ? theme : 'auto';
  const style = document.body.style;
  for (const name of [...style]) if (name.startsWith('--vscode-') || name === '--md-chrome-background') style.removeProperty(name);
  if (current !== 'auto') {
    const p = PALETTES[current];
    for (const [k, v] of Object.entries(variables(p))) style.setProperty(`--vscode-${k}`, v);
    style.setProperty('--md-chrome-background', p.chrome);
    style.colorScheme = p.dark ? 'dark' : 'light';
  } else style.colorScheme = '';
  // VS Code sets color-scheme on <html>, which also colors the scroll bars of the page.
  document.documentElement.style.colorScheme = style.colorScheme;
  document.body.dataset.mdTheme = current;
  document.body.classList.toggle('md-dark', isDarkTheme());
}
