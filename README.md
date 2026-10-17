# Swara Studio

Hear, name and sing musical notes, with Indian swaras (Sa Re Ga) and Western notes (C D E, do re mi) side by side. A phone-first, installable web app built around spaced repetition and live pitch feedback.

## Use it

Open the GitHub Pages address in Chrome on Android and tap **Install app** (or menu → Add to Home screen). It works offline and listens to you sing.

## Develop

| Command | What it does |
|---|---|
| `npm test` | Unit tests: the spaced-repetition scheduler (`assets/srs.js`) and the pitch engine (`assets/swara.js`) |
| `npm run test:e2e` | Builds `dist/` and drives it in Chrome with a synthetic singer as the microphone |
| `npm run build` | Builds the installable copy into `dist/` |

Every push to `main` runs both test suites in GitHub Actions and deploys to GitHub Pages only if they pass.

New behaviour is test-first: add a failing test in `tests/`, then change the code.

## Layout

- `index.html`: the app (Today, Sing, Ear, Progress, Learn). Written without a document skeleton so the same file also publishes as a Claude artifact; `build.py` adds the skeleton, manifest and offline worker.
- `assets/srs.js`: pure scheduling rules (boxes, intervals, unlocks, streaks, device merge, backups).
- `assets/swara.js`: note naming, YIN pitch detection, drone and tones.
- `lessons/`, `reference/`: course pages.
- `pwa/`: manifest and service worker.
