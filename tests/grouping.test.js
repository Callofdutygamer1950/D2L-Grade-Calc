import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './helpers/load.js';

const { D2LGrouping: g } = loadScripts(['grouping.js']);

const item = (name, earned, possible) => ({ name, earned, possible, pct: null, excluded: false });
const loose = (name, earned, possible) => ({ name, d2lPct: null, items: [item(name, earned, possible)], loose: true });
const FLAT = [loose('HW01', 30, 30), loose('HW02', 20, 30), loose('GroupProj', 43, 50), loose('HW03', null, 30)];

test('baseName strips trailing numbers', () => {
  assert.equal(g.baseName('HW01'), 'HW');
  assert.equal(g.baseName('Quiz #3'), 'Quiz');
  assert.equal(g.baseName('Assignment 12'), 'Assignment');
  assert.equal(g.baseName('Lab-2'), 'Lab');
  assert.equal(g.baseName('Chapter (4)'), 'Chapter');
  assert.equal(g.baseName('GroupProj'), 'GroupProj');
  assert.equal(g.baseName('2024'), '2024', 'never returns an empty name');
});

test('baseName strips trailing dates and date ranges', () => {
  for (const name of [
    'Weekly Progress Report Nov 2 - Nov 6',
    'Weekly Progress Report Nov 30 - Dec 4',
    'Weekly Progress Report November 16th - November 20th, 2026',
    'Weekly Progress Report 11/2 - 11/6',
    'Weekly Progress Report (Nov 2)',
    'Weekly Progress Report: 2026-11-02',
    'Weekly Progress Report Week of Nov 2',
    'Weekly Progress Report Nov 2 to Nov 6',
    'Weekly Progress Report – Sept 5',
  ]) assert.equal(g.baseName(name), 'Weekly Progress Report', name);
  assert.equal(g.baseName('Lab 2 - Nov 3'), 'Lab', 'number and date together');
  assert.equal(g.baseName('Reflection (11/3/26)'), 'Reflection');
});

test('baseName leaves names alone when nothing trailing is a number or date', () => {
  for (const name of ['Group Project', 'Project PowerPoint Slides', 'Narrative Presentation', 'Introduction to',
    'Final Exam May', 'March Madness Quiz', 'Project Evaluation']) {
    assert.equal(g.baseName(name), name, name);
  }
  assert.equal(g.baseName('Nov 6'), 'Nov 6', 'a name that is only a date is kept');
});

test('weekly reports with date ranges become one group', () => {
  const weeks = ['Nov 2 - Nov 6', 'Nov 9 - Nov 13', 'Nov 16 - Nov 20', 'Nov 23 - Nov 27', 'Nov 30 - Dec 4'];
  const raw = [loose('Group Project', null, 50), ...weeks.map((w, i) => loose('Weekly Progress Report ' + w, i < 2 ? 9 : null, 10))];
  const cats = g.buildCategories(raw, {});
  assert.deepEqual(cats.map((c) => c.name), ['Group Project', 'Weekly Progress Report']);
  assert.equal(cats[1].itemNames.length, 5);
  assert.equal(cats[1].pct, 90, '18 / 20 on the two graded reports');
  assert.equal(g.itemSummary(cats[1]), weeks.join(', '), 'list shows just the dates');
});

test('itemSummary falls back to full names when items do not share the group name', () => {
  assert.equal(g.itemSummary({ name: 'HW', itemNames: ['HW01', 'HW02'] }), 'HW01, HW02', 'glued-on numbers keep full names');
  assert.equal(g.itemSummary({ name: 'Quiz', itemNames: ['Quiz 1', 'Quiz #2'] }), '1, #2');
  assert.equal(g.itemSummary({ name: 'Late work', itemNames: ['HW02', 'Quiz 3'] }), 'HW02, Quiz 3');
});

test('auto groups need two or more items with the same base name', () => {
  const cats = g.buildCategories([...FLAT, loose('Project 1', 90, 100)], {});
  assert.deepEqual(cats.map((c) => c.name), ['HW', 'GroupProj', 'Project 1']);
  const hw = cats[0];
  assert.equal(hw.pct, (50 / 60) * 100, 'ungraded HW03 skipped');
  assert.equal(hw.graded, 2);
  assert.equal(hw.total, 3);
});

test('moving an item to another group', () => {
  const cats = g.buildCategories(FLAT, { HW02: 'Late work' });
  // Groups appear in the order their first item appears on the page.
  assert.deepEqual(cats.map((c) => [c.name, c.itemNames]), [
    ['HW', ['HW01', 'HW03']], ['Late work', ['HW02']], ['GroupProj', ['GroupProj']],
  ]);
});

test('moving an item into a real D2L category (case-insensitive)', () => {
  const raw = [
    { name: 'Quizzes', d2lPct: 80, loose: false, items: [item('Quiz 1', 8, 10)] },
    loose('Bonus quiz', 10, 10),
  ];
  const cats = g.buildCategories(raw, { 'Bonus quiz': 'quizzes' });
  assert.equal(cats.length, 1);
  assert.equal(cats[0].name, 'Quizzes');
  assert.equal(cats[0].pct, 90);
  assert.equal(cats[0].d2lPct, 80, 'real category keeps D2L %');
});

test('blank override means automatic', () => {
  assert.deepEqual(g.buildCategories(FLAT, { HW01: '   ' }).map((c) => c.name), ['HW', 'GroupProj']);
});

test('bonus and percentage-only items', () => {
  const raw = [{ name: 'C', d2lPct: null, loose: false, items: [
    item('A', 40, 50), item('Bonus', 5, 0), { name: 'P', earned: null, possible: null, pct: 90, excluded: false },
    { ...item('Dropped', 0, 50), excluded: true },
  ] }];
  const [c] = g.buildCategories(raw, {});
  assert.equal(c.pct, ((40 + 5 + 90) / 150) * 100);
  assert.equal(c.total, 3);
});

test('looseItemList for the group editor', () => {
  assert.deepEqual(g.looseItemList(FLAT), [
    { name: 'HW01', autoGroup: 'HW' }, { name: 'HW02', autoGroup: 'HW' },
    { name: 'GroupProj', autoGroup: 'GroupProj' }, { name: 'HW03', autoGroup: 'HW' },
  ]);
});

test('fitSharedSetup keeps only what fits this course', () => {
  const setup = {
    weights: { HW: 45, GroupProj: 15, Attendance: 10, Bad: -1, Str: '5' },
    groups: { HW01: 'HW', HW99: 'HW', GroupProj: '' },
  };
  assert.deepEqual(g.fitSharedSetup(setup, FLAT), { weights: { HW: 45, GroupProj: 15 }, groups: { HW01: 'HW' } });
  assert.deepEqual(g.fitSharedSetup(null, FLAT), { weights: {}, groups: {} });
});

test('fitSharedSetup applies group moves before matching weights', () => {
  const fitted = g.fitSharedSetup({ weights: { 'Late work': 5 }, groups: { HW02: 'Late work' } }, FLAT);
  assert.deepEqual(fitted, { weights: { 'Late work': 5 }, groups: { HW02: 'Late work' } });
});

test('sameSetup ignores key order', () => {
  assert.ok(g.sameSetup({ weights: { a: 1, b: 2 }, groups: {} }, { weights: { b: 2, a: 1 }, groups: undefined }));
  assert.ok(!g.sameSetup({ weights: { a: 1 }, groups: {} }, { weights: { a: 2 }, groups: {} }));
});
