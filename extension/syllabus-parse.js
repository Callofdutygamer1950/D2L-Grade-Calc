// Finds category weights in syllabus text by pattern matching (no AI, nothing sent anywhere).
//
// Syllabi state weights in a few ways, so several readers run and the one that
// matches the most D2L categories wins:
//   1. Percent breakdown: a run of "Label ... 20%" lines that adds up to 100%.
//   2. Points table:      "Category Points" header, "Label 500" rows, "Total 1,000".
//   3. Inline points:     "Final Exam (200 points)", "Chapter Quizzes (12x60 = 780 Points)".
//   4. Any percentages:   fallback when nothing above is found.
// Each D2L category name is then matched to labels by shared words
// ("Quizzes" ~ "Weekly quizzes", "Assignments" ~ "Homework", "Exams" ~ "Midterm Exam" + "Final Exam").

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'for', 'in', 'on', 'to', 'your', 'my', 'will', 'be',
  'count', 'counts', 'worth', 'is', 'are', 'each', 'per', 'all', 'with', 'by', 'course',
  'weight', 'weighted', 'overall', 'grade', 'grades', 'total', 'point', 'points', 'percent',
  'account', 'accounts', 'pt', 'pts',
]);

// Words that usually mean the same kind of graded work.
const SYNONYMS = {
  homework: 'assignment', hw: 'assignment', assign: 'assignment', asgn: 'assignment', assgn: 'assignment',
  proj: 'project', prj: 'project',
  disc: 'discussion',
  test: 'exam', examination: 'exam',
  laboratory: 'lab',
  attendance: 'participation',
};

