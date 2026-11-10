import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readExt } from './helpers/load.js';
import { fakeChrome, tick } from './helpers/fake-chrome.js';

const COURSE = 'sru.desire2learn.com:4066209';
const META = { host: 'sru.desire2learn.com', ou: '4066209', courseCode: 'CPSC-374', term: '202630' };
const plain = (x) => JSON.parse(JSON.stringify(x));

// Starts a fresh copy of background.js with a fake browser API and a fake network.
function startBackground({ initial = {}, config = { url: 'https://proj.supabase.co', anonKey: 'sb_publishable_test' }, reply } = {}) {
  const chrome = fakeChrome({ initial });
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
    const r = reply ? reply(url) : { status: 204, body: '' };
    return { ok: r.status < 300, status: r.status, text: async () => r.body };
  };
  const ctx = vm.createContext({
    chrome: chrome.api, fetch, console,
    crypto: { randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    // Run the 1.5 s upload debounce 100x faster.
    setTimeout: (fn, ms) => setTimeout(fn, ms / 100), clearTimeout,
    SHARE_CONFIG: config,
  });
  vm.runInContext(readExt('background.js'), ctx, { filename: 'background.js' });
  return { chrome, calls };
}

const waitForUpload = () => tick(60);

test('your own edits are uploaded once, after a short pause', async () => {
  const { chrome, calls } = startBackground({ initial: { ['info:' + COURSE]: { meta: META } } });
  await chrome.api.storage.local.set({ ['weights:' + COURSE]: { Quizzes: 10 }, ['source:' + COURSE]: { from: 'user' } });
  await chrome.api.storage.local.set({ ['weights:' + COURSE]: { Quizzes: 20 } });
  await chrome.api.storage.local.set({ ['groups:' + COURSE]: { HW01: 'HW' } });
  await waitForUpload();

  assert.equal(calls.length, 1, 'rapid changes collapse into one upload');
  const [call] = calls;
  assert.equal(call.url, 'https://proj.supabase.co/rest/v1/rpc/submit_setup');
  assert.equal(call.headers.apikey, 'sb_publishable_test');
  assert.equal(call.headers.Authorization, undefined, 'publishable keys are not sent as a Bearer token');
  assert.deepEqual(plain(call.body), {
    p_host: 'sru.desire2learn.com', p_ou: '4066209', p_course_code: 'CPSC-374', p_term: '202630',
    p_install_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    p_setup: { weights: { Quizzes: 20 }, groups: { HW01: 'HW' } },
  });
  assert.equal(chrome.data.installId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'install ID is saved and reused');
});

test('legacy JWT anon keys are also sent as a Bearer token', async () => {
  const { chrome, calls } = startBackground({
    initial: { ['info:' + COURSE]: { meta: META } },
    config: { url: 'https://proj.supabase.co/', anonKey: 'eyJhbGciOi.test' },
  });
  await chrome.api.storage.local.set({ ['weights:' + COURSE]: { Q: 1 }, ['source:' + COURSE]: { from: 'user' } });
  await waitForUpload();
  assert.equal(calls[0].url, 'https://proj.supabase.co/rest/v1/rpc/submit_setup', 'trailing slash handled');
  assert.equal(calls[0].headers.Authorization, 'Bearer eyJhbGciOi.test');
});

test('setups that came from sharing are not uploaded again', async () => {
  const { chrome, calls } = startBackground({ initial: { ['info:' + COURSE]: { meta: META } } });
  await chrome.api.storage.local.set({
    ['weights:' + COURSE]: { Quizzes: 20 }, ['source:' + COURSE]: { from: 'shared', students: 3, scope: 'section' },
  });
  await waitForUpload();
  assert.equal(calls.length, 0);
});

test('nothing is uploaded or fetched when sharing is turned off', async () => {
  const { chrome, calls } = startBackground({ initial: { ['info:' + COURSE]: { meta: META }, shareEnabled: false } });
  await chrome.api.storage.local.set({ ['weights:' + COURSE]: { Q: 1 }, ['source:' + COURSE]: { from: 'user' } });
  await waitForUpload();
  const res = await chrome.dispatch({ type: 'fetchShared', meta: META });
  assert.equal(calls.length, 0);
  assert.deepEqual(plain(res), { ok: true, result: null });
});

test('nothing is sent when Supabase is not configured', async () => {
  const { chrome, calls } = startBackground({ initial: { ['info:' + COURSE]: { meta: META } }, config: { url: '', anonKey: '' } });
  await chrome.api.storage.local.set({ ['weights:' + COURSE]: { Q: 1 }, ['source:' + COURSE]: { from: 'user' } });
  await waitForUpload();
  assert.equal(calls.length, 0);
  assert.deepEqual(plain(await chrome.dispatch({ type: 'sharingStatus' })), { configured: false, enabled: true });
});

