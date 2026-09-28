# Changelog

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
