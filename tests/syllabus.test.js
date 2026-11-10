import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers/load.js';
import { matchWeights, findPercentEntries, findPointsTable, findInlinePoints, tokens } from '../extension/syllabus-parse.js';

const fixture = (name) => fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'syllabi', name), 'utf8');
const values = (r) => Object.fromEntries(Object.entries(r.results).map(([k, v]) => [k, v.value]));
const QAE = ['Quizzes', 'Assignments', 'Exams'];

// ---------- Made-up syllabi, one per format ----------

test('leader dots, with a grading scale and Total line ignored', () => {
  const r = matchWeights(QAE, 'Grading\nQuizzes ........ 20%\nAssignments .... 30%\nExams .......... 50%\nTotal 100%\nA 93-100%\nA- 90-92.99%\nB+ 87%');
  assert.equal(r.source, 'percent');
  assert.deepEqual(values(r), { Quizzes: 20, Assignments: 30, Exams: 50 });
  assert.ok(Object.values(r.results).every((x) => x.confidence === 'high'));
});

test('synonyms and combining Midterm + Final into Exams', () => {
  const r = matchWeights(QAE, 'Late homework loses 10% per day.\nHomework 30%\nWeekly Quizzes 15%\nMidterm Exam 25%\nFinal Exam 30%\nScale: 90% - 100% A');
  assert.deepEqual(values(r), { Quizzes: 15, Assignments: 30, Exams: 55 });
  assert.equal(r.results.Exams.confidence, 'check', 'combined values are flagged');
});

test('percent before label', () => {
  assert.deepEqual(values(matchWeights(QAE, '20% Quizzes\n35% Programming Assignments\n45% Exams (2)')),
    { Quizzes: 20, Assignments: 35, Exams: 45 });
});

test('several on one line, and sentences', () => {
  assert.deepEqual(values(matchWeights(QAE, 'Your grade: Quizzes 25%, Assignments 25%, Exams 50%.')),
    { Quizzes: 25, Assignments: 25, Exams: 50 });
  const r = matchWeights(QAE, 'Quizzes will count for 20% of your grade. Assignments are worth 40% and exams 40%.');
  assert.deepEqual(values(r), { Quizzes: 20, Assignments: 40, Exams: 40 });
  assert.equal(r.results.Quizzes.from[0], 'Quizzes 20%', 'trailing filler words trimmed');
});

test('"percent" written out', () => {
  assert.deepEqual(values(matchWeights(['Labs', 'Exams'], 'Labs are 40 percent\nExams are 60 percent')), { Labs: 40, Exams: 60 });
});

test('points table converts to percent of total', () => {
  const text = 'Category Points\nAssignments 600\nQuizzes 150\n3\nExams 250\nTotal 1,000';
  const table = findPointsTable(text);
  assert.equal(table.total, 1000);
  assert.equal(table.entries.length, 3, 'page number line skipped');
  const r = matchWeights(QAE, text);
  assert.equal(r.source, 'points-table');
  assert.deepEqual(values(r), { Assignments: 60, Quizzes: 15, Exams: 25 });
});

test('inline points ignore sentences', () => {
  const text = 'Discussion Board (300 Points)\nAll discussion boards are worth 50 points and have\nQuizzes (10x50 =500 Points)\nFinal Exam: 200 points';
  assert.deepEqual(findInlinePoints(text).map((e) => [e.label, e.value]),
    [['Discussion Board', 300], ['Quizzes', 500], ['Final Exam', 200]]);
  assert.deepEqual(values(matchWeights(['Discussions', 'Quizzes', 'Final Exam'], text)),
    { Discussions: 30, Quizzes: 50, 'Final Exam': 20 });
});

test('nothing to find', () => {
  const r = matchWeights(QAE, 'Grades are calculated by Brightspace.');
  assert.equal(r.source, null);
  assert.deepEqual(r.results, {});
  assert.deepEqual(findPercentEntries(''), []);
});

