// Background script:
//  - opens the weights page when the badge asks for it
//  - shares this install's weights/groups for a course whenever the user changes them
//  - fetches the most popular shared setup for a course
if (typeof importScripts === 'function' && typeof globalThis.SHARE_CONFIG === 'undefined') {
  importScripts('config.js'); // Chrome service worker; Firefox loads config.js via the manifest
}

const api = globalThis.browser ?? globalThis.chrome;
const cfg = globalThis.SHARE_CONFIG || {};
const sharingConfigured = () => !!(cfg.url && cfg.anonKey);

async function sharingEnabled() {
  const { shareEnabled } = await api.storage.local.get('shareEnabled');
  return shareEnabled !== false; // on unless turned off on the weights page
}

// One anonymous ID per install. Memoised so two uploads at once can't create two IDs.
let installIdPromise = null;
function installId() {
  if (!installIdPromise) {
    installIdPromise = (async () => {
      const { installId } = await api.storage.local.get('installId');
      if (installId) return installId;
      const id = crypto.randomUUID();
      await api.storage.local.set({ installId: id });
      return id;
    })().catch((err) => {
      installIdPromise = null;
      throw err;
    });
  }
  return installIdPromise;
}

async function rpc(fn, body) {
  const res = await fetch(`${cfg.url.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: cfg.anonKey,
      // Legacy anon keys are JWTs and also go in Authorization; new "sb_publishable_" keys only use apikey.
      ...(cfg.anonKey.startsWith('sb_') ? {} : { Authorization: `Bearer ${cfg.anonKey}` }),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${fn} failed: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ---------- Fetch ----------

async function fetchShared(meta) {
  if (!sharingConfigured() || !(await sharingEnabled())) return null;
  const rows = await rpc('get_shared_setup', {
    p_host: meta.host,
    p_ou: meta.ou,
    p_course_code: meta.courseCode || null,
    p_term: meta.term || null,
  });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// ---------- Upload ----------
// Watches storage: when a course's weights or groups change and the change came
// from the user (not from applying a shared setup), upload the new setup.

const pending = new Map();

async function upload(courseKey) {
  if (!sharingConfigured() || !(await sharingEnabled())) return;
  const keys = ['weights:', 'groups:', 'info:', 'source:'].map((p) => p + courseKey);
  const data = await api.storage.local.get(keys);
  const source = data['source:' + courseKey];
  const info = data['info:' + courseKey];
  if (!info || !info.meta) return;
  if (!source || source.from !== 'user') return; // nothing the user set themselves

  await rpc('submit_setup', {
    p_host: info.meta.host,
    p_ou: info.meta.ou,
    p_course_code: info.meta.courseCode || null,
    p_term: info.meta.term || null,
    p_install_id: await installId(),
    p_setup: {
      weights: data['weights:' + courseKey] || {},
      groups: data['groups:' + courseKey] || {},
    },
  });
}

api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const key of Object.keys(changes)) {
    const m = key.match(/^(weights|groups|source):(.+)$/);
    if (!m) continue;
    const courseKey = m[2];
    clearTimeout(pending.get(courseKey));
    pending.set(courseKey, setTimeout(() => {
      pending.delete(courseKey);
      upload(courseKey).catch((err) => console.warn('[D2L Grade Calc] share upload:', err));
    }, 1500));
  }
});

// ---------- Messages from the badge / weights page ----------

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.type === 'openWeights' && typeof msg.course === 'string') {
    api.tabs.create({
      url: api.runtime.getURL('weights.html?course=' + encodeURIComponent(msg.course) +
        (msg.section === 'groups' ? '#groups' : '')),
      index: sender.tab ? sender.tab.index + 1 : undefined,
    });
    return;
  }

  if (msg.type === 'fetchShared' && msg.meta) {
    fetchShared(msg.meta)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true; // keep the channel open for the async reply
  }

  // Sent on every Grades page load for a setup you made yourself, so a failed
  // upload (offline, project paused) is retried. Uploading is an idempotent upsert.
  if (msg.type === 'shareNow' && typeof msg.course === 'string') {
    upload(msg.course)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true;
  }

  if (msg.type === 'sharingStatus') {
    sharingEnabled().then((enabled) => sendResponse({ configured: sharingConfigured(), enabled }));
    return true;
  }
});
