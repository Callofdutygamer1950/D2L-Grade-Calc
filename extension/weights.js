import * as pdfjsLib from './lib/pdf.min.js';
import { matchWeights } from './syllabus-parse.js';
import { pdfToText } from './pdf-text.js';

const api = globalThis.browser ?? globalThis.chrome;
pdfjsLib.GlobalWorkerOptions.workerSrc = api.runtime.getURL('lib/pdf.worker.min.js');

const $ = (id) => document.getElementById(id);
const courseKey = new URLSearchParams(location.search).get('course') || '';
const weightsKey = 'weights:' + courseKey;
const groupsKey = 'groups:' + courseKey;
const infoKey = 'info:' + courseKey;
const sourceKey = 'source:' + courseKey;
const MINE = { from: 'user' }; // marks a setup as the user's own, so it gets shared
const fmt = (n) => (n == null ? '–' : (Math.round(n * 100) / 100).toFixed(2) + '%');
const { buildCategories, looseItemList, itemSummary } = globalThis.D2LGrouping;

let categories = [];
let rawGroups = [];
let groupOverrides = {};

function readInputs() {
  const out = {};
  for (const input of document.querySelectorAll('#rows input')) {
    const v = parseFloat(input.value);
    if (Number.isFinite(v) && v > 0) out[input.dataset.name] = v;
  }
  return out;
}

function updateTotal() {
  const w = readInputs();
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  $('total').textContent = +total.toFixed(2) + '%';
  const warn = $('totalWarn');
  if (Object.keys(w).length && Math.abs(total - 100) > 0.01) {
    warn.hidden = false;
    warn.textContent = `Weights add up to ${+total.toFixed(2)}%. Most courses add up to 100%. The grade is still calculated using only the categories you weighted.`;
  } else {
    warn.hidden = true;
  }
}

function renderRows(saved) {
  const tbody = $('rows');
  tbody.textContent = '';
  for (const c of categories) {
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    nameTd.textContent = c.name;
    if (c.fromLoose && (c.itemNames.length > 1 || c.itemNames[0] !== c.name)) {
      const items = document.createElement('span');
      items.className = 'hint';
      items.textContent = itemSummary(c);
      nameTd.appendChild(items);
    }
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.dataset.hintFor = c.name;
    nameTd.appendChild(hint);

    const gradeTd = document.createElement('td');
    gradeTd.className = 'num';
    gradeTd.textContent = c.pct == null ? 'Not graded' : fmt(c.pct);

    const wTd = document.createElement('td');
    wTd.className = 'num';
    const wrap = document.createElement('span');
    wrap.className = 'pct-wrap';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '100';
    input.step = 'any';
    input.dataset.name = c.name;
    input.setAttribute('aria-label', `Weight for ${c.name}`);
    if (typeof saved[c.name] === 'number') input.value = saved[c.name];
    input.addEventListener('input', () => {
      input.classList.remove('filled');
      updateTotal();
    });
    wrap.append(input, document.createTextNode('%'));
    wTd.appendChild(wrap);

    tr.append(nameTd, gradeTd, wTd);
    tbody.appendChild(tr);
  }
  updateTotal();
}

function setStatus(el, text, isErr = false) {
  el.textContent = text;
  el.classList.toggle('err', isErr);
}

