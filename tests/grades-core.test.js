import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './helpers/load.js';
import { makeDom, CATEGORIZED, FLAT } from './helpers/d2l-page.js';

const { D2LGradesCore: core, D2LGrouping: grouping } = loadScripts(['grades-core.js', 'grouping.js']);
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, `${msg}: expected ${b}, got ${a}`);

function categoriesFor(rows, overrides) {
  const dom = makeDom(rows);
  const raw = core.parseGradesTable(dom.window.document.querySelector('table.d2l-table'));
  return { raw, cats: grouping.buildCategories(raw, overrides) };
}

test('parsePoints', () => {
  assert.deepEqual(core.parsePoints('29 / 50'), { earned: 29, possible: 50 });
  assert.deepEqual(core.parsePoints('- / 50'), { earned: null, possible: 50 });
  assert.deepEqual(core.parsePoints(' 29.5/50 '), { earned: 29.5, possible: 50 });
  assert.deepEqual(core.parsePoints('1,000 / 1,200'), { earned: 1000, possible: 1200 });
  assert.deepEqual(core.parsePoints('5 / 0'), { earned: 5, possible: 0 });
  assert.equal(core.parsePoints(''), null);
  assert.equal(core.parsePoints('85 %'), null);
});

test('parsePercent', () => {
  assert.equal(core.parsePercent('78.67 %'), 78.67);
  assert.equal(core.parsePercent('100%'), 100);
  assert.equal(core.parsePercent('-%'), null);
  assert.equal(core.parsePercent(''), null);
});

test('reads a categorized gradebook like CPSC 374', () => {
  const { raw, cats } = categoriesFor(CATEGORIZED);
  assert.deepEqual(raw.map((g) => [g.name, g.loose]), [
    ['Quizzes', false], ['Assignments', false], ['Exams', false], ['Participation', false], ['Syllabus Quiz', true],
  ]);
  const by = Object.fromEntries(cats.map((c) => [c.name, c]));

  // Ungraded Quiz #4 is skipped: 118 / 150, same as D2L shows.
  close(by.Quizzes.pct, 78.6667, 'Quizzes %');
  assert.equal(by.Quizzes.graded, 3);
  assert.equal(by.Quizzes.total, 4);

  // Dropped item skipped, bonus 5/0 adds 5 points, a comment saying "Exempt" doesn't exclude.
  close(by.Assignments.pct, 80, 'Assignments % ((45+70+5)/150)');
  assert.equal(by.Assignments.total, 3, 'dropped item not counted');

  close(by.Exams.pct, 85, 'Exams %');
  assert.equal(by.Participation.pct, 95, 'empty category uses D2L\'s %');
  close(by['Syllabus Quiz'].pct, 100, 'uncategorized item');
});

test('total points when no weights are set', () => {
  const { cats } = categoriesFor(CATEGORIZED);
  const g = core.computeGrade(cats, {});
  assert.equal(g.mode, 'points');
  // (118 + 120 + 85 + 10) / (150 + 150 + 100 + 10); Participation has no points.
  close(g.pct, (333 / 410) * 100, 'points grade');
});

test('weighted grade', () => {
  const { cats } = categoriesFor(CATEGORIZED);
  const g = core.computeGrade(cats, { Quizzes: 20, Assignments: 30, Exams: 40, Participation: 10 });
  assert.equal(g.mode, 'weighted');
  close(g.pct, 0.2 * 78.6667 + 0.3 * 80 + 0.4 * 85 + 0.1 * 95, 'weighted grade');
  assert.equal(g.totalWeight, 100);
  assert.deepEqual(g.missingWeight, ['Syllabus Quiz']);
});

test('weighted grade skips weighted categories with nothing graded yet', () => {
  const cats = [
    { name: 'A', pct: 90, earned: 90, possible: 100 },
    { name: 'B', pct: null, earned: 0, possible: 0 },
  ];
  const g = core.computeGrade(cats, { A: 40, B: 60 });
  close(g.pct, 90, 'only A counts so far');
  assert.equal(g.usedWeight, 40);
});

test('weights that are zero, negative or not numbers are ignored', () => {
  const cats = [{ name: 'A', pct: 80, earned: 8, possible: 10 }];
  for (const bad of [0, -5, NaN, Infinity, '50', null]) {
    assert.equal(core.computeGrade(cats, { A: bad }).mode, 'points', `weight ${bad}`);
  }
});

test('no graded items at all', () => {
  const g = core.computeGrade([{ name: 'A', pct: null, earned: 0, possible: 0 }], {});
  assert.equal(g.pct, null);
});

test('empty or missing table', () => {
  assert.deepEqual(core.parseGradesTable(null), []);
});

test('reads a gradebook with no categories like CPSC 237 and groups it', () => {
  const { cats } = categoriesFor(FLAT);
  assert.deepEqual(cats.map((c) => c.name), ['HW', 'GroupProj']);
  close(cats[0].pct, (150 / 152) * 100, 'HW %');
  assert.deepEqual(cats[0].itemNames, ['HW01', 'HW02', 'HW03', 'HW04', 'HW05']);
  close(core.computeGrade(cats, {}).pct, (193 / 202) * 100, 'total points');
});

test('course identity from D2L enrollment info', () => {
  assert.deepEqual(
    core.parseCourseMeta({ Code: '31427.202630', Name: 'CPSC-374-01 - Algorithms and Data Structures' }),
    { courseCode: 'CPSC-374', term: '202630' },
  );
  // No enrollment info: course code from the page title, no term.
  assert.deepEqual(core.parseCourseMeta(null, 'MGMT 320 - Operations Management'), { courseCode: 'MGMT-320', term: null });
  assert.deepEqual(core.parseCourseMeta({ Code: 'weird', Name: 'Sandbox' }), { courseCode: null, term: null });
});

test('course name from page title', () => {
  assert.equal(
    core.courseNameFromTitle('Grades - CPSC-374-01 - Algorithms and Data Structures - Slippery Rock University of Pennsylvania'),
    'CPSC-374-01 - Algorithms and Data Structures',
  );
  assert.equal(core.courseNameFromTitle('Grades'), 'Grades');
});