export function singular(w) {
  if (/zzes$/.test(w)) return w.slice(0, -3);                 // quizzes -> quiz
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y';            // activities -> activity
  if (/(ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2); // classes -> class
  if (/s$/.test(w) && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

export function tokens(s) {
  return (String(s)
    .replace(/([a-z])([A-Z])/g, '$1 $2')           // "GroupProj" -> "Group Proj"
    .toLowerCase()
    .replace(/\bmid[\s-]+term/g, 'midterm')
    .match(/[a-z]+/g) || [])
    .map(singular)
    .map((t) => SYNONYMS[t] || t)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

const wordCount = (s) => (s.match(/[A-Za-z]+/g) || []).length;
const letters = (s) => (s.match(/[A-Za-z]/g) || []).length;
const isLetterGrade = (s) => /^[A-F][+-]?$/i.test(s.trim());
const isTotal = (s) => /^(total|totals|course total|final grade|overall|grand total)\b/i.test(s.trim());
const num = (s) => parseFloat(String(s).replace(/,/g, ''));
const round2 = (n) => Math.round(n * 100) / 100;

function cleanLabel(s) {
  return s
    .replace(/\.{2,}|…|_{2,}/g, ' ')                       // leader dots / underscores
    .replace(/\(\s*\d*\s*\)/g, ' ')                              // "(4)" or "()"
    .replace(/^[^A-Za-z0-9]+/, '')                               // bullets, arrows, dashes, commas
    .replace(/^\d+[.)]\s+/, '')                                  // "1. " numbering
    .replace(/^((for|the|a|an)\s+)+/i, '')                       // "for the midterm" -> "midterm"
    .replace(/(\s+(will|be|is|are|worth|accounts?|counts?|for|=))+\s*$/i, '') // "Quizzes will count for" -> "Quizzes"
    .replace(/[\s.:\-–—=|(,;]+$/, '')                  // trailing punctuation
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function splitLines(text) {
  return String(text).split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim());
}

// ---------- 1 & 4: percentages ----------

export function findPercentEntries(text) {
  const entries = [];
  splitLines(text).forEach((line, lineNo) => {
    if (!line) return;
    const re = /(\d{1,3}(?:\.\d+)?)\s*(?:%|percent\b)/gi;
    const hits = [];
    let m;
    while ((m = re.exec(line))) hits.push({ value: parseFloat(m[1]), start: m.index, end: re.lastIndex });

    hits.forEach((h, i) => {
      if (!(h.value > 0 && h.value <= 100)) return;
      const beforeRaw = line.slice(i ? hits[i - 1].end : 0, h.start);
      if (/\d\s*[-–—]\s*$/.test(beforeRaw)) return;  // part of a range like "90-100%"
      const afterRaw = line.slice(h.end, i + 1 < hits.length ? hits[i + 1].start : line.length);
      if (/^\s*[-–—]\s*\d/.test(afterRaw)) return;    // "90% - 100%"

      let label = cleanLabel(beforeRaw);
      if (letters(label) < 3 || isLetterGrade(label)) {
        if (isLetterGrade(label)) return; // grading scale line, e.g. "A 93%"
        label = cleanLabel(afterRaw);      // "20% Quizzes"
      }
      if (letters(label) < 3 || isLetterGrade(label) || isTotal(label)) return;
      entries.push({ label, value: h.value, line: lineNo, unit: '%' });
    });
  });
  return entries;
}

// Longest run of consecutive entries that sums to 100 (+/- 0.5).
export function findBreakdownBlock(entries) {
  let best = null;
  for (let i = 0; i < entries.length; i++) {
    let sum = 0;
    for (let j = i; j < entries.length && j < i + 20; j++) {
      sum += entries[j].value;
      if (j > i && Math.abs(sum - 100) <= 0.5) {
        if (!best || j - i > best.end - best.start) best = { start: i, end: j };
        break;
      }
      if (sum > 100.5) break;
    }
  }
  return best;
}

// ---------- 2: points table ----------

// "Category Points" / "Assignments 500 (100 x 4, 50 x 2)" / ... / "Total 1,000"
export function findPointsTable(text) {
  const lines = splitLines(text);
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i];
    if (!/^[A-Za-z][A-Za-z &/]*\s+(points|pts)$/i.test(head) || isTotal(head)) continue;

    const entries = [];
    let total = null;
    for (let j = i + 1; j < lines.length && j < i + 40; j++) {
      const line = lines[j];
      if (!line || /^\d{1,3}$/.test(line)) continue; // blank line or page number
      // Greedy "everything up to the first digit" (cleanLabel trims the leader dots/colons).
      // A lazy pattern here backtracks badly on long lines.
      const m = line.match(/^([A-Za-z][^\d]*)(\d[\d,]*(?:\.\d+)?)\b/);
      if (!m) break;
      const label = cleanLabel(m[1]);
      const value = num(m[2]);
      if (isTotal(label)) {
        total = value;
        break;
      }
      if (letters(label) >= 3 && value > 0) entries.push({ label, value, line: j, unit: 'pts' });
    }
    if (entries.length >= 2) {
      const sum = entries.reduce((a, e) => a + e.value, 0);
      return { entries, total: total || sum };
    }
  }
  return null;
}

// ---------- 3: inline points ----------

// "Final Exam (200 points)", "Chapter Quizzes (12x60 =780 Points)",
// "Research Proposal and Final Paper: 200 points"
export function findInlinePoints(text) {
  const entries = [];
  splitLines(text).forEach((line, lineNo) => {
    const re = /(\d[\d,]*(?:\.\d+)?)\s*(?:points?|pts?)\b/gi;
    let m, last = null;
    while ((m = re.exec(line))) last = m;
    if (!last) return;
    const cut = line.search(/[\d(:]/);
    if (cut < 0) return;
    // Only heading-style lines: "Label (N points)", "Label: N points", "Label – N points".
    // Skips sentences like "All discussion boards are worth 50 points".
    const before = line.slice(0, cut);
    const headingLike = line[cut] === '(' || line[cut] === ':' ||
      (/\s[-–—]\s*$/.test(before) && !/\bworth\b/i.test(before));
    if (!headingLike) return;
    const label = cleanLabel(before);
    if (!/^[A-Z]/.test(label) || letters(label) < 3 || wordCount(label) > 6 || isTotal(label)) return;
    entries.push({ label, value: num(last[1]), line: lineNo, unit: 'pts' });
  });
  return entries;
}

// ---------- Matching categories to labels ----------

function dedupe(list) {
  const seen = new Set();
  return list.filter((e) => {
    const k = e.label.toLowerCase() + '|' + e.value;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const sameSet = (a, b) => a.length === b.length && a.every((t) => b.includes(t));

function matchEntries(categoryNames, pool) {
  const out = {};
  for (const name of categoryNames) {
    const ct = tokens(name);
    if (!ct.length) continue;

    const full = pool.filter((e) => {
      const et = tokens(e.label);
      return ct.every((t) => et.includes(t));
    });
    const cands = full.length ? full : pool.filter((e) => tokens(e.label).some((t) => ct.includes(t)));
    if (!cands.length) continue;

    const exact = cands.filter((e) => sameSet(tokens(e.label), ct));
    if (exact.length) {
      out[name] = { chosen: [exact[0]], confidence: 'high' };
      continue;
    }
    // Prefer short heading-like labels ("Midterm Exam") over sentences
    // ("All discussion boards are worth"); several short ones get added together.
    const short = cands.filter((e) => wordCount(e.label) <= 4);
    const chosen = short.length ? short : cands;
    out[name] = { chosen, confidence: full.length && chosen.length === 1 && short.length ? 'high' : 'check' };
  }
  return out;
}

// Returns {
//   results: { categoryName: { value, from: [...], confidence: 'high' | 'check' } },
//   source:  'percent' | 'points-table' | 'points-inline' | 'percent-loose' | null,
//   found:   [{ label, value, unit, used }]   // entries from the chosen source, for display
//   total:   points total used for conversion (points sources only)
// }
export function matchWeights(categoryNames, text) {
  const pct = findPercentEntries(text);
  const block = findBreakdownBlock(pct);
  const table = findPointsTable(text);
  const inline = findInlinePoints(text);

  const sources = [];
  if (block) sources.push({ source: 'percent', pool: pct.slice(block.start, block.end + 1), total: null });
  if (table) sources.push({ source: 'points-table', pool: table.entries, total: table.total });
  if (inline.length) sources.push({ source: 'points-inline', pool: inline, total: null });
  if (!block && pct.length) sources.push({ source: 'percent-loose', pool: pct, total: null });

  // Pick the source that matches the most categories (earlier sources win ties).
  let best = null;
  for (const s of sources) {
    const pool = dedupe(s.pool);
    const matched = matchEntries(categoryNames, pool);
    const score = Object.keys(matched).length;
    if (!best || score > best.score) best = { ...s, pool, matched, score };
  }
  if (!best || !best.score) {
    return { results: {}, source: null, found: (best ? best.pool : pct).map((e) => ({ ...e, used: false })), total: null };
  }

  const sums = {};
  for (const [name, m] of Object.entries(best.matched)) sums[name] = m.chosen.reduce((a, e) => a + e.value, 0);

  let total = null;
  if (best.source.startsWith('points')) {
    // Table: its Total line. Inline: the matched points added up.
    total = best.total || Object.values(sums).reduce((a, b) => a + b, 0);
  }

  const results = {};
  for (const [name, m] of Object.entries(best.matched)) {
    const value = total ? (sums[name] / total) * 100 : sums[name];
    results[name] = {
      value: round2(value),
      from: m.chosen.map((e) => `${e.label} ${e.value}${e.unit === '%' ? '%' : ' pts'}`),
      confidence: m.confidence,
    };
  }

  const used = new Set(Object.values(best.matched).flatMap((m) => m.chosen));
  return {
    results,
    source: best.source,
    found: best.pool.map((e) => ({ label: e.label, value: e.value, unit: e.unit, used: used.has(e) })),
    total,
  };
}
