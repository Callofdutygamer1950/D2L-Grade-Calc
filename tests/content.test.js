import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDom, CATEGORIZED, FLAT } from './helpers/d2l-page.js';
import { runInWindow } from './helpers/load.js';
import { fakeChrome, tick } from './helpers/fake-chrome.js';

const COURSE = 'sru.desire2learn.com:4066209';
const plain = (x) => JSON.parse(JSON.stringify(x));

// Loads the content script on a fake D2L page. `shared` is what the background
// script answers for fetchShared (null = nothing shared).
async function openPage(rows, { initial = {}, shared = null, enrollment = true } = {}) {
  const dom = makeDom(rows);
  const { window } = dom;
  const chrome = fakeChrome({
    initial,
    onMessage: (msg) => (msg.type === 'fetchShared' ? { ok: true, result: shared } : undefined),
  });
  window.chrome = chrome.api;
  window.fetch = async (url) => ({
    ok: enrollment,
    status: enrollment ? 200 : 403,
    json: async () => ({ OrgUnit: { Code: '31427.202630', Name: 'CPSC-374-01 - Algorithms and Data Structures' } }),
    url,
  });
  runInWindow(window, ['grades-core.js', 'grouping.js', 'content.js']);
  await tick(20);
  const shadow = () => window.document.getElementById('d2l-grade-calc').shadowRoot;
  const $ = (id) => shadow().getElementById(id);
  return { window, chrome, shadow, $ };
}

test('badge appears in the title row and asks for weights before showing a grade', async () => {
  const { window, chrome, $ } = await openPage(CATEGORIZED);
  const host = window.document.getElementById('d2l-grade-calc');
  assert.equal(host.parentElement.id, 'd_page_header');
  assert.equal($('pct').textContent, 'Please input weights');
  assert.equal($('title').textContent, 'Grade not shown yet');
  assert.equal($('usePoints').hidden, false);
  assert.ok($('weights').classList.contains('primary'), 'Set weights is highlighted');
  $('toggle').click();
  assert.equal($('pointsLine').hidden, true, 'points total (which is the grade) is hidden too');

  const info = chrome.data['info:' + COURSE];
  assert.equal(info.courseName, 'CPSC-374-01 - Algorithms and Data Structures');
  assert.equal(info.rawGroups.length, 5);
  assert.deepEqual(plain(info.meta), { host: 'sru.desire2learn.com', ou: '4066209', courseCode: 'CPSC-374', term: '202630' });
});

test('"Use total points" shows the points grade, is remembered, and can be undone', async () => {
  const { chrome, $ } = await openPage(CATEGORIZED);
  $('usePoints').click();
  assert.equal($('pct').textContent, '81.22%'); // 333 / 410
  assert.match($('sub').textContent, /Total points/);
  assert.equal($('usePoints').hidden, true);
  await tick(5);
  assert.equal(chrome.data['points:' + COURSE], true);

  $('toggle').click();
  assert.match($('pointsText').textContent, /333 \/ 410 points/);
  assert.equal($('pointsChoice').hidden, false);
  $('stopPoints').click();
  await tick(5);
  assert.equal($('pct').textContent, 'Please input weights');
  assert.equal(chrome.data['points:' + COURSE], undefined);
});

test('the total-points choice is loaded on the next visit', async () => {
  const { $ } = await openPage(CATEGORIZED, { initial: { ['points:' + COURSE]: true } });
  assert.equal($('pct').textContent, '81.22%');
});

test('typing a weight replaces the prompt with the weighted grade', async () => {
  const { window, shadow, $ } = await openPage(CATEGORIZED);
  $('toggle').click();
  const input = shadow().querySelector('input[data-name="Quizzes"]');
  input.value = '100';
  input.dispatchEvent(new window.Event('input'));
  assert.equal($('pct').textContent, '78.67%');
  assert.equal($('usePoints').hidden, true);
});

test('course identity falls back to the page title when D2L refuses', async () => {
  const { chrome } = await openPage(CATEGORIZED, { enrollment: false });
  assert.deepEqual(plain(chrome.data['info:' + COURSE].meta),
    { host: 'sru.desire2learn.com', ou: '4066209', courseCode: 'CPSC-374', term: null });
});

