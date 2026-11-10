// Runs supabase/schema.sql in PGlite (real Postgres compiled to WebAssembly) and
// checks the sharing rules. Never touches the live Supabase project.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { ROOT } from './helpers/load.js';

let db;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const HOST = 'sru.desire2learn.com';

before(async () => {
  db = new PGlite();
  // Supabase creates these roles; PGlite doesn't.
  await db.exec(`create role anon nologin; create role authenticated nologin;`);
  await db.exec(fs.readFileSync(path.join(ROOT, 'supabase', 'schema.sql'), 'utf8'));
  // Running the schema a second time must also work (safe to re-run after edits).
  await db.exec(fs.readFileSync(path.join(ROOT, 'supabase', 'schema.sql'), 'utf8'));
  await db.exec(`grant usage on schema public to anon;`);
});

// Calls go through the anon role, like the extension's public key.
async function asAnon(sql, params) {
  await db.exec('set role anon');
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role');
  }
}

const submit = (ou, install, setup, extra = {}) => asAnon(
  'select submit_setup($1, $2, $3, $4, $5, $6)',
  [extra.host ?? HOST, ou, extra.course ?? 'CPSC-374', extra.term ?? '202630', install, JSON.stringify(setup)],
);
const fetchTop = async (ou, course = 'CPSC-374', term = '202630') =>
  (await asAnon('select * from get_shared_setup($1, $2, $3, $4)', [HOST, ou, course, term])).rows[0] || null;
const clear = () => db.exec('delete from shared_setups');

const S1 = { weights: { Quizzes: 20, Assignments: 50, Exams: 30 } };
const S2 = { weights: { Quizzes: 25, Assignments: 50, Exams: 25 }, groups: { HW01: 'HW' } };

test('most popular setup wins; key order does not matter', async () => {
  await clear();
  await submit('100', A, S1);
  await submit('100', B, { weights: { Exams: 30, Assignments: 50, Quizzes: 20 } });
  await submit('100', C, S2);
  const top = await fetchTop('100');
  assert.deepEqual(top.setup, S1);
  assert.equal(top.students, 2);
  assert.equal(top.scope, 'section');
});

test('changing your setup moves your vote instead of adding one', async () => {
  await clear();
  await submit('100', A, S1);
  await submit('100', B, S1);
  await submit('100', C, S2);
  await submit('100', A, S2);
  const top = await fetchTop('100');
  assert.deepEqual(top.setup, S2);
  assert.equal(top.students, 2);
  const { rows } = await db.query('select count(*)::int as n from shared_setups');
  assert.equal(rows[0].n, 3, 'still one row per student');
});

test('falls back to another section of the same course and term', async () => {
  await clear();
  await submit('100', A, S1);
  const top = await fetchTop('999');
  assert.equal(top.scope, 'course');
  assert.deepEqual(top.setup, S1);
  assert.equal(await fetchTop('999', 'CPSC-374', '202710'), null, 'different term: nothing');
  assert.equal(await fetchTop('999', 'CPSC-237', '202630'), null, 'different course: nothing');
  assert.equal(await fetchTop('999', null, null), null, 'unknown course: section only');
});

test('own section wins over other sections even if less popular', async () => {
  await clear();
  await submit('100', A, S1);
  await submit('100', B, S1);
  await submit('200', C, S2);
  const top = await fetchTop('200');
  assert.equal(top.scope, 'section');
  assert.deepEqual(top.setup, S2);
});

test('empty setup deletes your entry; empty parts are dropped', async () => {
  await clear();
  await submit('100', A, { weights: { Quizzes: 20 }, groups: {} });
  assert.deepEqual((await fetchTop('100')).setup, { weights: { Quizzes: 20 } });
  await submit('100', A, { weights: {}, groups: {} });
  assert.equal(await fetchTop('100'), null);
  await submit('100', A, {}); // deleting something that isn't there is fine
});

test('unknown top-level fields are dropped', async () => {
  await clear();
  await submit('100', A, { weights: { Q: 10 }, evil: 'x' });
  assert.deepEqual((await fetchTop('100')).setup, { weights: { Q: 10 } });
});

test('invalid setups are rejected', async () => {
  await clear();
  const bad = [
    { weights: { Q: 150 } },
    { weights: { Q: 0 } },
    { weights: { Q: -5 } },
    { weights: { Q: '20' } },
    { weights: { A: 100, B: 60 } },                 // total over 150
    { weights: { ['x'.repeat(121)]: 10 } },
    { weights: [] },
    { groups: { HW01: 5 } },
    { groups: { HW01: '' } },
    { weights: Object.fromEntries(Array.from({ length: 61 }, (_, i) => ['c' + i, 1])) },
  ];
  for (const setup of bad) {
    await assert.rejects(submit('100', A, setup), undefined, JSON.stringify(setup).slice(0, 60));
  }
  assert.equal(await fetchTop('100'), null);
});

test('bad course identifiers are rejected', async () => {
  await clear();
  await assert.rejects(submit('100', A, S1, { host: 'evil.example.com' }));
  await assert.rejects(submit('abc', A, S1));
  await assert.rejects(submit('100', A, S1, { course: 'not a course' }));
  await assert.rejects(submit('100', A, S1, { term: 'fall' }));
  await submit('100', A, S1, { host: 'myschool.brightspace.com' });
  await submit('101', A, S1, { course: null, term: null });
});

test('one install can share for at most 40 courses', async () => {
  await clear();
  for (let i = 0; i < 40; i++) await submit(String(1000 + i), A, S1);
  await assert.rejects(submit('2000', A, S1), /too many courses/);
  await submit('1000', A, S2); // updating an existing course is still fine
});

test('the public role cannot touch the table or the validator directly', async () => {
  await assert.rejects(asAnon('select * from shared_setups'), /permission denied/);
  await assert.rejects(asAnon(`insert into shared_setups values ('${HOST}','1',null,null,'${A}','{}','x',now())`), /permission denied/);
  await assert.rejects(asAnon('delete from shared_setups'), /permission denied/);
  await assert.rejects(asAnon(`select valid_setup('{}'::jsonb)`), /permission denied/);
});
