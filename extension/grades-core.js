// Pure logic for reading the D2L grades table and working out the grade.
// No extension APIs here, so the same file runs in the content script and in tests.
(() => {
  'use strict';

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  // innerText skips hidden text in a real browser; textContent is the fallback for test DOMs.
  const textOf = (el) => (el ? clean(el.innerText !== undefined ? el.innerText : el.textContent) : '');

  // "29 / 50" -> {earned: 29, possible: 50}; "- / 50" -> {earned: null, possible: 50}
  function parsePoints(text) {
    const m = clean(text).replace(/,/g, '').match(/(-|\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
    if (!m) return null;
    return { earned: m[1] === '-' ? null : parseFloat(m[1]), possible: parseFloat(m[2]) };
  }

  // "78.67 %" -> 78.67; "-%" -> null
  function parsePercent(text) {
    const m = clean(text).replace(/,/g, '').match(/(-?\d+(?:\.\d+)?)\s*%/);
    return m ? parseFloat(m[1]) : null;
  }

  // Header cell text -> column index, counting colspans ("Grade Item" spans 2 columns).
  function columnMap(table) {
    const map = {};
    let i = 0;
    for (const cell of table.rows[0].cells) {
      map[textOf(cell).toLowerCase()] = i;
      i += cell.colSpan || 1;
    }
    return map;
  }

  function cellAt(row, col) {
    let i = 0;
    for (const cell of row.cells) {
      const span = cell.colSpan || 1;
      if (col >= i && col < i + span) return cell;
      i += span;
    }
    return null;
  }

  // Returns the table as raw groups: [{ name, d2lPct, items: [...], loose }].
  // Categories hold their items; items outside any category are "loose" and get
  // grouped later by grouping.js.
  function parseGradesTable(table) {
    if (!table || !table.rows || !table.rows.length) return [];
    const cols = columnMap(table);
    const pointsCol = cols['points'];
    const gradeCol = cols['grade'];
    const groups = [];
    let current = null;

    for (const row of Array.from(table.rows).slice(1)) {
      const th = row.querySelector('th[scope="row"]');
      if (!th) continue;
      const name = textOf(th);
      if (!name) continue;
      const ptsCell = pointsCol != null ? cellAt(row, pointsCol) : null;
      const grdCell = gradeCol != null ? cellAt(row, gradeCol) : null;
      const pts = ptsCell ? parsePoints(textOf(ptsCell)) : null;
      const pct = grdCell ? parsePercent(textOf(grdCell)) : null;
      const topLevel = (th.colSpan || 1) >= 2;
      const isCategory = row.classList.contains('d_ggl1') || (topLevel && !pts);

      if (isCategory) {
        current = { name, d2lPct: pct, items: [], loose: false };
        groups.push(current);
        continue;
      }

      // Only look at the name/points/grade cells, not instructor comments.
      const statusText = [th, ptsCell, grdCell].map(textOf).join(' ');
      const item = {
        name,
        earned: pts ? pts.earned : null,
        possible: pts ? pts.possible : null,
        pct,
        excluded: /\b(dropped|exempt(ed)?)\b/i.test(statusText),
      };

      if (topLevel || !current) {
        groups.push({ name, d2lPct: pct, items: [item], loose: true });
        current = null;
      } else {
        current.items.push(item);
      }
    }
    return groups;
  }

  // Weighted: sum(weight x category %) / sum(weights of graded, weighted categories).
  // No weights: total points earned / possible over graded items.
  function computeGrade(cats, weights) {
    const w = (name) => {
      const v = weights ? weights[name] : undefined;
      return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
    };
    const totalWeight = cats.reduce((a, c) => a + w(c.name), 0);

    if (totalWeight > 0) {
      let sum = 0, used = 0;
      for (const c of cats) {
        if (c.pct != null && w(c.name) > 0) {
          sum += w(c.name) * c.pct;
          used += w(c.name);
        }
      }
      return {
        mode: 'weighted',
        pct: used > 0 ? sum / used : null,
        usedWeight: used,
        totalWeight,
        missingWeight: cats.filter((c) => c.pct != null && !w(c.name)).map((c) => c.name),
      };
    }

    let e = 0, p = 0;
    for (const c of cats) {
      if (c.possible > 0) {
        e += c.earned;
        p += c.possible;
      }
    }
    return { mode: 'points', pct: p > 0 ? (e / p) * 100 : null, earned: e, possible: p };
  }

  // Course identity for sharing, from D2L's enrollment info:
  // Code "31427.202630" (CRN.term), Name "CPSC-374-01 - Algorithms and Data Structures".
  function parseCourseMeta(orgUnit, fallbackName) {
    const out = { courseCode: null, term: null };
    const code = String((orgUnit && orgUnit.Code) || '').match(/\.(\d{4,8})$/);
    if (code) out.term = code[1];
    const name = String((orgUnit && orgUnit.Name) || fallbackName || '')
      .match(/^([A-Z]{2,6})[-\s]?(\d{3,4}[A-Z]?)\b/);
    if (name) out.courseCode = `${name[1]}-${name[2]}`;
    return out;
  }

  // "Grades - CPSC-374-01 - Algorithms and Data Structures - Slippery Rock University" -> middle part
  function courseNameFromTitle(title) {
    const parts = String(title).split(' - ');
    return parts.length > 2 ? parts.slice(1, -1).join(' - ') : String(title);
  }

  globalThis.D2LGradesCore = {
    parsePoints, parsePercent, parseGradesTable, computeGrade, parseCourseMeta, courseNameFromTitle,
  };
})();