async function findWeights() {
  const st = $('findStatus');
  const file = $('pdf').files[0];
  const pasted = $('paste').value.trim();
  if (!file && !pasted) {
    setStatus(st, 'Choose a PDF or paste some text first.', true);
    return;
  }

  let text = pasted;
  if (file) {
    setStatus(st, 'Reading PDF…');
    try {
      text = (await pdfToText(pdfjsLib, new Uint8Array(await file.arrayBuffer()))) + (pasted ? '\n' + pasted : '');
    } catch (err) {
      setStatus(st, `Couldn't read that PDF (${err.message || err}). Try pasting the text instead.`, true);
      return;
    }
  }

  const { results, source, found, total } = matchWeights(categories.map((c) => c.name), text);

  let filled = 0;
  for (const c of categories) {
    const input = document.querySelector(`#rows input[data-name="${CSS.escape(c.name)}"]`);
    const hint = document.querySelector(`#rows [data-hint-for="${CSS.escape(c.name)}"]`);
    const r = results[c.name];
    hint.className = 'hint';
    hint.textContent = '';
    if (r) {
      input.value = r.value;
      input.classList.add('filled');
      hint.textContent = (r.confidence === 'check' ? 'Check: ' : 'From: ') + r.from.join(' + ');
      if (r.confidence === 'check') hint.classList.add('check');
      filled++;
    }
  }
  updateTotal();

  if (!found.length) {
    setStatus(st, 'No grade weights or point values found in that syllabus. Enter the weights by hand.', true);
  } else if (!filled) {
    setStatus(st, "Found some numbers but couldn't match them to this course's categories. Enter the weights by hand.", true);
  } else {
    setStatus(st, `Filled ${filled} of ${categories.length} categories. Check them, then click Save weights.`);
  }

  const list = $('foundList');
  list.textContent = '';
  for (const e of found) {
    const li = document.createElement('li');
    li.textContent = `${e.label}: ${e.value}${e.unit === '%' ? '%' : ' points'}`;
    if (e.used) li.className = 'block';
    list.appendChild(li);
  }
  const notes = {
    percent: 'These lines add up to 100%, so they look like the grading breakdown. Bold ones were used.',
    'points-table': `The syllabus grades by points (total ${total}). Each weight is that category's points ÷ ${total}. Bold ones were used.`,
    'points-inline': `The syllabus grades by points. Each weight is that category's points ÷ ${total}, the total of the bold lines.`,
    'percent-loose': 'No group of lines added up to 100%, so matches were taken from anywhere in the text. Double-check them.',
  };
  $('foundNote').textContent = notes[source] || 'None of these matched a category name.';
  $('found').hidden = found.length === 0;
}

// ---------- Groups for courses without D2L categories ----------

function renderGroupEditor() {
  const items = looseItemList(rawGroups);
  $('groups').hidden = items.length === 0;
  if (!items.length) return;

  const list = $('groupNames');
  list.textContent = '';
  for (const c of categories) {
    const opt = document.createElement('option');
    opt.value = c.name;
    list.appendChild(opt);
  }

  const tbody = $('groupRows');
  tbody.textContent = '';
  for (const it of items) {
    const tr = document.createElement('tr');
    const nameTd = document.createElement('td');
    nameTd.textContent = it.name;
    const groupTd = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'group';
    input.setAttribute('list', 'groupNames');
    input.setAttribute('aria-label', `Group for ${it.name}`);
    input.value = groupOverrides[it.name] || it.autoGroup;
    input.placeholder = it.autoGroup;
    input.classList.toggle('moved', !!groupOverrides[it.name]);
    input.addEventListener('change', () => setGroup(it, input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
    });
    groupTd.appendChild(input);
    tr.append(nameTd, groupTd);
    tbody.appendChild(tr);
  }
}

async function setGroup(item, value) {
  const v = value.trim();
  if (!v || v === item.autoGroup) delete groupOverrides[item.name];
  else groupOverrides[item.name] = v;
  await saveGroups(`Moved ${item.name} to “${v || item.autoGroup}”.`);
}

async function saveGroups(message) {
  if (Object.keys(groupOverrides).length) {
    await api.storage.local.set({ [groupsKey]: groupOverrides, [sourceKey]: MINE });
  } else {
    await api.storage.local.remove(groupsKey);
    await api.storage.local.set({ [sourceKey]: MINE });
  }
  // Keep whatever weights are typed in (saved or not) while the rows are rebuilt.
  const typed = readInputs();
  categories = buildCategories(rawGroups, groupOverrides);
  renderRows(typed);
  renderGroupEditor();
  setStatus($('groupStatus'), message + ' Your D2L tab has updated.');
}

