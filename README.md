# GCS Mobile

A phone-friendly viewer for [GURPS Character Sheet (GCS)](https://gurpscharactersheet.com/) character files, with session tracking for HP, FP, item uses and quantities. It installs to the home screen on iPhone and Android and works offline.

Live app: https://patricio-gutierrez-diaz.github.io/gcs-mobile/

## Using it

1. Open the live app on your phone (Safari on iPhone, Chrome on Android) and add it to the home screen.
2. Tap **Load character file** and pick a `.gcs` file from Files or Google Drive.
3. Track HP and FP from the header, and item charges or quantities on the Gear screen. Tap any tracked number to type an amount (for example, add 100 gold or take 7 damage). Changes save on the phone.
4. Read, edit and add notes on the Notes screen; they are saved into the character file.
5. **More → Export .gcs file** gives back the file with the tracked changes, ready to open in GCS.

Google Drive saving is the next step (see the setup guide in the project).

## How it is built

- Plain JavaScript modules, no build step and no dependencies. The site is the `app/` folder.
- `app/src/gcs.js` reads GCS v5 files. Containers are found from the file itself (an upper-case id prefix marks a container), so any container names and nesting work.
- Tracking changes only `attributes[].damage`, `uses` and `quantity` (plus the matching cached `calc` numbers), and notes change only `notes[].markdown` and the notes list, so files stay valid for GCS.
- `app/sw.js` caches the app for offline use.
- Every push to `main` publishes `app/` through `.github/workflows/pages.yml`.

## Checking the file reader

Put `.gcs` files in `samples/` (ignored by git, so player data never lands in this public repo) and run:

```sh
node scripts/inspect.mjs samples/*.gcs
```

It prints how each character's traits, skills, spells, gear and notes are grouped, and confirms that reading and saving leaves the file unchanged.

To try the app locally, serve the `app/` folder with any static server, for example `python3 -m http.server -d app 8080`.
