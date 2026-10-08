# Changelog

## 0.4.1

- The popover of a code block (move up / down, delete, language) no longer covers the code when the editor is zoomed (Ctrl+wheel). It sits right above the block at any zoom and follows the block when the zoom changes.

## 0.4.0

- Read-only mode: the lock button on the toolbar (or **MD Studio: Toggle Read-Only Mode**) locks the document; it can still be read, searched, copied and exported. `mdStudio.editor.readOnly` opens files read-only. Files on a read-only file system (e.g. the old side of a Git diff) are always read-only.
- ` ```jsonc ` and ` ```json5 ` code blocks are highlighted as JSON with comments.
- Comments in code blocks are green (editor and exports).
- Scroll bars follow the editor theme (they kept VS Code's colors, e.g. dark bars on the Light theme).

## 0.3.0

- Math and more diagram kinds, drawn the same way in the editor and in HTML / PDF exports (static SVG, no scripts): KaTeX math (`$…$`, `$$…$$`, ` ```math `), Graphviz, flowchart.js, ECharts (options parsed as data, never evaluated), mind maps from lists, markmap, ABC notation and SMILES. All libraries are bundled.
- PlantUML through a server of your choice (`mdStudio.plantuml.server`); exports fetch and embed the SVG.
- Saving after editing one table row (or one line of any block the editor re-spaces) changes only that row. Other rows keep their own padding and spacing (the editor used to rewrite the whole table, e.g. adding a space between Japanese text and `code`).
- Images: an enlarge button appears in the top-right corner on hover (like diagrams); clicking an image no longer opens the viewer. The viewer keeps the aspect ratio when zoomed beyond 100 % (VS Code's default webview style capped the height).

## 0.2.3

- Editor themes: Follow VS Code, Light, Warm Paper, Sepia, Dark and Midnight (`mdStudio.editor.theme`). The toolbar's Editor Theme button opens a list that previews each theme as you move through it. The toolbar and outline get a slightly different color from the page, so the editing area stands out.

## 0.2.2

- PDF export works where Edge refuses remote debugging (company policy): printing uses the browser's `--print-to-pdf` first and falls back to the DevTools protocol. Paper, margins, page numbers and header are CSS `@page` rules, so both give the same pages. A failure now explains what to check (`edge://policy`).
- If no browser may print in the background (e.g. `HeadlessModeEnabled` policy), every installed browser is tried, the blocking policies are read from the registry and shown, and the print-ready page is opened in Edge with the print dialog (Save as PDF).
- Export font: same as the editor (VS Code `markdown.preview.fontFamily`), Yu Gothic, Meiryo, BIZ UDPGothic, Yu Mincho, BIZ UDPMincho or any font names; PDF text size. Diagrams are drawn with the export font.
- Japanese documents are exported with `lang="ja"` and Japanese fallback fonts (also for code), so Japanese text never falls back to a Chinese font.

## 0.2.0

- Word-like editing by default (formatting only, no Markdown symbols). Ctrl+B / Ctrl+I etc. no longer reach VS Code (Ctrl+B does not toggle the side bar).
- Toolbar with VS Code icons, laid out like Office Viewer. The outline highlights the section being read.
- Ctrl+wheel zoom (remembered), click an image to view it large, enlarge button on diagrams.
- Right-click an image to change its display size (stored as `<img width>`); inline `<img>` in paragraphs and tables is drawn as an image.
- Export panel: HTML (embed / link / copy images, contents at the top or in a sidebar, light / dark / auto theme) and PDF (contents page with page numbers, bookmarks, page numbers, paper, margins). Save as default.
- In-house updates from a shared folder or intranet URL (`mdStudio.update.source`), command "Check for Updates".
- Fonts follow VS Code (`markdown.preview.*`, `editor.*`).

## 0.1.0

- First version: WYSIWYG editor (Vditor), bundled Mermaid 12, single-file HTML export, offline.