test('saved weights are used, and typing in Breakdown updates and saves them', async () => {
  const { window, chrome, shadow, $ } = await openPage(CATEGORIZED, {
    initial: { ['weights:' + COURSE]: { Quizzes: 20, Assignments: 30, Exams: 40, Participation: 10 }, ['source:' + COURSE]: { from: 'user' } },
  });
  assert.equal($('pct').textContent, '83.23%');
  assert.match($('sub').textContent, /your category weights/);
  assert.equal(chrome.sent.filter((m) => m.type === 'fetchShared').length, 0, 'own setup: nothing fetched');
  assert.deepEqual(plain(chrome.sent.filter((m) => m.type === 'shareNow')), [{ type: 'shareNow', course: COURSE }],
    'own setup re-sent on load in case an earlier upload failed');

  $('toggle').click();
  const inputs = [...shadow().querySelectorAll('input[type="number"]')];
  assert.deepEqual(inputs.map((i) => i.dataset.name), ['Quizzes', 'Assignments', 'Exams', 'Participation', 'Syllabus Quiz']);
  assert.equal(shadow().activeElement, inputs[0], 'first box is focused');

  inputs[3].value = '';
  inputs[3].dispatchEvent(new window.Event('input'));
  assert.equal($('wTotal').textContent, '90%');
  assert.match($('warnings').textContent, /add up to 90%/);
  assert.equal(shadow().querySelector('input[data-name="Participation"]'), inputs[3], 'box not rebuilt while typing');

  await tick(450); // autosave debounce
  assert.deepEqual(plain(chrome.data['weights:' + COURSE]), { Quizzes: 20, Assignments: 30, Exams: 40 });
  assert.deepEqual(plain(chrome.data['source:' + COURSE]), { from: 'user' });
  assert.equal(shadow().querySelector('input[data-name="Exams"]'), inputs[2], 'autosave did not steal focus/rebuild');
});

test('Escape and clicking elsewhere close Breakdown', async () => {
  const { window, $ } = await openPage(CATEGORIZED);
  $('toggle').click();
  assert.ok($('wTotal'));
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal($('wTotal'), null);
  $('toggle').click();
  window.document.body.click();
  assert.equal($('wTotal'), null);
});

test('Set weights and Edit groups ask the background to open the weights page', async () => {
  const { chrome, $ } = await openPage(FLAT);
  $('weights').click();
  $('toggle').click();
  $('editGroups').click();
  assert.deepEqual(plain(chrome.sent.filter((m) => m.type === 'openWeights')), [
    { type: 'openWeights', course: COURSE },
    { type: 'openWeights', course: COURSE, section: 'groups' },
  ]);
});

test('a course you have not set up uses the most popular shared setup', async () => {
  const shared = { setup: { weights: { Quizzes: 20, Assignments: 50, Exams: 30, Gone: 5 } }, students: 3, scope: 'section' };
  const { chrome, $ } = await openPage(CATEGORIZED, { shared });
  await tick(20);
  assert.deepEqual(plain(chrome.data['weights:' + COURSE]), { Quizzes: 20, Assignments: 50, Exams: 30 }, 'unknown category dropped');
  assert.deepEqual(plain(chrome.data['source:' + COURSE]), { from: 'shared', students: 3, scope: 'section' });
  assert.equal($('sub').textContent, 'Weights shared by 3 students');
});

test('shared setup from another section is labelled', async () => {
  const shared = { setup: { weights: { Quizzes: 100 } }, students: 1, scope: 'course' };
  const { $ } = await openPage(CATEGORIZED, { shared });
  await tick(20);
  assert.equal($('sub').textContent, 'Weights shared by 1 student in another section');
});

test('a shared setup that fits nothing here is ignored', async () => {
  const { chrome } = await openPage(CATEGORIZED, { shared: { setup: { weights: { Other: 50 } }, students: 9, scope: 'course' } });
  await tick(20);
  assert.equal(chrome.data['weights:' + COURSE], undefined);
  assert.equal(chrome.data['source:' + COURSE], undefined);
});

test('a shared setup keeps updating until you change it', async () => {
  const { chrome, $ } = await openPage(CATEGORIZED, {
    initial: { ['weights:' + COURSE]: { Quizzes: 50 }, ['source:' + COURSE]: { from: 'shared', students: 1, scope: 'section' } },
    shared: { setup: { weights: { Quizzes: 25, Exams: 75 } }, students: 4, scope: 'section' },
  });
  await tick(20);
  assert.deepEqual(plain(chrome.data['weights:' + COURSE]), { Quizzes: 25, Exams: 75 });
  assert.equal($('sub').textContent, 'Weights shared by 4 students');
});

