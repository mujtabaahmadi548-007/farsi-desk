# Farsi Desk — میز کار مترجم

A Persian↔English translation and transcription workstation for a freelance translator.
It runs entirely in your browser: there is no server, no account and no API key, and your
texts, recordings, translation memory and glossary never leave your computer.

## Run it on your computer

You need [Node.js](https://nodejs.org) version 22.12 or newer (version 24 is recommended).

1. Open a terminal in this folder.
2. Install the parts it needs (only the first time):

   ```bash
   npm install
   ```

3. Start it:

   ```bash
   npm run dev
   ```

4. Open the address it prints (normally http://localhost:5173) in Chrome or Edge.

The first time you open it, a small sample project is created so you can try everything.

Other commands:

| Command | What it does |
| --- | --- |
| `npm test` | runs the automated tests |
| `npm run build` | checks the code and builds the finished site into the `dist` folder |
| `npm run preview` | serves the built site at http://localhost:4173 to check it before publishing |

## Put it online with GitHub Pages

This is free and takes about five minutes. The repository already contains the workflow that
builds and publishes the site (`.github/workflows/deploy.yml`).

1. Create a new, empty repository on GitHub (any name, for example `farsi-desk`).
2. In a terminal in this folder, send the code to it (replace `YOUR-NAME` and `YOUR-REPO`):

   ```bash
   git remote add origin https://github.com/YOUR-NAME/YOUR-REPO.git
   ```

   ```bash
   git push -u origin main
   ```

3. On GitHub, open the repository → **Settings** → **Pages** → under **Build and deployment**,
   set **Source** to **GitHub Actions**.
4. Open the **Actions** tab. The run called “Deploy to GitHub Pages” starts by itself (if it
   started before step 3 and failed, click **Re-run all jobs**). Wait until it is green.
5. Your site is at `https://YOUR-NAME.github.io/YOUR-REPO/`.

Every later `git push` to `main` publishes the new version automatically. Nothing has to be
configured for the repository name: the build uses relative addresses.

Your data is stored per browser and per address. What you entered at `localhost` does not
appear on the GitHub Pages address: use **Settings & backup → Download backup** on one and
**Restore from backup** on the other to move it.

## What is in it

1. **Projects and dashboard** — client, direction (FA→EN / EN→FA), deadline (also shown in the
   Persian calendar), rate per word or per minute; active projects, deadlines and words
   translated this month.
2. **Segment editor** — import `.txt`, `.docx`, `.srt`/`.vtt` or paste text; Persian-aware
   sentence splitting; two columns with the correct direction in every cell; `Ctrl+Enter`
   confirms and moves on; a status for every segment; search, filters, merge, delete.
3. **Persian normalizer** — Arabic ي/ك → ی/ک (and letters copied from PDFs), digits per project,
   half-space (ZWNJ) around می، نمی، ها، تر، ترین، ای, kashida, stray spaces — always with a
   word-by-word preview that you approve.
4. **Translation memory** — confirmed segments are shared across projects; fuzzy matches with a
   percentage and highlighted differences; TMX import and export; pre-translation on import.
5. **Glossary** — terms highlighted in the current segment and inserted with one click; CSV
   import and export.
6. **QA checks** — numbers (۱۲ = 12), unused glossary terms, empty segments, double spaces,
   brackets and quotes, source copied unchanged, subtitle timing; click an issue to open it.
7. **Transcription** — audio or video with a waveform, timestamped segments that play when
   clicked, keyboard shortcuts, export to SRT, VTT and TXT.
8. **Automatic transcription** — Whisper in the browser (WebGPU, or WebAssembly as a fallback)
   for Persian and English, with the download size and progress shown.
9. **Delivery** — `.docx` with right-to-left paragraphs, bilingual two-column `.docx`, `.txt`,
   subtitles; word and minute counts; an invoice you can print or save as PDF.

Everything is saved in the browser (IndexedDB). **Settings & backup** writes all of it to one
JSON file and restores it.

## Keyboard shortcuts

Shortcuts with a letter use the physical key, so they also work with a Persian keyboard layout.

| Where | Keys | Action |
| --- | --- | --- |
| Editor | `Ctrl+Enter` | confirm the segment and go to the next one |
| Editor | `Alt+↓` / `Alt+↑` | next / previous segment |
| Editor | `Alt+S` | copy the source into the target |
| Editor | `Alt+1` … `Alt+5` | use a translation memory match |
| Transcribe | `Esc` or `Ctrl+Space` or `Alt+P` | play / pause |
| Transcribe | `F1` or `Alt+B` | rewind 3 seconds |
| Transcribe | `F3` or `Alt+N` | forward 3 seconds |
| Transcribe | `F2` or `Alt+R` | 0.75× speed on / off |
| Transcribe | `Ctrl+J` or `Alt+J` | insert timestamp (new segment at the playhead) |

## Ten-step test

1. **Dashboard.** Open the app. The sample project “Sample — City library notice” is listed
   with a deadline in 7 days, and “Words translated” is not zero.
2. **Editor.** Open the sample. Persian is on the left, right-aligned; English on the right.
   Click segment 4, type a translation, press `Ctrl+Enter`: it turns “Confirmed ✓” and the
   cursor is in segment 5.
3. **Glossary.** In segment 5 the words «نرم افزار» and «تلفن همراه» are highlighted. Click
   “software” in the Glossary box on the right: it is inserted where the cursor is.
4. **Translation memory.** Click segment 6. The box on the right shows a match of about 75%
   with the changed words marked. Press `Alt+1` to use it, then `Ctrl+Enter`.
5. **Normalize.** Open the Normalize tab. Every segment is listed with what would change
   (ي→ی, «مي تواند»→«می‌تواند», 1402→۱۴۰۲ …). Press “Apply”; the list becomes “Nothing to
   normalize”.
6. **QA.** Open the QA tab. It reports the wrong number in segment 3 (20 / 22), the unclosed
   quotation mark in segment 5, the number in segment 6 (the memory match said 3 books, the
   source says 5), the double space in segment 7, and in segment 8 the copied source and the
   unused glossary term «وب‌سایت». Click one: the editor opens on that segment.
7. **Deliver.** Open the Deliver tab. Download the Word document and the bilingual document
   and open them in Word: Persian cells are right-to-left. Scroll down to the invoice (after
   step 5 it reads 87 words × 0.08 USD = 6.96 USD) and press “Print / save as PDF”.
8. **Import.** Dashboard → New project → create one → “Import or paste text…”. Paste a few
   Persian sentences ending in . ؟ ! and check the number of segments in the preview; or
   choose a `.docx` or `.srt` file.
9. **Transcribe.** In any project open the Transcribe tab → “Load sample recording”. Press
   Play, press `Ctrl+J` at the start of each sentence and type. Click “▶ Play” on a segment.
   Try `F1`, `F2`, `Esc`. Export SRT. Then try “Transcribe automatically” with the Tiny model.
10. **Backup.** Settings & backup → “Download backup”. Then “Delete all data…”, and
    “Restore from backup…” with the file you just saved → “Replace everything”. Everything is
    back.

## Decisions made while building

- **Preact** is the UI framework (small and fast); `idb` for IndexedDB; `fflate` for zip.
  `.docx` reading and writing is written by hand, so the right-to-left markup is under control.
- **Sentence splitting** does not cut at the Persian comma «،» by default, because that would
  break sentences into fragments. Choose “By clause” in the import window if you want that.
- **The normalizer is cautious.** «میروم» is split only when the rest is a known verb form, so
  «میدان», «میوه», «میز» are never touched; «میدانی» is left alone because it is usually the
  adjective. No half-space is written after letters that do not join anyway («کار ها» →
  «کارها»). Latin digits that belong to an English name («Windows 11», «COVID-19») stay Latin.
- **One translation memory and one glossary** are shared by all projects, in both directions.
- **Each confirmed segment owns one memory entry**: confirming it again updates that entry.
- **Fuzzy scores** compare words, not characters; a 99% match differs only in things like
  ي/ی, digit script or half-space versus space.
- **A transcript is the source text of the project**, so you can translate it in the editor and
  export translated subtitles.
- **“Insert timestamp”** starts a new segment at the playhead and closes the previous one there.
- **Untranslated segments** are exported with their source text unless you untick the option.
- **Invoice numbers** look like `2026-001` and advance when you print.
- **Media files** are stored in the browser with the project. They go into the backup file only
  if you tick “Include audio/video files”.
- **Vazirmatn** (SIL Open Font License) is bundled for Persian text; English uses the system font.

## Known limitations

- **Automatic transcription needs the internet the first time** (39–559 MB for the model, plus
  about 27 MB for the engine, from huggingface.co and cdn.jsdelivr.net). After that it works
  from the browser cache. On computers without WebGPU it is slow (about as long as the
  recording, or longer). The Tiny and Base models make many mistakes in Persian; Small is
  better but large. Always proofread.
- **Very long recordings** (over an hour) need a lot of memory to draw the waveform and to
  transcribe automatically. Files over 300 MB are not decoded until you ask. Playback and
  manual transcription are not affected.
- **`.docx` import reads the text only**: no formatting, images, footnotes, headers or
  comments. Exported documents are plain paragraphs. Old `.doc` files must be saved as `.docx`.
- **No manual “split segment” command.** You can merge segments, edit the source, or re-import
  with another splitting mode.
- **The normalizer covers the listed cases only.** It does not add half-spaces inside compound
  words («دانش آموز», «نرم افزار»), and it can be wrong for rare words — which is why it shows
  a preview first.
- **Glossary matching** knows common Persian endings (ها، های، ان، ی) and English plural -s;
  other inflected forms are not recognised.
- **QA cannot see numbers written as words**, and it reports a year converted between
  calendars (1402 → 2023) as a number difference.
- **Data lives in one browser.** Clearing the browser's site data deletes it. Download a backup
  regularly.
- **The built site contains a 27 MB engine file** in `dist/assets` that browsers normally do not
  download; it only makes the upload to GitHub a little slower.
- Tested in Chrome/Edge on Windows. Firefox and Safari should work for everything except
  WebGPU; they were not tested.

## How it was checked

- 219 automated tests (`npm test`) for the normalizer, sentence splitter, fuzzy matcher, QA
  checks, SRT/VTT, TMX, CSV, `.docx`, counts and invoice totals, using real Persian text with
  half-spaces and mixed English.
- Exported `.docx` files were opened in Microsoft Word and LibreOffice to confirm the
  right-to-left paragraphs and the bilingual table.
- Whisper was run for real on the sample recording, on both WebAssembly and WebGPU.
