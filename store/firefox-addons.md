# Firefox Add-ons (AMO) submission: step by step

Publishing on addons.mozilla.org ("AMO") is free. A listed, signed add-on is the only way to install it permanently in regular Firefox.

- Upload file: `dist/grade-calculator-for-d2l-firefox-<version>.zip` (make it with `npm run build:firefox`)
- Add-on ID (fixed forever; it's in the manifest): `grade-calculator-for-d2l@callofdutygamer1950`
- Minimum version: Firefox 140 (desktop). Firefox for Android is not included in this version.

---

## 0. Test the Firefox build first

1. Run `npm run build:firefox`.
2. In Firefox, open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, and pick `dist/firefox/manifest.json`.
3. Firefox shows the data-collection notice ("website content"). That's expected; see section 4.
4. If Firefox asks for permission on desire2learn.com / brightspace.com, allow it. You can also do this from the puzzle-piece menu → Grade Calculator for D2L → **Always allow on …**.
5. Open a D2L Grades page and check:
   - the badge shows your grade;
   - Breakdown opens and typing a weight updates the grade;
   - **Set weights** opens the weights page; a syllabus PDF fills weights;
   - the sharing switch is at the bottom of the weights page.
6. The temporary add-on is removed when Firefox closes.

## 1. Create a developer account

1. Go to https://addons.mozilla.org/developers/ and sign in with a Mozilla account (free).
2. Accept the developer agreement when asked.

## 2. Upload

1. **Submit a New Add-on**.
2. **Where to host:** **On this site** (listed on AMO).
3. **Upload** the zip. AMO runs the same checks as `npm run lint:firefox`: 0 errors expected. The warnings it lists are explained in section 6.
4. **Compatible platforms:** tick **Firefox** only (untick Firefox for Android).

## 3. Source code

**"Do you need to submit source code?"** → **No.**

All of the extension's own code is plain, unminified JavaScript. The only minified files are Mozilla's pdf.js library, copied unchanged; that's explained in the reviewer notes (section 5), which is what AMO asks for third-party libraries.

## 4. Describe the add-on

**Name:** Grade Calculator for D2L

**Add-on URL:** `grade-calculator-for-d2l`

**Summary** (max 250 characters):
```
Shows your overall course grade at the top of the D2L Brightspace Grades page, using weights you set or pull from your syllabus. Not affiliated with D2L Corporation.
```

**Description:** use the same text as the Chrome description in `store/chrome-web-store.md` ("See your overall course grade right on the D2L Brightspace Grades page…").

**Categories:** **Other**. AMO's desktop categories don't include Education; if the form shows one closer to it, use that.

**Support email:** JoeysItSupport@gmail.com

**Support website:** https://github.com/Callofdutygamer1950/D2L-Grade-Calc/issues

**License:** GNU General Public License v3.0 (same as the repository's LICENSE file)

**"This add-on has a privacy policy":** tick it and paste the whole text of `PRIVACY.md`. AMO wants the text itself, not a link.

**Data collection:** shown automatically from the manifest: *Website content* (required). This matches the sharing feature: category names, item names, groups and weights. Firefox shows it to users at install.

## 5. Notes to reviewer

```
This add-on only runs on a school's D2L Brightspace "My Grades" page (*.desire2learn.com, *.brightspace.com), which needs a student login we can't provide. There it reads the grades table and shows the overall grade in a badge. The source is public: https://github.com/Callofdutygamer1950/D2L-Grade-Calc. It includes a test copy of the Grades page with made-up data running the same code: run "node tests/harness/serve.js" and open http://127.0.0.1:5178/tests/harness/badge.html (badge) or http://127.0.0.1:5178/?course=demo (weights page).

Third-party library: lib/pdf.min.js and lib/pdf.worker.min.js are Mozilla pdf.js 4.10.38, unmodified, from npm "pdfjs-dist@4.10.38" (build/pdf.min.mjs and build/pdf.worker.min.mjs, renamed .mjs -> .js):
https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs
  sha256 27fc2a057a00f92a4334ad06e17dbd7259912954e9fb7f76400bcca5fd190a9c
https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs
  sha256 1baa1844c89c80a5b2797c916e75ab29254be46d8e9cb53cb6364d7aad84be36
It's called with isEvalSupported: false and only used to read text from a syllabus PDF the user picks.

innerHTML in content.js: the badge markup is built from D2L category/item names, and every name goes through esc(), which escapes & < > " '. A test plants an <img onerror> item name and checks nothing runs (tests/content.test.js).

Network: only https://chhfebjnwftjyogxyzcx.supabase.co, for optional anonymous sharing of category/item names, groups and weights (never grades or personal data). It can be turned off on the weights page. Declared as "websiteContent" in data_collection_permissions.
```

## 6. Linter warnings you'll see (all expected)

- **Manifest key not supported by the minimum Firefox for Android version:** only matters for Android, which this version doesn't support.
- **innerHTML in content.js** (2): all D2L text is escaped first (see reviewer notes).
- **eval / Function / import in lib/pdf\*.js** (3): inside the unmodified pdf.js library. Eval is disabled with `isEvalSupported: false` and blocked by the extension's content security policy anyway.

## 7. Images (after submitting)

The icon comes from the manifest. Add screenshots on the add-on's **Edit Product Page** → **Images** → **Screenshots**, using the same files as Chrome: `store/images/screenshot-1-badge.png`, `screenshot-2-breakdown.png`, `screenshot-3-syllabus.png`.

## 8. Review

AMO signs the add-on after automatic checks, usually within minutes to a day, and it appears on the site. A human reviewer may look at it later and email you if they need changes.

---

## Updating later

1. Bump `"version"` in `extension/manifest.json`. AMO rejects a version number it has seen before.
2. `npm test`, then `npm run build:firefox`.
3. On AMO: **Manage My Submissions** → the add-on → **Upload New Version**. Answer "No" to source code again, paste the same reviewer notes, and add what changed.