test('weights set before sharing existed become yours (and get shared)', async () => {
  const { chrome } = await openPage(CATEGORIZED, { initial: { ['weights:' + COURSE]: { Quizzes: 50 } }, shared: { setup: { weights: { Quizzes: 1 } }, students: 9 } });
  await tick(20);
  assert.deepEqual(plain(chrome.data['source:' + COURSE]), { from: 'user' });
  assert.deepEqual(plain(chrome.data['weights:' + COURSE]), { Quizzes: 50 }, 'not replaced by shared');
});

test('if you cleared your own weights, shared ones are not pulled back in', async () => {
  const { chrome } = await openPage(CATEGORIZED, {
    initial: { ['source:' + COURSE]: { from: 'user' } },
    shared: { setup: { weights: { Quizzes: 20 } }, students: 5, scope: 'section' },
  });
  await tick(20);
  assert.equal(chrome.data['weights:' + COURSE], undefined);
  assert.equal(chrome.sent.filter((m) => m.type === 'fetchShared').length, 0);
});

test('changes from the weights page redraw the badge (groups and weights)', async () => {
  const { chrome, shadow, $ } = await openPage(FLAT);
  await chrome.api.storage.local.set({ ['groups:' + COURSE]: { HW05: 'Late' }, ['weights:' + COURSE]: { HW: 50, GroupProj: 50 } });
  $('toggle').click();
  assert.deepEqual([...shadow().querySelectorAll('input[type="number"]')].map((i) => i.dataset.name), ['HW', 'GroupProj', 'Late']);
  assert.match($('warnings').textContent, /No weight set for: Late/);
});

test('groups in Breakdown list their items', async () => {
  const { shadow, $ } = await openPage(FLAT);
  $('toggle').click();
  assert.match(shadow().querySelector('tbody tr td').textContent, /HW01, HW02, HW03, HW04, HW05/);
});

test('badge fades out while scrolling down', async () => {
  const { window } = await openPage(CATEGORIZED);
  const host = window.document.getElementById('d2l-grade-calc');
  const scrollTo = (y) => {
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
    window.dispatchEvent(new window.Event('scroll'));
  };
  scrollTo(70);
  assert.equal(host.style.opacity, '0.5');
  scrollTo(400);
  assert.equal(host.style.visibility, 'hidden');
  scrollTo(0);
  assert.equal(host.style.opacity, '1');
  assert.equal(host.style.visibility, 'visible');
});

test('badge stays fully visible while the Breakdown is open, fades again once closed', async () => {
  const { window, $ } = await openPage(CATEGORIZED);
  const host = window.document.getElementById('d2l-grade-calc');
  const scrollTo = (y) => {
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
    window.dispatchEvent(new window.Event('scroll'));
  };
  $('toggle').click();
  scrollTo(400);
  assert.equal(host.style.opacity, '1');
  assert.equal(host.style.visibility, 'visible');
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(host.style.visibility, 'hidden', 'closing at 400px down applies the fade right away');
});

test('grouping note matches the course: no categories vs some items outside categories', async () => {
  const flat = await openPage(FLAT);
  flat.$('toggle').click();
  assert.match(flat.shadow().querySelector('.details').textContent, /doesn't use D2L categories/);
  const mixed = await openPage(CATEGORIZED); // has categories plus "Syllabus Quiz" outside them
  mixed.$('toggle').click();
  assert.match(mixed.shadow().querySelector('.details').textContent, /Items outside D2L categories were grouped by name/);
});

test('pages without a grades table are left alone', async () => {
  const { JSDOM } = await import('jsdom');
  const { window } = new JSDOM('<html><body><h1>Not grades</h1></body></html>', { url: 'https://sru.desire2learn.com/d2l/lms/grades/my_grades/main.d2l?ou=1', runScripts: 'outside-only' });
  window.chrome = fakeChrome().api;
  runInWindow(window, ['grades-core.js', 'grouping.js', 'content.js']);
  assert.equal(window.document.getElementById('d2l-grade-calc'), null);
});

test('course names are escaped (no HTML injection from D2L item names)', async () => {
  const { shadow, $ } = await openPage([{ category: '<img src=x onerror=alert(1)>', grade: '90 %' }, { item: 'A', points: '9 / 10', grade: '90 %' }]);
  $('toggle').click();
  assert.equal(shadow().querySelector('img'), null);
  assert.match(shadow().querySelector('tbody td').textContent, /<img src=x/);
});
