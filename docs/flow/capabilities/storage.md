---
description: What the project does in the storage code area. One row per delivered requirement, with its verdict.
area: storage
paths: ["src/storage/**"]
last_verified: 71bad5265dc7caecca0486cac3a1e4843bea4e96
---

| Id | Capability | Delivered by | Req | Evidence |
|---|---|---|---|---|
| C-24 | Undo and redo, with one drag as one step | `feat-album-builder` | R-24 | phase-2 `pass` |
| C-25 | Autosave with no save button, also on a tab close | `feat-album-builder` | R-25 | phase-2 `pass` |
| C-26 | Save and open a `.album.json` layout file | `feat-album-builder` | R-26 | phase-2 `pass` |
| C-55 | An archive is one standard ZIP named `<album name>.album.zip` | `feat-album-archive` | R-2 | phase-1 `pass` · probe `all.json` `pass_with_deviation` · a real ZIP tool and Safari on a Mac not tested (AC-3.35, manual, not run) |
| C-56 | An archive holds the layout: spreads, cells, crops and album settings | `feat-album-archive` | R-3 | phase-1 `pass` · probe `all.json` `pass_with_deviation` |
| C-57 | An archive holds the byte-identical original of each used photo, and no other photo | `feat-album-archive` | R-4 | phase-1 `pass` · probe `all.json` `pass_with_deviation` |
