# Chrome Web Store submission: copy-paste answers

Everything the Chrome Web Store developer dashboard asks for, in the order the dashboard asks.
Upload file: `dist/grade-calculator-for-d2l-chrome-<version>.zip` (make it with `npm run build:chrome`).

---

## Store listing tab

**Item name** (comes from the manifest): Grade Calculator for D2L

**Summary** (comes from the manifest, max 132 characters):
Shows your overall course grade at the top of the D2L Brightspace Grades page, using weights you set or pull from your syllabus.

**Description:**

```
See your overall course grade right on the D2L Brightspace Grades page.

D2L shows each assignment and category, but often not the grade you actually have in the course. Grade Calculator for D2L adds a small badge to the top of the Grades page with your current overall grade. It fades away as you scroll.

FEATURES
• Your current grade at a glance: total points earned ÷ points possible, or a weighted grade once you set category weights.
• Ungraded items are skipped, so you see where you stand right now. Dropped and exempt items are skipped too, and bonus points count.
• Breakdown: see each category's %, how many items are graded, and its weight. Type a weight and your grade updates instantly.
• Import weights from your syllabus: upload the PDF or paste the grading section. It reads percentage breakdowns ("Quizzes … 20%") and points tables ("Category Points … Total 1,000") and fills the weights in for you to check.
• Courses without categories: items are grouped by name automatically (HW01–HW05 → HW), and you can move items between groups.
• Share with classmates (optional): weights you set are shared anonymously with others in the same course, and if you haven't set any, the setup most classmates use is filled in for you. Only category names, item names, groups and weights are shared, never your grades or who you are. Turn it off any time.

PRIVACY
Your grades never leave your computer. No accounts, ads, analytics or tracking. Full privacy policy: https://github.com/Callofdutygamer1950/D2L-Grade-Calc/blob/main/PRIVACY.md

Works on D2L Brightspace sites at *.desire2learn.com and *.brightspace.com.

Found a bug? Email JoeysItSupport@gmail.com or open an issue: https://github.com/Callofdutygamer1950/D2L-Grade-Calc/issues

Grade Calculator for D2L is an independent project and is not affiliated with or endorsed by D2L Corporation. D2L and Brightspace are trademarks of D2L Corporation.
```

**Category:** Education

**Language:** English

**Graphic assets** (all in `store/images/`):
- Store icon (128×128): `extension/icons/icon128.png`
- Screenshots (1280×800): `store/images/screenshot-1-badge.png`, `screenshot-2-breakdown.png`, `screenshot-3-syllabus.png`
- Small promo tile (440×280): `store/images/promo-small-440x280.png`

**Official URL:** leave as "None" (needs a verified domain).

**Homepage URL:** https://github.com/Callofdutygamer1950/D2L-Grade-Calc

**Support URL:** https://github.com/Callofdutygamer1950/D2L-Grade-Calc/issues

**Mature content:** No

---

## Privacy tab

**Single purpose description:**

```
Shows the student's overall course grade on the D2L Brightspace Grades page, calculated from the grades on that page and category weights the student sets (by hand, from their syllabus, or from setups shared by classmates in the same course).
```

**Permission justifications:**

`storage`
```
Saves the category weights and item groups the student sets for each course, so the grade badge shows the same weighted grade every time the Grades page is opened. Also stores the sharing on/off setting.
```

Host permission `https://chhfebjnwftjyogxyzcx.supabase.co/*`
```
The extension's own database for the optional "share with classmates" feature. It uploads a course's category weights and item groups (no grades or personal information) and downloads the setup most students in the same course shared. Can be turned off on the extension's weights page.
```

Content script / host access `https://*.desire2learn.com/d2l/lms/grades/my_grades/*` and `https://*.brightspace.com/d2l/lms/grades/my_grades/*`
```
D2L Brightspace is hosted per school at these domains. The content script runs only on the "My Grades" page to read the grades table and show the overall grade badge. It does not run on any other page.
```

**Are you using remote code?** No, I am not using remote code.
(All JavaScript, including the PDF reader pdf.js, is bundled in the package. The Supabase calls only exchange JSON data.)

**Data usage: what user data do you plan to collect?** Tick only:
- ☑ **Website content** (category names, item names, groups and weights from the D2L Grades page are shared when sharing is on)

Leave everything else unticked: personally identifiable information, health, financial and payment, authentication, personal communications, location, web history, user activity.

**Certify all three:**
- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://github.com/Callofdutygamer1950/D2L-Grade-Calc/blob/main/PRIVACY.md

---

## Distribution tab

- **Payments:** Free of charge
- **Visibility:** Public
- **Regions:** All regions

## Account tab (one-time)

- **Contact email:** JoeysItSupport@gmail.com (must be verified by clicking the link Google emails you)

---

## Updating later

1. Bump `"version"` in `extension/manifest.json` (e.g. 1.0.1). The store rejects a zip with the same version.
2. `npm test`, then `npm run build:chrome`.
3. Dashboard → the item → **Package** → **Upload new package** → **Submit for review**.
