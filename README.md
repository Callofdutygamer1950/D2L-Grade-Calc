# Grade Calculator for D2L

A browser extension for Chrome and Firefox that shows your overall course grade in the middle of the **Grades** title row on D2L (Brightspace). The badge fades away as you scroll down.

Not affiliated with or endorsed by D2L Corporation. D2L and Brightspace are trademarks of D2L Corporation. Privacy policy: [PRIVACY.md](PRIVACY.md).

- **No weights set:** the badge says "Please input weights" instead of a grade. For courses graded by total points, **Use total points instead** shows points earned ÷ points possible on graded items (remembered per course, on this computer; undo it from the Breakdown).
- **Weights set:** shows the weighted grade. Each category's % (points earned ÷ possible) is multiplied by its weight.
- **Ungraded items** (`- / 50`) are skipped. Dropped or exempt items are skipped too.
- **Breakdown** lists each category's %, how many items are graded, and its weight. You can type weights right there: the grade updates as you type and saves automatically.
- **Set weights** opens a page where you can fill weights from a syllabus PDF or pasted text. This uses pattern matching only. Nothing is sent anywhere. It understands:
  - percentage breakdowns ("Quizzes … 20%", "40% for in-class quizzes")
  - points tables ("Category Points … Total 1,000"), turned into points ÷ total
  - inline points ("Final Exam (200 points)")

  Anything it had to guess or combine (e.g. Exams ← Midterm Exam + Final Exam) is marked "Check:" for you to look over before saving.
- **Courses without D2L categories** (every item at the top level): items are grouped by name with the trailing number removed, so HW01–HW05 → one "HW" row with one weight. **Edit groups** in the Breakdown opens the weights page, where you can move any item to another group or to an existing category, or reset to automatic.

Weights are saved per course in the browser's local extension storage.

## Sharing with classmates

Setups are shared through a Supabase database (`supabase/schema.sql`, project set in `extension/config.js`).

- **Upload:** when you change weights or groups, your setup for that class uploads automatically under an anonymous random install ID. Changing it again replaces your entry; clearing everything removes it.
- **Download:** for a class you haven't set up, the extension uses the setup the most students shared for that exact section. If nobody in that section has shared, it falls back to another section of the same course in the same term (from D2L's course code, e.g. `31427.202630` → term 202630). The badge says "Weights shared by N students" (plus "in another section" for the fallback). A shared setup follows whatever is most popular until you change anything, then it's yours.
- **Shared data:** category names, item names, groups and weights. Never grades, names or emails.
- **Opt out:** the switch at the bottom of the weights page turns sharing off in both directions, for all courses.
- **Database protection:** the public key can only call `submit_setup` and `get_shared_setup`. Both validate their input (D2L hosts only, weights 0–100 totalling ≤ 150, size limits, ≤ 40 courses per install). The table itself can't be read or written directly. Install IDs aren't logins, so someone determined could fake many "students".
- Supabase pauses free projects after about a week without activity; unpause it from the dashboard.

## Install in Chrome (or Edge)

1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `extension` folder.
4. Open or reload a D2L Grades page.

## Install in Firefox

Needs Firefox 140 or newer. Temporary install, removed when Firefox closes:

1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and pick `extension/manifest.json`.
3. If Firefox asks, allow the extension to run on desire2learn.com. You can also do this from the puzzle-piece menu → the extension → **Always allow on …**.

To keep it installed permanently in regular Firefox, it has to be signed by Mozilla through addons.mozilla.org (free). See [store/firefox-addons.md](store/firefox-addons.md).

## Other D2L addresses

It runs on `*.desire2learn.com` and `*.brightspace.com`. If your school uses its own domain (e.g. `d2l.myschool.edu`), add a line to `content_scripts.matches` in `extension/manifest.json`:

```
"https://d2l.myschool.edu/d2l/lms/grades/my_grades/*"
```

## Testing

Needs [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm test
```

`npm test` runs the automated tests in `tests/`:

| Test file | Covers |
| --- | --- |
| `grades-core.test.js` | Reading the D2L grades table (made-up pages with the real markup), ungraded/dropped/bonus items, total-points and weighted math |
| `grouping.test.js` | Grouping uncategorized items (HW01…HW05 → HW), moving items, fitting shared setups to a course |
| `syllabus.test.js` | Syllabus matching on made-up formats and on real syllabus text in `tests/fixtures/syllabi/` |
| `pdf.test.js` | PDF text extraction with pdf.js on generated PDFs |
| `database.test.js` | `supabase/schema.sql` in an in-memory Postgres (PGlite): popularity, section/course fallback, validation, permissions. Never touches the live project |
| `background.test.js` | Uploading/fetching shared setups, opt-out, retries, opening the weights page |
| `content.test.js` | The badge on a fake D2L page: rendering, editing, autosave, shared setups, scroll fade, HTML escaping |

Manual test pages (real extension code with a fake browser API, handy for trying UI changes):

```bash
node tests/harness/serve.js
```

- Weights page: http://127.0.0.1:5178/?course=flat (no categories) or `?course=demo` (categories); `&shared=1`, `&configured=0`. `tests/fixtures/sample-syllabus.pdf` is a made-up syllabus to try the PDF upload with.
- Badge: http://127.0.0.1:5178/tests/harness/badge.html (`?weights=1`, `?shared=1`)

Firefox checks: `npm run lint:firefox` (Mozilla's `web-ext lint`). Expected warnings: `background.service_worker` (Chrome-only key, Firefox uses `background.scripts`; gone in the `npm run build:firefox` package), `data_collection_permissions` needing Firefox for Android 142 (Android isn't supported yet), `eval`/`import` inside the bundled pdf.js (disabled with `isEvalSupported: false` and blocked by extension CSP), and `innerHTML` in `content.js` (all D2L text is escaped first; covered by a test).

## Publishing

```bash
npm run build:chrome    # dist/grade-calculator-for-d2l-chrome-<version>.zip
npm run build:firefox   # dist/grade-calculator-for-d2l-firefox-<version>.zip
```

The store builds use the same code with a browser-specific manifest. `npm run icons` re-renders the icons from `assets/icon.svg`. `npm run store-images` (with `node tests/harness/serve.js` running) re-makes the store screenshots and promo tile in `store/images/`. Every Chrome Web Store form answer is in [store/chrome-web-store.md](store/chrome-web-store.md), and the Firefox Add-ons (AMO) steps are in [store/firefox-addons.md](store/firefox-addons.md). For an update, bump `version` in `extension/manifest.json` first.

## Files

| File | What it does |
| --- | --- |
| `extension/manifest.json` | Extension setup for Chrome and Firefox (Manifest V3) |
| `extension/content.js` | Draws the badge on the Grades page and handles shared setups |
| `extension/grades-core.js` | Reads the grades table and works out the grade (no browser APIs, so it's testable) |
| `extension/pdf-text.js` | Turns a syllabus PDF into text lines with pdf.js |
| `extension/grouping.js` | Groups uncategorized items and works out each category's % (shared by badge and weights page) |
| `extension/background.js` | Opens the weights page; uploads and fetches shared setups |
| `extension/config.js` | Supabase project URL and public key |
| `supabase/schema.sql` | Database table, validation and the two sharing functions |
| `extension/weights.html/.js/.css` | Weights editor and syllabus import |
| `extension/syllabus-parse.js` | Finds "Category … 20%" lines in syllabus text |
| `extension/lib/` | pdf.js 4.10.38 by Mozilla (Apache 2.0) for reading PDFs |
