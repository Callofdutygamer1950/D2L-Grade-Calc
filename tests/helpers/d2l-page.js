// Builds a fake D2L "My Grades" page with the same table markup as the real one
// (category rows are tr.d_ggl1 with a th spanning 2 columns; items have a tree-icon
// cell then a th; uncategorized items are top-level with a th spanning 2 columns).
import { JSDOM } from 'jsdom';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function categoryRow(name, grade) {
  return `<tr class="d_ggl1">
    <th scope="row" colspan="2" class="d_gt d_ich d2l-table-cell-first"><div class="dco"><div class="dco_c"><label>${esc(name)}</label></div></div></th>
    <td class="d_gn d_gr d_gt"></td>
    <td class="d_gn d_gr d_gt"><div class="dco"><div class="dco_c"><span>${esc(grade)}</span></div></div></td>
    <td class="d_gt d2l-table-cell-last"></td>
  </tr>`;
}

function itemRow(name, points, grade, comment = '') {
  return `<tr>
    <td class="d_g_treeNodeImage d_g_l_e d2l-table-cell-first"><img alt=""></td>
    <th scope="row" class="d_gt d_ich"><div class="dco"><div class="dco_c"><label>${esc(name)}</label></div></div></th>
    <td class="d_gn d_gr d_gt"><div class="dco"><div class="dco_c"><div>${esc(points)}</div></div></div></td>
    <td class="d_gn d_gr d_gt"><div class="dco"><div class="dco_c"><span>${esc(grade)}</span></div></div></td>
    <td class="d_gt d2l-table-cell-last">${esc(comment)}</td>
  </tr>`;
}

function looseRow(name, points, grade) {
  return `<tr>
    <th scope="row" colspan="2" class="d_gt d_ich d2l-table-cell-first"><div class="dco"><div class="dco_c"><label>${esc(name)}</label></div></div></th>
    <td class="d_gn d_gr d_gt"><div>${esc(points)}</div></td>
    <td class="d_gn d_gr d_gt"><span>${esc(grade)}</span></td>
    <td class="d_gt d2l-table-cell-last"></td>
  </tr>`;
}

// rows: [{ category, grade } | { item, points, grade, comment } | { loose, points, grade }]
export function gradesPageHtml(rows, { title = 'Grades - CPSC-374-01 - Algorithms and Data Structures - Slippery Rock University of Pennsylvania' } = {}) {
  const body = rows.map((r) => {
    if (r.category) return categoryRow(r.category, r.grade || '');
    if (r.loose) return looseRow(r.loose, r.points, r.grade);
    return itemRow(r.item, r.points, r.grade, r.comment);
  }).join('\n');
  return `<!doctype html><html><head><title>${esc(title)}</title></head><body>
    <div id="d_page_header" class="d2l-page-header"><div class="d2l-heading"><h1 id="d_page_title">Grades</h1></div></div>
    <table class="d2l-table d2l-grid d_gl" summary="List of grade items and their values">
      <tr class="d_gh d2l-table-row-first">
        <th scope="col" colspan="2" class="d_hch d_gl">Grade Item</th>
        <th scope="col" class="d_hch d_gr">Points</th>
        <th scope="col" class="d_hch d_gr">Grade</th>
        <th scope="col" class="d_hch d_gl">Comments and Assessments</th>
      </tr>
      ${body}
    </table></body></html>`;
}

// Like CPSC 374: categories, an ungraded item, a dropped item, a bonus item,
// a category with no items, and one uncategorized item.
export const CATEGORIZED = [
  { category: 'Quizzes', grade: '78.67 %' },
  { item: 'Quiz #1', points: '29 / 50', grade: '58 %' },
  { item: 'Quiz #2', points: '49 / 50', grade: '98 %' },
  { item: 'Quiz #3', points: '40 / 50', grade: '80 %' },
  { item: 'Quiz #4', points: '- / 50', grade: '-%' },
  { category: 'Assignments', grade: '80 %' },
  { item: 'Assignment 1', points: '45 / 50', grade: '90 %' },
  { item: 'Assignment 2', points: '70 / 100', grade: '70 %', comment: 'Exempt from late penalty' },
  { item: 'Assignment 3', points: '10 / 100 Dropped!', grade: '10 %' },
  { item: 'Extra Credit', points: '5 / 0', grade: '-%' },
  { category: 'Exams', grade: '85 %' },
  { item: 'Midterm', points: '85 / 100', grade: '85 %' },
  { item: 'Final', points: '- / 200', grade: '-%' },
  { category: 'Participation', grade: '95 %' },
  { loose: 'Syllabus Quiz', points: '10 / 10', grade: '100 %' },
];

// Like CPSC 237: no categories at all.
export const FLAT = [
  { loose: 'HW01', points: '16 / 16', grade: '100 %' },
  { loose: 'HW02', points: '22 / 22', grade: '100 %' },
  { loose: 'HW03', points: '32 / 32', grade: '100 %' },
  { loose: 'HW04', points: '45 / 46', grade: '97.83 %' },
  { loose: 'GroupProj', points: '43 / 50', grade: '86 %' },
  { loose: 'HW05', points: '35 / 36', grade: '97.22 %' },
];

export function makeDom(rows, opts) {
  return new JSDOM(gradesPageHtml(rows, opts), {
    url: 'https://sru.desire2learn.com/d2l/lms/grades/my_grades/main.d2l?ou=4066209',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
}
