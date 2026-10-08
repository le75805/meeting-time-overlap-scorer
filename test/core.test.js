import { test } from "node:test";
import assert from "node:assert/strict";

import {
  score,
  describeOverlap,
  scoreOverlapForWeek,
  meetingToUtcInstant,
  getIsoWeeksInYear,
} from "../src/core.js";

const REF_YEAR = 2024;

const ny9amMon = { dayOfWeek: 1, startMinutes: 9 * 60, durationMinutes: 60, timezone: "America/New_York" };
const london9amMon = { dayOfWeek: 1, startMinutes: 9 * 60, durationMinutes: 60, timezone: "Europe/London" };
const tokyo9amMon = { dayOfWeek: 1, startMinutes: 9 * 60, durationMinutes: 60, timezone: "Asia/Tokyo" };
const utc9amMon = { dayOfWeek: 1, startMinutes: 9 * 60, durationMinutes: 60, timezone: "UTC" };

function near(actual, expected, eps = 1e-9) {
  return Math.abs(actual - expected) < eps;
}

test("identical meetings fully overlap -> score 1", () => {
  const s = score(ny9amMon, ny9amMon, { referenceYear: REF_YEAR });
  assert.equal(s, 1);
});

test("NY 9am and London 9am never overlap -> score 0", () => {
  const s = score(ny9amMon, london9amMon, { referenceYear: REF_YEAR });
  assert.equal(s, 0);
});

test("NY 9am and Tokyo 9am never overlap -> score 0", () => {
  const s = score(ny9amMon, tokyo9amMon, { referenceYear: REF_YEAR });
  assert.equal(s, 0);
});

test("score is symmetric", () => {
  const s1 = score(ny9amMon, london9amMon, { referenceYear: REF_YEAR });
  const s2 = score(london9amMon, ny9amMon, { referenceYear: REF_YEAR });
  assert.ok(near(s1, s2), `scores not symmetric: ${s1} vs ${s2}`);
});

test("describeOverlap returns weekly array whose mean equals meanOverlapMinutes", () => {
  const r = describeOverlap(ny9amMon, london9amMon, { referenceYear: REF_YEAR });
  assert.equal(r.weeklyOverlapMinutes.length, r.weeks.length);
  const mean = r.weeklyOverlapMinutes.reduce((s, v) => s + v, 0) / r.weeklyOverlapMinutes.length;
  assert.ok(near(mean, r.meanOverlapMinutes), `mean mismatch: ${mean} vs ${r.meanOverlapMinutes}`);
  assert.ok(near(r.score, r.meanOverlapMinutes / 60), `score mismatch: ${r.score} vs ${r.meanOverlapMinutes / 60}`);
});

test("scoreOverlapForWeek returns 60 for identical meetings in a single week", () => {
  const m = scoreOverlapForWeek(ny9amMon, ny9amMon, REF_YEAR, 1);
  assert.equal(m, 60);
});

test("scoreOverlapForWeek returns 0 for non-overlapping meetings", () => {
  const m = scoreOverlapForWeek(ny9amMon, tokyo9amMon, REF_YEAR, 1);
  assert.equal(m, 0);
});

test("meetingToUtcInstant for UTC meeting equals the ISO date at given minutes", () => {
  const ms = meetingToUtcInstant(utc9amMon, REF_YEAR, 1);
  const d = new Date(ms);
  assert.equal(d.getUTCHours(), 9);
  assert.equal(d.getUTCMinutes(), 0);
  assert.equal(d.getUTCDay(), 1);
});

test("getIsoWeeksInYear returns 52 or 53 with no gaps", () => {
  const w2023 = getIsoWeeksInYear(2023);
  const w2024 = getIsoWeeksInYear(2024);
  const w2020 = getIsoWeeksInYear(2020);
  assert.equal(w2023.length, 52);
  assert.equal(w2024.length, 52);
  assert.equal(w2020.length, 53);
  for (let i = 0; i < w2024.length; i++) assert.equal(w2024[i], i + 1);
});

test("default reference year is 2024 when options omitted", () => {
  const s1 = score(ny9amMon, london9amMon);
  const s2 = score(ny9amMon, london9amMon, { referenceYear: 2024 });
  assert.ok(near(s1, s2));
});

test("zero-duration meeting yields score 0 (not NaN)", () => {
  const zero = { dayOfWeek: 1, startMinutes: 540, durationMinutes: 0, timezone: "UTC" };
  const s = score(zero, utc9amMon, { referenceYear: REF_YEAR });
  assert.equal(s, 0);
});

test("partial overlap when NY 9am and UTC 14:00 are compared (5h offset region)", () => {
  const utc2pmMon = { dayOfWeek: 1, startMinutes: 14 * 60, durationMinutes: 60, timezone: "UTC" };
  const s = score(ny9amMon, utc2pmMon, { referenceYear: REF_YEAR });
  assert.ok(s > 0 && s < 1, `expected partial overlap, got ${s}`);
});
