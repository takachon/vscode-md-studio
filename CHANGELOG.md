# Changelog

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