test('tokens: plurals, synonyms, abbreviations, camelCase', () => {
  assert.deepEqual(tokens('Quizzes'), ['quiz']);
  assert.deepEqual(tokens('Homework'), ['assignment']);
  assert.deepEqual(tokens('HW'), ['assignment']);
  assert.deepEqual(tokens('GroupProj'), ['group', 'project']);
  assert.deepEqual(tokens('The mid-term exam'), ['midterm', 'exam']);
  assert.deepEqual(tokens('Activities'), ['activity']);
});

test('very long lines stay fast', () => {
  const nasty = [
    'Category Points\nA' + '.-'.repeat(10000) + 'x',
    'Quizzes 1% '.repeat(5000),
    'a'.repeat(50000) + ' 20%',
    'Label (' + '1x'.repeat(10000) + ' points)',
    'Category Points\n' + 'word '.repeat(4000),
  ];
  for (const text of nasty) {
    const start = performance.now();
    matchWeights(['Quizzes', 'Exams'], text);
    assert.ok(performance.now() - start < 250, `took ${performance.now() - start} ms on ${text.slice(0, 30)}…`);
  }
});

// ---------- Real syllabi (text extracted from the PDFs with pdf.js) ----------
// Category names are the likely D2L names for each course.

const REAL = [
  ['cpsc300.txt', ['Assignments', 'Quizzes', 'Discussions', 'Case Study'], 'percent',
    { Assignments: 45, Quizzes: 15, Discussions: 15, 'Case Study': 25 }],
  ['cpsc237.txt', ['Homework', 'Group Project', 'Project', 'Attendance'], 'points-table',
    { Homework: 45.45, 'Group Project': 15.15, Project: 30.3, Attendance: 9.09 }],
  ['cpsc237.txt', ['HW', 'GroupProj'], 'points-table', { HW: 45.45, GroupProj: 15.15 }],
  ['cpsc374.txt', ['Quizzes', 'Assignments', 'Exams'], 'points-table', { Quizzes: 20, Assignments: 50, Exams: 30 }],
  ['mis413.txt', ['Discussions', 'Quizzes', 'Assignments', 'Research Paper', 'Final Exam'], 'points-inline',
    { Discussions: 19.13, Quizzes: 42.62, Assignments: 16.39, 'Research Paper': 10.93, 'Final Exam': 10.93 }],
  ['mgmt320.txt', ['Homework', 'Quizzes', 'Exams'], 'percent', { Homework: 25, Quizzes: 30, Exams: 45 }],
  ['mis265.txt', ['MyLab', 'Assignments', 'Quizzes', 'Final Exam', 'Outcomes Assessment'], 'percent',
    { MyLab: 15, Assignments: 39, Quizzes: 25, 'Final Exam': 20, 'Outcomes Assessment': 1 }],
  ['cpsc327.txt', ['Participation & Labs', 'Homework', 'Group Project', 'Quizzes', 'Tests'], 'percent',
    { 'Participation & Labs': 25, Homework: 30, 'Group Project': 10, Quizzes: 17.5, Tests: 17.5 }],
  ['cpsc423.txt', ['Quizzes', 'Labs', 'Midterm Exam', 'Research Paper'], 'percent',
    { Quizzes: 40, Labs: 20, 'Midterm Exam': 20, 'Research Paper': 20 }],
  ['cpsc365.txt', ['Quizzes', 'Homework', 'Project', 'Exams'], 'percent',
    { Quizzes: 40, Homework: 10, Project: 10, Exams: 40 }],
  ['css120.txt', ['Discussions', 'Attendance'], null, {}],
];

for (const [file, cats, source, expected] of REAL) {
  test(`real syllabus ${file} (${cats.join(', ')})`, () => {
    const r = matchWeights(cats, fixture(file));
    assert.equal(r.source, source);
    assert.deepEqual(values(r), expected);
  });
}
