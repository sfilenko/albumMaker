---
description: What the project does in the model code area. One row per delivered requirement, with its verdict.
area: model
paths: ["src/model/**"]
last_verified: 1e74b0faf1dea7baf2efdbc681af656fc948a2e4
---

| Id | Capability | Delivered by | Req | Evidence |
|---|---|---|---|---|
| C-2 | 600×300 mm trim spread of two 300×300 mm pages, fold at 300 mm | `feat-album-builder` | R-2 | phase-1 `pass` |
| C-3 | A new album has 1 cover and 15 spreads on the full-spread template | `feat-album-builder` | R-3 | phase-1 `pass` |
| C-16 | Gap, margin and background settings | `feat-album-builder` | R-16 | phase-1 `pass`, phase-6 `pass` |
| C-17 | Two templates use their own 35 mm margin | `feat-album-builder` | R-17 | phase-1 `pass`, phase-6 `pass` |
| C-30 | Setting "Початок книги" with two values | `feat-album-builder` | R-30 | phase-1 `pass`, phase-6 `pass` |
| C-37 | Print warnings before export | `feat-album-builder` | R-37 | phase-1 `pass`, phase-7 `pass` |
| C-45 | A photo can be smaller than its cell, with the album background around it | `feat-photo-zoom-out` | R-1 | phase-1 `pass` · probe `all.json` `pass` |
| C-46 | Zoom inside a cell from half of the whole-photo size to 8× | `feat-photo-zoom-out` | R-2 | phase-1 `pass` · probe `all.json` `pass` |
| C-48 | A zoomed-out photo moves on its free axis and stays fully inside the cell | `feat-photo-zoom-out` | R-4 | phase-1 `pass` · probe `all.json` `pass` |
| C-49 | On an axis where the photo is larger than the cell, the photo always covers the cell | `feat-photo-zoom-out` | R-5 | phase-1 `pass` · probe `all.json` `pass` |
| C-52 | The dpi warning uses the printed size of the photo | `feat-photo-zoom-out` | R-8 | phase-1 `pass` · probe `all.json` `pass` |
