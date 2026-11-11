// Runs on the D2L "My Grades" page. Reads the grades table, works out the overall
// grade, and shows it in a badge in the middle of the "Grades" title row.
(() => {
  'use strict';
  if (window.__d2lGradeCalcLoaded) return;
  window.__d2lGradeCalcLoaded = true;

  const api = globalThis.browser ?? globalThis.chrome;

  const { parseGradesTable, computeGrade, parseCourseMeta, courseNameFromTitle } = D2LGradesCore;


  // ---------- Badge ----------

  const table = document.querySelector('table.d2l-table.d2l-grid, table[summary="List of grade items and their values"]');
  if (!table || !table.rows.length) return;

  const ou = new URLSearchParams(location.search).get('ou') || 'unknown';
  const courseKey = location.host + ':' + ou;
  const weightsKey = 'weights:' + courseKey;
  const groupsKey = 'groups:' + courseKey;
  const sourceKey = 'source:' + courseKey; // {from: 'user'} or {from: 'shared', students, scope}
  const infoKey = 'info:' + courseKey;

  const courseName = courseNameFromTitle(document.title);

  const rawGroups = parseGradesTable(table);
  if (!rawGroups.length) return;
  const hasLoose = rawGroups.some((g) => g.loose);
  let groupOverrides = {};
  let categories = D2LGrouping.buildCategories(rawGroups, groupOverrides);

  // Save the raw table so the weights page can list categories and group loose items the same way.
  api.storage.local.set({
    [infoKey]: { courseName, url: location.href, rawGroups, updated: Date.now() },
  });

  // ---------- Course identity for sharing ----------
  // D2L's enrollment info gives e.g. Code "31427.202630" (CRN.term) and
  // Name "CPSC-374-01 - Algorithms and Data Structures".
  async function courseMeta() {
    let org = null;
    try {
      // Firefox: content.fetch makes the request as the page (with the D2L login);
      // a content script's own fetch may not send the page's cookies there.
      const pageFetch = typeof content !== 'undefined' && content && typeof content.fetch === 'function'
        ? content.fetch.bind(content) : fetch;
      const url = new URL(`/d2l/api/lp/1.30/enrollments/myenrollments/${encodeURIComponent(ou)}`, location.origin);
      const res = await pageFetch(url.href, { credentials: 'include' });
      if (res.ok) org = (await res.json()).OrgUnit || null;
    } catch (_) { /* fall back to the page title; sharing still works per section */ }
    return { host: location.host, ou, ...parseCourseMeta(org, courseName) };
  }

  const host = document.createElement('div');
  host.id = 'd2l-grade-calc';
  const shadow = host.attachShadow({ mode: 'open' });

  const header = document.getElementById('d_page_header');
  if (header) {
    if (getComputedStyle(header).position === 'static') header.style.position = 'relative';
    header.appendChild(host);
  } else {
    table.parentElement.insertBefore(host, table);
  }


  const fmt = (n) => (n == null ? '–' : (Math.round(n * 100) / 100).toFixed(2) + '%');
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  let weights = {};
  let source = null;
  // Until weights are set the badge asks for them instead of showing a grade.
  // "Use total points" (remembered per course, on this computer only) shows the points grade instead.
  let usePoints = false;
  const pointsKey = 'points:' + courseKey;
  let detailsOpen = false;
  let saveTimer = null;

  const STYLE = `
    :host { all: initial; font-family: inherit; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .badge {
      position: relative;
      display: flex; align-items: center; gap: 14px;
      padding: 8px 10px 8px 16px;
      background: #fff; color: #202122;
      border: 1px solid #cdd5dc; border-radius: 10px;
      box-shadow: 0 2px 8px rgba(0,0,0,.08);
      font-family: Lato, 'Lato', system-ui, -apple-system, 'Segoe UI', sans-serif;
      white-space: nowrap;
      /* On narrow screens: wrap the buttons under the grade instead of running off-screen. */
      flex-wrap: wrap; justify-content: center; row-gap: 8px;
      max-width: calc(100vw - 16px);
    }
    .pct { font-size: 26px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
    .pct.prompt { font-size: 18px; color: #006fbf; }
    .label button.link { font-size: 12px; text-align: left; }
    .label { display: flex; flex-direction: column; gap: 2px; }
    .label b { font-size: 13px; font-weight: 700; }
    .label span { font-size: 12px; color: #565a5c; }
    .actions { display: flex; gap: 6px; }
    button {
      font: inherit; font-size: 13px; cursor: pointer;
      padding: 6px 10px; border-radius: 6px;
      border: 1px solid #cdd5dc; background: #f1f5fb; color: #202122;
    }
    button:hover { background: #e3e9f1; }
    button.primary { background: #006fbf; border-color: #006fbf; color: #fff; }
    button.primary:hover { background: #005a9c; }
    button:focus-visible, input:focus-visible { outline: 2px solid #006fbf; outline-offset: 2px; }
    .warn { color: #b44d00; font-size: 12px; }
    .details {
      position: absolute; top: calc(100% + 6px); left: 50%; transform: translateX(-50%);
      min-width: 100%; max-width: calc(100vw - 16px); overflow-x: auto; z-index: 1000;
      /* Long lists scroll inside the panel instead of running down the page. */
      max-height: min(70vh, 640px); overflow-y: auto; overscroll-behavior: contain;
      background: #fff; border: 1px solid #cdd5dc; border-radius: 10px;
      box-shadow: 0 6px 20px rgba(0,0,0,.12);
      padding: 10px 12px; font-size: 13px; white-space: normal;
    }
    table { border-collapse: collapse; width: 100%; }
    th, td { padding: 5px 8px; text-align: left; border-bottom: 1px solid #e6eaf0; vertical-align: middle; }
    th { font-size: 12px; color: #565a5c; font-weight: 600; }
    thead th { position: sticky; top: -10px; background: #fff; z-index: 1; } /* headings stay visible while the list scrolls */
    tfoot td { border-bottom: 0; font-weight: 700; }
    .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .muted { color: #868c8f; }
    .note { font-size: 11px; color: #868c8f; }
    .warnings { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
    .w { display: inline-flex; align-items: center; gap: 3px; }
    input[type="number"] {
      width: 64px; padding: 3px 6px; text-align: right;
      font: inherit; font-size: 13px; color: #202122; background: #fff;
      border: 1px solid #cdd5dc; border-radius: 5px;
      -moz-appearance: textfield;
    }
    input[type="number"]::-webkit-inner-spin-button { margin-left: 2px; }
    .hint { margin-top: 6px; font-size: 11px; color: #868c8f; }
    button.link {
      padding: 0; border: 0; background: none; color: #006fbf;
      font-size: 11px; text-decoration: underline; cursor: pointer;
    }
    button.link:hover { background: none; color: #005a9c; }
  `;

  // Builds the badge (and the breakdown, if open). Called when the breakdown is
  // opened/closed or weights change from elsewhere. Typing in a weight box only
  // calls refresh(), so the box keeps focus.
  function render() {
    const rows = categories.map((c) => {
      const w = weights[c.name];
      const d2lNote = c.d2lPct != null && c.pct != null && Math.abs(c.d2lPct - c.pct) > 0.05
        ? `<div class="note">D2L shows ${fmt(c.d2lPct)}</div>` : '';
      // Groups built from uncategorized items list what's in them.
      const itemsNote = c.fromLoose && (c.itemNames.length > 1 || c.itemNames[0] !== c.name)
        ? `<div class="note">${esc(D2LGrouping.itemSummary(c))}</div>` : '';
      return `<tr>
        <td>${esc(c.name)}${d2lNote}${itemsNote}</td>
        <td class="num">${c.pct == null ? '<span class="muted">Not graded</span>' : fmt(c.pct)}</td>
        <td class="num">${c.total ? `${c.graded}/${c.total}` : ''}</td>
        <td class="num"><span class="w"><input type="number" min="0" max="100" step="any"
          data-name="${esc(c.name)}" aria-label="Weight for ${esc(c.name)}"
          value="${typeof w === 'number' && w > 0 ? w : ''}" placeholder="–">%</span></td>
      </tr>`;
    }).join('');

    shadow.innerHTML = `
      <style>${STYLE}</style>
      <div class="badge" role="group" aria-label="Current grade">
        <div class="pct" id="pct" aria-live="polite"></div>
        <div class="label">
          <b id="title">Current grade</b>
          <span id="sub"></span>
          <button type="button" class="link" id="usePoints" hidden>Use total points instead</button>
          <span class="warn" id="warnShort" hidden>Check weights. See Breakdown</span>
        </div>
        <div class="actions">
          <button type="button" id="toggle" aria-expanded="${detailsOpen}">Breakdown</button>
          <button type="button" id="weights" title="Open the weights page to fill weights from a syllabus">Set weights</button>
        </div>
        ${detailsOpen ? `
          <div class="details">
            <table>
              <thead><tr><th>Category</th><th class="num">Your %</th><th class="num">Graded</th><th class="num">Weight</th></tr></thead>
              <tbody>${rows}</tbody>
              <tfoot><tr><td>Total</td><td></td><td></td><td class="num" id="wTotal"></td></tr></tfoot>
            </table>
            <div class="warnings" id="pointsLine" hidden><span class="muted" id="pointsText"></span>
              <span class="muted" id="pointsChoice" hidden>Showing total points because you chose it.
                <button type="button" class="link" id="stopPoints">Hide the grade until weights are set</button></span></div>
            <div class="warnings" id="warnings"></div>
            <div class="hint">Type a weight to update your grade. Changes save automatically.</div>
            ${hasLoose ? `<div class="hint">${rawGroups.some((g) => !g.loose)
              ? 'Items outside D2L categories were grouped by name.'
              : 'This course doesn\'t use D2L categories, so items were grouped by name.'}
              <button type="button" class="link" id="editGroups">Edit groups</button></div>` : ''}
          </div>` : ''}
      </div>`;

    shadow.getElementById('toggle').addEventListener('click', () => {
      detailsOpen = !detailsOpen;
      render();
      if (detailsOpen) {
        const first = shadow.querySelector('input[type="number"]');
        if (first) first.focus();
      }
    });
    shadow.getElementById('weights').addEventListener('click', () => {
      api.runtime.sendMessage({ type: 'openWeights', course: courseKey });
    });
    shadow.getElementById('usePoints').addEventListener('click', () => {
      usePoints = true;
      api.storage.local.set({ [pointsKey]: true });
      render();
    });
    const stopPoints = shadow.getElementById('stopPoints');
    if (stopPoints) {
      stopPoints.addEventListener('click', () => {
        usePoints = false;
        api.storage.local.remove(pointsKey);
        render();
      });
    }
    const editGroups = shadow.getElementById('editGroups');
    if (editGroups) {
      editGroups.addEventListener('click', () => {
        api.runtime.sendMessage({ type: 'openWeights', course: courseKey, section: 'groups' });
      });
    }
    for (const input of shadow.querySelectorAll('input[type="number"]')) {
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        if (Number.isFinite(v) && v > 0) weights[input.dataset.name] = v;
        else delete weights[input.dataset.name];
        refresh();
        scheduleSave();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
      });
    }
    refresh();
    layout();
    onScroll(); // re-apply (or lift) the scroll fade when the Breakdown opens or closes
  }

  // Updates the numbers without rebuilding anything.
  function refresh() {
    const g = computeGrade(categories, weights);
    const needWeights = g.mode === 'points' && !usePoints;
    const pct = shadow.getElementById('pct');
    pct.textContent = needWeights ? 'Please input weights' : fmt(g.pct);
    pct.classList.toggle('prompt', needWeights);
    shadow.querySelector('.badge').setAttribute('aria-label', needWeights ? 'Grade hidden until weights are set' : 'Current grade');
    shadow.getElementById('title').textContent = needWeights ? 'Grade not shown yet' : 'Current grade';
    shadow.getElementById('sub').hidden = needWeights; // keep the prompt badge short
    shadow.getElementById('sub').textContent = needWeights
      ? ''
      : g.mode === 'weighted'
        ? (source && source.from === 'shared'
          ? `Weights shared by ${source.students} student${source.students === 1 ? '' : 's'}` +
            (source.scope === 'course' ? ' in another section' : '')
          : 'Weighted by your category weights')
        : 'Total points (your choice for this course)';
    shadow.getElementById('usePoints').hidden = !needWeights;
    shadow.getElementById('weights').classList.toggle('primary', needWeights && !detailsOpen);

    const warnings = [];
    if (g.mode === 'weighted') {
      if (Math.abs(g.totalWeight - 100) > 0.01) warnings.push(`Weights add up to ${+g.totalWeight.toFixed(2)}%, not 100%.`);
      if (g.missingWeight.length) warnings.push(`No weight set for: ${g.missingWeight.join(', ')} (not counted).`);
    }
    shadow.getElementById('warnShort').hidden = !warnings.length || detailsOpen;

    if (!detailsOpen) return;
    const total = categories.reduce((a, c) => a + (weights[c.name] > 0 ? weights[c.name] : 0), 0);
    shadow.getElementById('wTotal').textContent = total ? +total.toFixed(2) + '%' : '–';
    // The points total is the grade, so it's only shown when the user chose total points.
    shadow.getElementById('pointsLine').hidden = g.mode !== 'points' || needWeights;
    shadow.getElementById('pointsChoice').hidden = needWeights || g.mode !== 'points';
    if (g.mode === 'points' && !needWeights) {
      shadow.getElementById('pointsText').textContent = `${+g.earned.toFixed(2)} / ${+g.possible.toFixed(2)} points on graded items.`;
    }
    shadow.getElementById('warnings').innerHTML = warnings.map((w) => `<span class="warn">${esc(w)}</span>`).join('');
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      // Editing makes this setup the user's own, which the background script shares.
      source = { from: 'user' };
      api.storage.local.set({ [weightsKey]: { ...weights }, [sourceKey]: source });
    }, 400);
  }

  // Centre the badge in the title row; on narrow windows put it on its own line instead.
  // Centre the badge in the title row. If it would cover anything there ("Grades",
  // Print, other buttons) it moves onto its own line just below the header instead.
  const CENTERED = { position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', display: 'block', justifyContent: '', margin: '0', zIndex: '5' };
  const OWN_LINE = { position: 'relative', left: '', top: '', transform: '', display: 'flex', justifyContent: 'center', margin: '8px 0 12px', zIndex: '5' };
  function overlapsHeaderContent() {
    const b = host.getBoundingClientRect();
    if (!b.width) return false;
    const pad = 12;
    for (const el of header.querySelectorAll('h1, h2, a, button, [role="button"], d2l-button-subtle, d2l-button-icon, d2l-dropdown')) {
      if (host.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      // For the title, use the text's own width, not the full-width block.
      let { left, right } = r;
      if (/^H[12]$/.test(el.tagName)) {
        const range = document.createRange();
        range.selectNodeContents(el);
        ({ left, right } = range.getBoundingClientRect());
      }
      const horiz = b.left < right + pad && b.right > left - pad;
      const vert = b.top < r.bottom && b.bottom > r.top;
      if (horiz && vert) return true;
    }
    return false;
  }
  function layout() {
    if (!header) {
      Object.assign(host.style, OWN_LINE);
      return;
    }
    if (host.parentElement !== header) header.appendChild(host);
    Object.assign(host.style, CENTERED);
    if (overlapsHeaderContent()) {
      header.after(host);
      Object.assign(host.style, OWN_LINE);
    }
  }
  if ('ResizeObserver' in window && header) new ResizeObserver(() => layout()).observe(header);
  window.addEventListener('resize', () => layout());

  // Fade out over the first ~140px of scrolling.
  // While the Breakdown is open it stays fully visible, so long lists stay readable.
  function onScroll() {
    const o = detailsOpen ? 1 : Math.max(0, 1 - window.scrollY / 140);
    host.style.opacity = String(o);
    host.style.visibility = o === 0 ? 'hidden' : 'visible';
    host.style.pointerEvents = o < 0.3 ? 'none' : '';
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  // Close the breakdown when clicking elsewhere on the page or pressing Escape.
  document.addEventListener('click', (e) => {
    if (detailsOpen && !e.composedPath().includes(host)) {
      detailsOpen = false;
      render();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (detailsOpen && e.key === 'Escape') {
      detailsOpen = false;
      render();
      shadow.getElementById('toggle').focus();
    }
  });

  // Weights saved from the weights page (or another tab) redraw the badge.
  // Our own autosaves come back here too; skip those so the box being typed in keeps focus.
  // Group changes from the weights page regroup the items.
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let changed = false;
    if (changes[groupsKey]) {
      groupOverrides = changes[groupsKey].newValue || {};
      categories = D2LGrouping.buildCategories(rawGroups, groupOverrides);
      changed = true;
    }
    if (changes[weightsKey]) {
      const next = changes[weightsKey].newValue || {};
      if (JSON.stringify(next) !== JSON.stringify(weights)) {
        weights = { ...next };
        changed = true;
      }
    }
    if (changes[sourceKey]) {
      source = changes[sourceKey].newValue || null;
      if (!changed) refresh(); // only the "shared by" label changes
    }
    if (changes[pointsKey] && !!changes[pointsKey].newValue !== usePoints) {
      usePoints = !!changes[pointsKey].newValue; // chosen in another tab
      changed = true;
    }
    if (changed) render();
  });

  // ---------- Shared setups ----------
  // Uses the most popular setup classmates shared when you haven't set your own
  // (or when the one you have came from sharing, so it stays up to date).
  async function applyShared(meta) {
    const reply = await api.runtime.sendMessage({ type: 'fetchShared', meta });
    if (!reply || !reply.ok || !reply.result || !reply.result.setup) return;
    const { setup, students, scope } = reply.result;

    // Only keep parts that fit this course (another section can be named differently).
    const { weights: shared, groups } = D2LGrouping.fitSharedSetup(setup, rawGroups);
    if (!Object.keys(shared).length && !Object.keys(groups).length) return;

    source = { from: 'shared', students, scope };
    if (D2LGrouping.sameSetup({ weights: shared, groups }, { weights, groups: groupOverrides })) {
      await api.storage.local.set({ [sourceKey]: source }); // just refresh the count
      return;
    }
    // One write, so the background script sees source=shared and doesn't re-upload it.
    await api.storage.local.set({ [weightsKey]: shared, [groupsKey]: groups, [sourceKey]: source });
  }

  async function init() {
    const res = await api.storage.local.get([weightsKey, groupsKey, sourceKey, pointsKey]);
    weights = { ...(res[weightsKey] || {}) };
    groupOverrides = res[groupsKey] || {};
    source = res[sourceKey] || null;
    usePoints = !!res[pointsKey];
    categories = D2LGrouping.buildCategories(rawGroups, groupOverrides);
    render();
    onScroll();

    const meta = await courseMeta();
    const info = (await api.storage.local.get(infoKey))[infoKey] || {};
    await api.storage.local.set({ [infoKey]: { ...info, meta } });

    const hasLocal = Object.keys(weights).length > 0 || Object.keys(groupOverrides).length > 0;
    if (hasLocal && !source) {
      // Set up before sharing existed: it's the user's own, so share it.
      source = { from: 'user' };
      await api.storage.local.set({ [sourceKey]: source });
    } else if (source && source.from === 'user') {
      // Re-send your own setup in case an earlier upload failed.
      api.runtime.sendMessage({ type: 'shareNow', course: courseKey }).catch(() => {});
    } else if ((!hasLocal && !source) || (source && source.from === 'shared')) {
      // (If the user cleared their own weights on purpose, source is 'user' and we leave it empty.)
      try {
        await applyShared(meta);
      } catch (err) {
        console.warn('[D2L Grade Calc] shared setup:', err);
      }
    }
  }

  render();
  onScroll();
  init();
})();
