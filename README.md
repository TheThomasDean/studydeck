# StudyDeck: Offline Flashcard Study App

A desktop study app modeled on Quizlet. Build flashcard sets by hand or import them from Excel, then study with seven modes: Learn, Flashcards, Test, Match, Charms, Lock and Deep Dive. Everything runs offline, and your sets are stored as plain JSON on your own computer.

**Contents:** [Overview](#overview) · [Download and install (macOS)](#download-and-install-macos) · [Commands](#commands) · [Excel import](#excel-import) · [Study modes](#study-modes) · [Project layout](#project-layout) · [Assumptions](#assumptions-and-choices) · [Roadmap](#roadmap)

## Overview

| | |
|---|---|
| **Stack** | Electron, Vite, React, TypeScript |
| **Spreadsheets** | SheetJS (`xlsx`): import .xlsx, .xls, .csv, .tsv; export .xlsx, .csv |
| **Storage** | Atomic JSON files in the app's `userData` folder, no database and no native modules |
| **Platforms** | macOS (Apple Silicon and Intel), Windows, Linux |
| **Tests** | Vitest, 47 unit tests on import parsing, grading, test generation and the game engines |
| **Network** | None at runtime |

## Download and install (macOS)

Grab the `.dmg` from the [Releases](../../releases) page: `arm64` for Macs with an M1, M2, M3 or M4 chip, `x64` for Intel Macs. Ignore the `.blockmap` files.

1. Open the `.dmg` and drag **StudyDeck** onto **Applications**.
2. The app is not signed with a paid Apple certificate, so macOS may warn the first time. Open **System Settings → Privacy & Security**, scroll down and click **Open Anyway**.
3. If macOS says the app is "damaged", open Terminal and run `xattr -cr /Applications/StudyDeck.app`, then open it again.

Updating by replacing the app keeps your study sets, because they live outside the app.

## Requirements (to build from source)

- Node.js 20 or newer (22 LTS recommended) and npm.
- To build a macOS installer you must run the build on a Mac; to build a Windows installer, run it on Windows (or on a Mac/Linux machine with Wine).

## Commands

```bash
npm install          # install dependencies (downloads Electron, ~100 MB)
npm run dev          # run in development with hot reload
npm test             # unit tests (Vitest): import parsing, test generation, grading, games
npm run build        # type-check + production bundles in out/
npm start            # run the production bundles without packaging
npm run dist         # build an installer for the current OS into release/
npm run dist:win     # Windows NSIS installer  -> release/StudyDeck-Setup-1.0.0.exe
npm run dist:mac     # macOS DMG (x64 + arm64) -> release/StudyDeck-1.0.0-<arch>.dmg
```

Unsigned builds: Windows SmartScreen will say "unknown publisher" (More info → Run anyway); on macOS right-click the app → Open the first time. Add your own icons by placing `build/icon.ico` (Windows) and `build/icon.icns` (macOS); without them electron-builder uses the default Electron icon.

## Where data lives

Everything is stored as JSON in Electron's `userData` folder:

- Windows: `%APPDATA%\StudyDeck\data\`
- macOS: `~/Library/Application Support/StudyDeck/data/`

`settings.json` holds the theme and sound preference; `sets/<id>.json` holds one study set (cards, per-card progress, test scores, best Match time, Charms and Lock high scores). Every write goes to a temporary file that is flushed and then renamed over the target, so a crash can never leave a half-written file. A sample set, **Spanish Basics** (12 cards), is created on first launch.

## Excel import

Open it with **Import from Excel** on the home screen, or drag a file anywhere onto the window.

**Expected layout:** column A = term, column B = definition, one card per row. A header row (for example `Term | Definition`) is optional. Any further columns are kept on each card as extra information and are exported again.

| A (Term)  | B (Definition) | C (optional extra) |
|-----------|----------------|--------------------|
| hola      | hello          | ¡Hola, María!      |
| gracias   | thank you      |                    |

`sample/spanish-basics.csv` is a ready-made example (it includes a quoted comma and a cell with a line break).

Supported inputs: `.xlsx`, `.xlsm`, `.xls`, `.csv`, `.tsv` (and `.txt`), plus a **paste box** that accepts cells copied straight out of Excel (tab-separated).

The wizard:

1. **Choose file** – file picker, drag-and-drop, or paste.
2. **Sheet** – shown only when the workbook has several sheets with data.
3. **Preview & columns** – the first 10 rows, with drop-downs for the Term and Definition columns (default A and B) and a "First row is a header" box that is auto-detected (common header words such as Term, Definition, Word, Meaning, Front, Back, Question, Answer…) and can be overridden.
4. **Review** – how many cards will be created, and a list of problem rows (empty term, empty definition, duplicate term) with options to skip or keep them. By default empty rows are skipped and duplicates are kept.
5. **Name** – defaults to the file name; create the set.

Details: CSV is parsed with an RFC 4180 parser (quoted commas, doubled quotes, line breaks inside quotes); the delimiter (comma, semicolon or tab) is auto-detected. Text is decoded as UTF-8 (with or without BOM) or UTF-16, falling back to Windows-1252. Numbers become text exactly as Excel displays them. Parsing runs in a Web Worker so 5,000+ row files don't freeze the window (a 6,000-row workbook parses in well under a second), and the editor pages long sets 100 cards at a time. A damaged, password-protected or wrong-format file shows a readable message instead of crashing.

**Export:** the set page has *Export .xlsx* and *Export .csv*. Files have a `Term, Definition, …extra columns` header and re-import cleanly (round-trip is covered by tests). CSV is written with a UTF-8 BOM so Excel shows accents correctly.

## Study modes

- **Learn** – guided multiple-choice rounds of about 7 cards with instant feedback. Correct answers turn green and move on after a second (or press Enter). Wrong answers show the right term/definition pair and wait for **Continue**, with an **I was right** override. Each card goes *unseen → familiar* (first correct answer) → *mastered* (correct again in a **later** round). Missed cards come back two questions later in the same round, and missed or familiar cards are picked first for the next round. After each round you see what you got right and what you missed; when everything is mastered you can restart or study just the cards you missed. Options: answer with term or definition, shuffle, type the answer once a card is familiar, restart progress. Progress is saved with the set, so you can leave and pick up where you were.
- **Flashcards** – one big card; click or Space flips it with a 3D animation, ← → move. Shuffle, restart, star the card (or press S), "starred only" filter, term-first / definition-first, and text-to-speech. Turn on **Know it / Still learning** to sort cards with → / ← or by swiping the card; at the end you get a summary and can repeat just the still-learning pile.
- **Test** – choose the number of questions, question types (multiple choice, true/false, written, matching), answer with term / definition / both, and starred-only. A fresh randomized test each time; you answer everything, then see your percentage, each question with your answer vs. the right one, an **I was right** override for written answers, and **Retake only missed questions**. Keys: 1–4 choose, Enter continues, ← → move between questions.
- **Match** – 12 tiles (6 terms + 6 definitions). Click two tiles: a correct pair pops away, a wrong pair shakes and adds 1 second. Beat your best time.
- **Charms** – an 8×8 match-3 board with six colours, each with its own shape (circle, square, triangle, diamond, star, hexagon) so it is colour-blind friendly. Swap neighbours by clicking or dragging (arrow keys + Enter also work); only swaps that make a match are allowed. You start with 20 moves. Cascades multiply points. Special charms: **Question** (?) asks a multiple-choice question from your set and grants the 1–3 moves printed on it if you answer correctly; **Bomb** (made by matching 4+) clears a 3×3 area when matched or swapped; **Stone** can't be moved and only a bomb breaks it (+100); **Poison** (☠) costs a move when matched. The board reshuffles itself if no move is possible. The end screen shows score, high score, questions right, missed terms, *Play again* and *Study missed terms*.
- **Lock** – escape the vault: each lock shows a definition (or term) and you type the answer, graded leniently. A right answer spins the dial and opens the lock; a wrong one jams it and costs 5 seconds (shown as a striped penalty segment on the countdown bar). After two wrong answers on a lock, its first letter is revealed. Points: 100 per lock + up to 50 for speed + 25 if no hint, plus 5 points per second left when you escape. Difficulties: Easy (5 locks, 120 s), Normal (5 locks, 90 s), Hard (7 locks, 90 s).

- **Deep Dive** – a fishing game. A term hangs from your boat's line and 3–4 fish swim across the lake, each carrying a definition. Click/tap the right fish (or press its number) to reel it in; a wrong fish snaps the line, costs 3 seconds and the right fish lights up. Runs last 75 seconds. Cards you've missed (in any mode) come up more often and appear as glowing **rare fish** worth 250 points instead of 100 — rarity follows each fish's own card, so a glowing fish isn't automatically the answer. Every 5 in a row gives +150 and slows the fish for 6 seconds. The end-of-run aquarium shows known cards as small calm fish and missed ones as big thrashing fish, plus your score, best streak and a button to study the missed terms in Learn. Tuning constants are at the top of `src/lib/deepDive.ts`.

Every mode updates per-card progress (times seen, times correct, mastery). Mastery rules: a wrong answer → *learning*; 2 right in a row → *familiar*; 4 right in a row → *mastered*; just viewing a new flashcard → *learning*.

## Project layout

```
studydeck/
├─ package.json, electron.vite.config.ts, electron-builder.yml, vitest.config.ts, tsconfig*.json
├─ sample/spanish-basics.csv
├─ src/
│  ├─ shared/types.ts            data model + typed IPC contract
│  ├─ main/index.ts              window, dialogs, IPC handlers
│  ├─ main/storage.ts            atomic JSON storage in userData
│  ├─ preload/index.ts           contextBridge API (window.studydeck)
│  ├─ lib/                       pure, testable study logic (no DOM, no Electron)
│  │  ├─ importParse.ts          CSV/TSV/XLSX/XLS parsing, header detection, issue flags
│  │  ├─ exporter.ts             .xlsx / .csv export
│  │  ├─ testGen.ts              test generation and grading
│  │  ├─ grading.ts              lenient answer matching, hints
│  │  ├─ progress.ts             mastery, scores, history
│  │  ├─ random.ts               shuffle / sample / seeded RNG
│  │  ├─ sets.ts                 set & card factories, sample set
│  │  ├─ match.ts, lock.ts       game rules
│  │  ├─ learn.ts                Learn rounds, mastery, distractor rotation
│  │  ├─ deepDive.ts             Deep Dive weighting, waves, scoring
│  │  ├─ charms.ts               match-3 engine (matches, bombs, gravity, reshuffle)
│  │  └─ __tests__/              Vitest suites
│  └─ renderer/
│     ├─ index.html
│     └─ src/
│        ├─ App.tsx, main.tsx, store.tsx, routes.ts, hooks.ts, sound.ts, styles.css
│        ├─ importWorker.ts, parseAsync.ts, exportActions.ts
│        ├─ components/          Library, SetPage, Editor, ImportWizard, TopBar, MasteryBar, ConfirmDialog, ErrorBoundary
│        └─ modes/               LearnMode, Flashcards, TestMode, MatchMode, CharmsMode, LockMode, DeepDiveMode, StudyRouter, common
```

Security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, a strict Content-Security-Policy, navigation and new windows blocked, all permission requests denied.

## Feature checklist

- [x] Electron + Vite + React + TypeScript; SheetJS (`xlsx`) for spreadsheets; electron-builder packaging (NSIS for Windows, DMG for macOS)
- [x] Atomic JSON storage in userData, no native modules
- [x] Light and dark themes following the OS, with a manual toggle (system → light → dark)
- [x] Typed IPC through a preload script; contextIsolation on, nodeIntegration off
- [x] Study logic in pure modules under `src/lib`, with Vitest tests for import parsing, test generation and grading (plus games and export round-trip)
- [x] Data model: StudySet, Card with progress fields and mastery, per-set history (test scores, Match times, game high scores)
- [x] Library: grid with title, card count, last studied; search; sort by recent or name; delete with confirmation; New set; Import from Excel
- [x] Editor: title, description, term/definition table; add, delete, reorder (drag handle or ↑/↓), star; autosave; undo last delete
- [x] Import of .xlsx/.xls/.csv/.tsv via picker, drag-and-drop anywhere, and paste-from-Excel box
- [x] Wizard: sheet choice, 10-row preview, column choice (default A/B), auto-detected header with override, problem counts with skip/keep, set name defaulting to file name
- [x] Export to .xlsx and .csv (round-trips)
- [x] Unicode, quoted commas, line breaks in cells, numeric cells, 5,000+ rows without freezing
- [x] Flashcards: 3D flip (click/Space), ←/→, shuffle, restart, star, starred-only, flip direction, Know it / Still learning with keys or swipe and repeat pile, progress bar and counter, text-to-speech
- [x] Test: setup options, randomized generation, 4-option MC with unique distractors (fewer for tiny sets), true/false, lenient written with "I was right", click-to-pair matching (up to 6), answer-all-then-score, results review, retake missed, score history, 1–4 and Enter shortcuts
- [x] Match: 12 tiles, pop animation, shake + 1 s penalty, running timer, best time compare/save, play again, fewer pairs for small sets
- [x] Charms: 6+ card requirement message, 8×8 board with 6 colour+shape charms, click or drag swaps that must match, cascades with combo multiplier, 20 moves, Question / Bomb / Stone / Poison charms, guaranteed valid move with auto-reshuffle notice, question charm every 5th–7th spawn, HUD, end screen with high score, questions right, missed terms, Play again, Study missed terms
- [x] Lock: 5 locks, typed answers graded leniently, dial-spin animation, 5 s penalty bar + jam, first-letter hint after 2 misses, 90 s timer, points with speed and no-hint bonus, round summary with time, hints and missed terms, Easy / Normal / Hard
- [x] Progress in every mode; set page with mastery bar, test history, best Match time, mode tiles, Edit, Export
- [x] Learn: 4-option questions with rotating distractors, instant feedback, auto-advance, "I was right", rounds of 7, unseen/familiar/mastered, re-queued misses, round summaries, completion screen, options panel (answer side, shuffle, typed answers when familiar, restart), saved per set
- [x] Deep Dive: boat, line and swimming definition fish, click/tap/keys, reel-in and line-snap animations, 3 s penalty, weighted terms and rare fish for missed cards, streak bonus with slow-mo, 75 s runs, aquarium summary, study missed terms in Learn
- [x] Keyboard accessible with visible focus rings, reduced-motion support, minimum window 900×600, optional sound effects (off by default) with a mute toggle
- [x] Empty states and readable error messages; sample "Spanish Basics" set on first launch

## Assumptions and choices

- **Lenient grading** ignores case, surrounding and repeated whitespace, punctuation and also **accents** ("adios" matches "adiós"), since many keyboards can't type them easily. Apostrophes are dropped ("dont" = "don't"). If an answer lists alternatives separated by `;` or ` / `, any one of them is accepted.
- **Test question count** counts cards: each matching question tests up to 6 cards at once, so a 12-card test can be fewer than 12 screens. Score is per card (a matching question with 6 pairs is worth 6 points).
- **Retake only missed questions** builds a fresh test from the cards you got wrong, with the same options.
- **Answer with "Definition"** (the default) means you are shown the term and must produce the definition.
- **True/false** pairs the prompt with either its real answer or another card's answer (50/50).
- **Preview and column choice** are on one screen so the preview highlights the selected columns live.
- **Duplicate detection** is case-insensitive on the term; the first occurrence is never flagged.
- **Charms:** a swap that moves a Bomb is always allowed and detonates it ("activated"). Question charms trigger whether cleared by a match or a bomb. Stones fall with gravity like other charms. The starting board has 3 stones and 3 question charms; new spawns are ~4% poison and ~2% stone (max 4 stones on the board).
- **Learn levels vs. card mastery:** Learn's unseen/familiar/mastered is saved session progress (`set.learn`), separate from the per-card mastery shown on the set page; every Learn answer still updates that card mastery too. A familiar card answered wrong drops back to unseen. "Study missed cards" opens a temporary Learn session that doesn't overwrite the set's saved Learn progress; its distractors still come from the whole set. A one-card set uses typed answers because there are no other answers to choose from.
- **Deep Dive misses** are stored as `timesMissed` on each card (counted by every mode). A run is timed rather than a fixed number of catches, matching Match and Lock.
- **Lock:** the Lock setup also lets you choose whether to type the term (default), the definition, or a mix. Time taken is shown separately from the penalty seconds. A lock counts as "correct" for progress only if it was opened with no wrong answers.
- **Match progress:** a pair counts as correct unless one of its tiles was part of a wrong attempt.
- **Text-to-speech** uses the system default voice; StudyDeck does not guess the language of a card.
- **Blank new sets:** leaving the editor with no title and no card text discards the set; leaving with cards but no title names it "Untitled set". Cards missing a term or definition are kept in the set but excluded from study modes.
- **SheetJS version:** the `xlsx` package on npm is 0.18.5, the last version SheetJS published there. It works fully offline. If you prefer the newest build, SheetJS distributes it from their CDN: `npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` — no code changes are needed.

## Roadmap

- [x] Library, editor, Excel/CSV import wizard and export
- [x] Learn, Flashcards, Test, Match, Charms, Lock and Deep Dive modes
- [x] Light and dark themes, keyboard access, reduced-motion support
- [ ] Screenshots in `docs/img/`
- [ ] Signed and notarized macOS build
- [ ] Windows installer published on Releases
- [ ] App icon

## Author

Thomas Dean, Mechanical Engineering, Loyola Marymount University
