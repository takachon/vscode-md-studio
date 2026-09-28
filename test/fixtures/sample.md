---
title: Sample
---

# MD Studio sample

* bullet with star
* another   item

1) first
2) second

Paragraph with **bold**, _emphasis_ and `code`.  
Hard break above. Link to [section 3.7](#37-mermaid-with-frontmatter) and [Japanese](#日本語の見出し).

|Name|Value|
|:-|-:|
|alpha|1|
|beta|22|

![red](images/red.png)
![blue](images/blue%20dot.png)
<img src="images/red.png" width="8">

## 3.7 Mermaid with frontmatter

```mermaid
---
config:
  theme: forest
  look: classic
---
flowchart LR
  A[Start] --> B{Check}
  B -->|yes| C[Done]
```

## Mermaid default

```mermaid
flowchart TD
  X --> Y --> Z
  subgraph S [Group]
    Y
  end
```

## 日本語の見出し

```js
const x = 1; // highlighted
```

## Duplicate
## Duplicate

Term with trailing spaces   
Last line without newline