# Album builder

Album builder is a web app that lays out a 30×30 cm Lay Flat photo album. It runs in a browser on a computer or a phone. It exports print-ready JPG files for Gramofon. The interface is in Ukrainian.

The app has no server. Your photos stay on your device. The app keeps the album and small screen copies of the photos in the browser storage (IndexedDB). The original photo files stay on the disk. The export reads them again when it needs them.

## What you can do

- Make an album of 15 spreads and about 60 photos from 12 templates.
- Move photos into cells with a drag, or with a tap on a phone. Crop a photo in its cell.
- Move the borders between cells. Change the gap, the margin, the background, the bleed and the safe zone.
- Save the layout to a `.album.json` file, and open it on a different device. The file holds the layout and the photo descriptions, not the photos. On the other device, add the photos again. The app finds each photo by its name, file size, pixel size and capture date.
- Export full spreads and single pages as JPG files at 300 dpi.

## Keep your work safe

The browser storage is not a backup. A browser can delete it, for example when the disk is full or when you clear the site data. Save the layout to a file regularly.

- A banner shows when the browser cannot store a change. Use "Зберегти у файл" at once.
- A banner shows when the album changed and the last file save is more than 3 days old.
- On iPhone, add the app to the Home Screen. Safari can delete the storage of a site that is not on the Home Screen after some days without use.

## Run it on your computer

You need Node.js 24.

```sh
npm ci
npm run dev
```

Open the address that the dev server shows, usually `http://localhost:5173/`.

Other commands:

| Command | What it does |
|---|---|
| `npm run build` | Checks the types and builds the production files into `dist/` |
| `npm run preview` | Serves `dist/` as production serves it |
| `npm run typecheck` | Checks the types |
| `npm test` | Runs the unit tests (Vitest) |
| `npm run e2e` | Runs the browser tests (Playwright, desktop Chromium and iPhone WebKit) |
| `npm run fixtures` | Makes the test photos in `tests/fixtures` again |

Before the first `npm run e2e`, install the browsers with `npx playwright install chromium webkit`.

## Install it as an app

The production build is an installable web app (PWA). After one visit, it opens without a network.

- On a computer in Chrome or Edge, use the install icon in the address bar.
- On iPhone in Safari, use "Поділитися" → "На Початковий екран".

The development server has no service worker. Use the production build to test the offline mode.

## Deploy it to GitHub Pages

The workflow `.github/workflows/pages.yml` publishes the app on each push to `main`. It installs the packages, runs the unit tests, builds the app and deploys `dist/`.

1. Push the repository to GitHub.
2. In the repository settings, open **Pages**. Set **Source** to **GitHub Actions**.
3. Push to `main`, or start the workflow by hand from the **Actions** tab.

The app is then at `https://<owner>.github.io/<repository>/`. The workflow sets `BASE_PATH` to `/<repository>/`, so the app finds its files under that path.

Keep this address. The browser keeps each album for one address only. If the address changes, the albums do not move to the new address. Save each album to a file before you change the repository name or the owner.

## Notes for Gramofon

Gramofon does not publish its file requirements. The default print values come from other photo-book services:

- Bleed: 3 mm on each outer edge.
- Safe zone: 10 mm from the trim edge. Keep faces and text inside it.
- Resolution: 300 dpi. A cell under 200 dpi gets a warning.
- Colour: sRGB JPG.
- Pages: Gramofon needs at least 24 printed pages.

Each of these values is a setting. Before the first print, check with Gramofon:

- Is page 1 the left half of the first spread, or a single right page? Set "Початок книги" to match.
- Does Gramofon crop a page with bleed (3614×3614 px) to the trim size, or does it shrink the image? If it shrinks it, set "Сторінки для експорту" to "Без вильоту" (3543×3543 px).

The export does not include the cover. Gramofon covers have different dimensions because of the spine.