test('no upload before the course identity is known', async () => {
  const { chrome, calls } = startBackground();
  await chrome.api.storage.local.set({ ['weights:' + COURSE]: { Q: 1 }, ['source:' + COURSE]: { from: 'user' } });
  await waitForUpload();
  assert.equal(calls.length, 0);
});

test('fetchShared returns the most popular setup', async () => {
  const row = { setup: { weights: { Quizzes: 20 } }, students: 3, scope: 'section' };
  const { chrome, calls } = startBackground({ reply: () => ({ status: 200, body: JSON.stringify([row]) }) });
  const res = await chrome.dispatch({ type: 'fetchShared', meta: META });
  assert.deepEqual(plain(res), { ok: true, result: row });
  assert.equal(calls[0].url, 'https://proj.supabase.co/rest/v1/rpc/get_shared_setup');
  assert.deepEqual(plain(calls[0].body), { p_host: META.host, p_ou: META.ou, p_course_code: 'CPSC-374', p_term: '202630' });
});

test('fetchShared with nothing shared, and with a server error', async () => {
  let status = 200;
  const { chrome } = startBackground({ reply: () => (status === 200 ? { status, body: '[]' } : { status, body: 'boom' }) });
  assert.deepEqual(plain(await chrome.dispatch({ type: 'fetchShared', meta: META })), { ok: true, result: null });
  status = 500;
  const res = await chrome.dispatch({ type: 'fetchShared', meta: META });
  assert.equal(res.ok, false);
  assert.match(res.error, /500/);
});

test('openWeights opens the weights page next to the D2L tab', async () => {
  const { chrome } = startBackground();
  await chrome.dispatch({ type: 'openWeights', course: COURSE }, { tab: { index: 4 } });
  await chrome.dispatch({ type: 'openWeights', course: COURSE, section: 'groups' }, {});
  assert.deepEqual(plain(chrome.created), [
    { url: 'chrome-extension://test/weights.html?course=sru.desire2learn.com%3A4066209', index: 5 },
    { url: 'chrome-extension://test/weights.html?course=sru.desire2learn.com%3A4066209#groups' },
  ]);
});

test('two courses uploading at once share one install ID', async () => {
  let n = 0;
  const { chrome, calls } = startBackground({
    initial: { ['info:a.desire2learn.com:1']: { meta: { ...META, ou: '1' } }, ['info:a.desire2learn.com:2']: { meta: { ...META, ou: '2' } } },
  });
  // Count how many times an install ID gets written.
  const origSet = chrome.api.storage.local.set;
  chrome.api.storage.local.set = async (o) => { if (o.installId) n++; return origSet(o); };
  await chrome.api.storage.local.set({
    ['weights:a.desire2learn.com:1']: { Q: 1 }, ['source:a.desire2learn.com:1']: { from: 'user' },
    ['weights:a.desire2learn.com:2']: { Q: 2 }, ['source:a.desire2learn.com:2']: { from: 'user' },
  });
  await waitForUpload();
  assert.equal(calls.length, 2);
  assert.equal(n, 1, 'install ID created once');
  assert.equal(calls[0].body.p_install_id, calls[1].body.p_install_id);
});

test('shareNow re-sends your setup (retry after a failed upload)', async () => {
  const { chrome, calls } = startBackground({
    initial: { ['info:' + COURSE]: { meta: META }, ['weights:' + COURSE]: { Q: 5 }, ['source:' + COURSE]: { from: 'user' } },
  });
  assert.deepEqual(plain(await chrome.dispatch({ type: 'shareNow', course: COURSE })), { ok: true });
  assert.equal(calls.length, 1);
  assert.deepEqual(plain(calls[0].body.p_setup), { weights: { Q: 5 }, groups: {} });
});

test('shareNow does nothing for shared setups', async () => {
  const { chrome, calls } = startBackground({
    initial: { ['info:' + COURSE]: { meta: META }, ['weights:' + COURSE]: { Q: 5 }, ['source:' + COURSE]: { from: 'shared', students: 2 } },
  });
  await chrome.dispatch({ type: 'shareNow', course: COURSE });
  assert.equal(calls.length, 0);
});

test('unrelated storage changes and messages are ignored', async () => {
  const { chrome, calls } = startBackground();
  await chrome.api.storage.local.set({ installId: 'x', shareEnabled: true, ['info:' + COURSE]: { meta: META } });
  await waitForUpload();
  assert.equal(calls.length, 0);
  assert.equal(await chrome.dispatch({ type: 'somethingElse' }), undefined);
  assert.equal(await chrome.dispatch(null), undefined);
});
