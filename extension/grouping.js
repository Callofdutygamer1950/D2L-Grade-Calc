// Shared by content.js (classic script) and weights.js (via a plain <script> tag).
//
// Some courses don't use D2L categories, so every item (HW01, HW02, GroupProj...)
// sits at the top level. Those "loose" items are grouped by name with the trailing
// number removed (HW01..HW05 -> "HW"), and the user can move any item to another
// group. Overrides are stored per course as { itemName: groupName }.
(() => {
  'use strict';

  // "HW01" -> "HW", "Quiz #3" -> "Quiz", "Assignment 1" -> "Assignment", "Lab-2" -> "Lab"
  function baseName(name) {
    const base = String(name).replace(/[\s_\-#:.]*\(?\d+\)?\s*$/, '').trim();
    return base || String(name);
  }

  // Automatic group for each loose item. A base name only becomes a group when
  // two or more items share it; a lone "Project 1" keeps its own name.
  function autoGroups(looseItems) {
    const counts = {};
    for (const it of looseItems) {
      const b = baseName(it.name).toLowerCase();
      counts[b] = (counts[b] || 0) + 1;
    }
    const out = {};
    for (const it of looseItems) {
      const b = baseName(it.name);
      out[it.name] = counts[b.toLowerCase()] > 1 ? b : it.name;
    }
    return out;
  }

  // Category % = points earned / points possible over graded items only
  // (ungraded "- / 50" items and dropped/exempt items are skipped).
  function summarize(g) {
    let earned = 0, possible = 0, graded = 0, counted = 0;
    for (const it of g.items) {
      if (it.excluded) continue;
      counted++;
      if (it.earned != null && it.possible > 0) {
        earned += it.earned;
        possible += it.possible;
        graded++;
      } else if (it.earned != null && it.possible === 0) {
        earned += it.earned; // bonus item ("5 / 0"): extra points, nothing added to possible
        graded++;
      } else if (it.possible == null && it.pct != null) {
        earned += it.pct; // shown only as a percentage: treat as out of 100
        possible += 100;
        graded++;
      }
    }
    let pct = possible > 0 ? (earned / possible) * 100 : null;
    // A category D2L reports a % for but with no items listed: use D2L's number.
    if (g.items.length === 0 && g.d2lPct != null) pct = g.d2lPct;
    return {
      name: g.name,
      pct,
      earned,
      possible,
      graded,
      total: counted,
      d2lPct: g.fromLoose ? null : g.d2lPct,
      fromLoose: !!g.fromLoose,
      itemNames: g.items.map((it) => it.name),
    };
  }

  // rawGroups: [{ name, d2lPct, items: [...], loose }] straight from the grades table.
  // overrides: { itemName: groupName } chosen by the user.
  function buildCategories(rawGroups, overrides) {
    overrides = overrides || {};
    const cats = [];
    const byName = new Map();
    for (const g of rawGroups) {
      if (g.loose) continue;
      const c = { name: g.name, d2lPct: g.d2lPct, items: g.items.slice(), fromLoose: false };
      cats.push(c);
      byName.set(g.name.toLowerCase(), c);
    }

    const looseItems = rawGroups.filter((g) => g.loose).flatMap((g) => g.items);
    const auto = autoGroups(looseItems);
    for (const it of looseItems) {
      const groupName = (overrides[it.name] || '').trim() || auto[it.name];
      let c = byName.get(groupName.toLowerCase());
      if (!c) {
        c = { name: groupName, d2lPct: null, items: [], fromLoose: true };
        cats.push(c);
        byName.set(groupName.toLowerCase(), c);
      }
      c.items.push(it);
    }
    return cats.map(summarize);
  }

  // [{ name, autoGroup }] for every loose item, for the group editor.
  function looseItemList(rawGroups) {
    const items = rawGroups.filter((g) => g.loose).flatMap((g) => g.items);
    const auto = autoGroups(items);
    return items.map((it) => ({ name: it.name, autoGroup: auto[it.name] }));
  }

  // Keeps only the parts of a shared setup that fit this course: group moves for
  // items that exist here, and weights for categories/groups that exist here.
  function fitSharedSetup(setup, rawGroups) {
    const looseNames = new Set(looseItemList(rawGroups).map((it) => it.name));
    const groups = {};
    for (const [item, group] of Object.entries((setup && setup.groups) || {})) {
      if (looseNames.has(item) && typeof group === 'string' && group.trim()) groups[item] = group;
    }
    const names = new Set(buildCategories(rawGroups, groups).map((c) => c.name));
    const weights = {};
    for (const [name, w] of Object.entries((setup && setup.weights) || {})) {
      if (names.has(name) && typeof w === 'number' && Number.isFinite(w) && w > 0) weights[name] = w;
    }
    return { weights, groups };
  }

  // Same weights and groups, ignoring key order.
  function sameSetup(a, b) {
    const norm = (o) => JSON.stringify(Object.entries(o || {}).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
    return norm(a.weights) === norm(b.weights) && norm(a.groups) === norm(b.groups);
  }

  globalThis.D2LGrouping = { buildCategories, looseItemList, baseName, fitSharedSetup, sameSetup };
})();