// "Fill from syllabus" goes first while the course has no saved weights (that's the
// quickest way to get them), and back under the weights table once some are saved.
// Based on saved weights, not typed ones, so the page never jumps while typing.
function placeSyllabus(hasSavedWeights, keepEditorInView) {
  const syllabus = $('syllabus');
  const editor = $('editor');
  const atTop = syllabus.nextElementSibling === editor;
  if (!hasSavedWeights && !atTop) editor.before(syllabus);
  if (hasSavedWeights && atTop) $('sharing').before(syllabus);
  $('startHere').hidden = hasSavedWeights;
  $('boxesWhere').textContent = hasSavedWeights ? 'above' : 'below';
  // The Save/Clear buttons the user just clicked shift when the section moves; keep them visible.
  if (keepEditorInView && atTop !== !hasSavedWeights) editor.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

async function init() {
  const res = await api.storage.local.get([infoKey, weightsKey, groupsKey, sourceKey]);
  const info = res[infoKey];
  if (!courseKey || !info || !Array.isArray(info.rawGroups) || !info.rawGroups.length) {
    // Also covers info saved by an older version of the extension.
    $('missing').hidden = false;
    return;
  }
  rawGroups = info.rawGroups;
  groupOverrides = res[groupsKey] || {};
  categories = buildCategories(rawGroups, groupOverrides);
  $('course').textContent = info.courseName || courseKey;
  document.title = 'Grade Weights · ' + (info.courseName || 'D2L');
  $('editor').hidden = false;
  $('syllabus').hidden = false;
  renderRows(res[weightsKey] || {});
  placeSyllabus(Object.keys(res[weightsKey] || {}).length > 0, false);
  renderGroupEditor();
  $('resetGroups').addEventListener('click', () => {
    groupOverrides = {};
    saveGroups('Groups reset to automatic.');
  });
  if (location.hash === '#groups' && !$('groups').hidden) $('groups').scrollIntoView();

  $('save').addEventListener('click', async () => {
    const saved = readInputs();
    await api.storage.local.set({ [weightsKey]: saved, [sourceKey]: MINE });
    document.querySelectorAll('#rows input.filled').forEach((i) => i.classList.remove('filled'));
    setStatus($('status'), 'Saved. Your D2L tab has updated.');
    placeSyllabus(Object.keys(saved).length > 0, true);
  });
  $('clear').addEventListener('click', async () => {
    await api.storage.local.remove(weightsKey);
    await api.storage.local.set({ [sourceKey]: MINE });
    renderRows({});
    setStatus($('status'), 'Cleared. The badge will ask for weights again.');
    placeSyllabus(false, true);
  });
  $('find').addEventListener('click', findWeights);

  // Sharing switch (one setting for all courses). Set up last: it waits on the background script.
  const status = await api.runtime.sendMessage({ type: 'sharingStatus' }).catch(() => null);
  $('sharing').hidden = false;
  const toggle = $('shareToggle');
  if (!status || !status.configured) {
    toggle.disabled = true;
    $('shareStatus').textContent = 'Sharing isn’t set up in this copy of the extension yet.';
  } else {
    toggle.checked = status.enabled;
    const src = res[sourceKey];
    $('shareStatus').textContent = src && src.from === 'shared'
      ? `This course is using weights shared by ${src.students} student${src.students === 1 ? '' : 's'}` +
        (src.scope === 'course' ? ' in another section.' : '.') + ' Changing anything here makes them your own.'
      : '';
    toggle.addEventListener('change', async () => {
      await api.storage.local.set({ shareEnabled: toggle.checked });
      $('shareStatus').textContent = toggle.checked
        ? 'Sharing is on.'
        : 'Sharing is off. Nothing new will be uploaded or downloaded.';
    });
  }
}

init();
