import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdfToText } from '../extension/pdf-text.js';
import { matchWeights } from '../extension/syllabus-parse.js';

// Each page: [{ x, y, text }]
async function makePdf(pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const items of pages) {
    const page = doc.addPage([612, 792]);
    for (const { x, y, text } of items) page.drawText(text, { x, y, size: 12, font });
  }
  return new Uint8Array(await doc.save());
}

test('two-column grading table comes out one row per line', async () => {
  const pdf = await makePdf([[
    { x: 72, y: 700, text: 'COURSE GRADES' },
    { x: 72, y: 670, text: 'Category' }, { x: 300, y: 670, text: 'Weight' },
    { x: 72, y: 650, text: 'Quizzes' }, { x: 300, y: 650, text: '20%' },
    { x: 72, y: 630, text: 'Assignments' }, { x: 300, y: 630, text: '30%' },
    { x: 72, y: 610, text: 'Exams' }, { x: 300, y: 610, text: '50%' },
  ]]);
  const text = await pdfToText(pdfjsLib, pdf);
  const lines = text.split('\n').filter(Boolean);
  assert.ok(lines.includes('Quizzes 20%'), `got lines: ${JSON.stringify(lines)}`);
  assert.ok(lines.includes('Exams 50%'));
  const r = matchWeights(['Quizzes', 'Assignments', 'Exams'], text);
  assert.deepEqual(Object.fromEntries(Object.entries(r.results).map(([k, v]) => [k, v.value])),
    { Quizzes: 20, Assignments: 30, Exams: 50 });
});

test('pieces drawn right next to each other are not split by spaces', async () => {
  const pdf = await makePdf([[{ x: 72, y: 700, text: 'Quiz' }, { x: 72 + 24.0, y: 700, text: 'zes 20%' }]]);
  const text = await pdfToText(pdfjsLib, pdf);
  assert.match(text, /Quiz ?zes 20%/);
});

test('multi-page PDFs and points tables', async () => {
  const pdf = await makePdf([
    [{ x: 72, y: 700, text: 'Course policies and other text on page one.' }],
    [
      { x: 72, y: 700, text: 'Category Points' },
      { x: 72, y: 680, text: 'Homework' }, { x: 300, y: 680, text: '300' },
      { x: 72, y: 660, text: 'Project' }, { x: 300, y: 660, text: '200' },
      { x: 72, y: 640, text: 'Total' }, { x: 300, y: 640, text: '500' },
    ],
  ]);
  const text = await pdfToText(pdfjsLib, pdf);
  const r = matchWeights(['HW', 'Project'], text);
  assert.equal(r.source, 'points-table');
  assert.equal(r.total, 500);
  assert.equal(r.results.HW.value, 60);
  assert.equal(r.results.Project.value, 40);
});

test('a file that is not a PDF fails with an error (shown to the user)', async () => {
  await assert.rejects(pdfToText(pdfjsLib, new TextEncoder().encode('not a pdf')));
});
