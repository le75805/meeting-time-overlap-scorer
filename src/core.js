/**
 * Meeting Time Overlap Scorer.
 *
 * We compute overlap between two recurring weekly meetings by sampling, for every
 * ISO week of a given reference year, the actual UTC instants at which each meeting
 * starts in its timezone. DST shifts move the wall-clock-to-UTC mapping around during
 * the year, so sampling per-week captures the drift a single "do they overlap?" check
 * would hide.
 *
 * Why ISO weeks rather than Gregorian dates? ISO weeks give a stable 1..53 range
 * with a fixed Monday anchor, so week N always means the same weekday layout. We
 * then derive a concrete Date for a given ISO year/week/dayOfWeek without depending
 * on any third-party date library.
 */

/**
 * Convert an ISO (year, week, weekday) triple to a UTC Date.
 *
 * The 4-1-1 algorithm: the Gregorian date of ISO week 1 is the Monday on or before
 * January 4 of that year. We compute January 4 as a UTC date, walk back to its
 * ISO weekday, and then add (week-1)*7 + (weekday-1) days. Keeping everything in
 * UTC avoids any host-local offset creeping into the anchor.
 *
 * @param {number} isoYear
 * @param {number} isoWeek 1..53
 * @param {number} isoWeekday 1..7 (1 = Monday)
 * @returns {Date} UTC Date for the start of that weekday in that ISO week.
 */
export function isoToUtcDate(isoYear, isoWeek, isoWeekday) {
  const jan4 = Date.UTC(isoYear, 0, 4);
  const jan4Date = new Date(jan4);
  const jan4IsoWeekday = getIsoWeekday(jan4Date);
  const week1MondayMs = jan4 - (jan4IsoWeekday - 1) * 86400000;
  const targetMs = week1MondayMs + (isoWeek - 1) * 7 * 86400000 + (isoWeekday - 1) * 86400000;
  return new Date(targetMs);
}

/**
 * ISO weekday for a Date: 1 = Monday, 7 = Sunday.
 *
 * We use getUTCDay() so the result depends only on the Date's UTC fields, not on
 * the host's local timezone. JavaScript's getDay() is 0=Sunday..6=Saturday; ISO
 * wants 1=Monday..7=Sunday, so we shift.
 *
 * @param {Date} date
 * @returns {number} 1..7
 */
export function getIsoWeekday(date) {
  const jsDay = date.getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

/**
 * How many ISO weeks does the given ISO year contain (52 or 53)?
 *
 * A year has 53 ISO weeks when its January 1 falls on Thursday, OR when it is a
 * leap year whose January 1 falls on Wednesday. Otherwise it has 52.
 *
 * @param {number} isoYear
 * @returns {number[]}
 */
export function getIsoWeeksInYear(isoYear) {
  const jan1 = new Date(Date.UTC(isoYear, 0, 1));
  const jan1Weekday = getIsoWeekday(jan1);
  const isLeap = (isoYear % 4 === 0 && isoYear % 100 !== 0) || isoYear % 400 === 0;
  const has53 = jan1Weekday === 4 || (isLeap && jan1Weekday === 3);
  const count = has53 ? 53 : 52;
  const weeks = [];
  for (let w = 1; w <= count; w++) weeks.push(w);
  return weeks;
}

/**
 * Convert a meeting's wall-clock start to a UTC instant for a given ISO week.
 *
 * Intl.DateTimeFormat is the only DST-aware primitive in the standard library.
 * We need the UTC instant at which the wall clock in `timezone` reads
 * `startMinutes` on the meeting's weekday in that ISO week. We do this by
 * formatting the UTC instant of that weekday's UTC midnight into the meeting's
 * timezone to read the local wall hour/minute at that instant, which gives us the
 * offset (local wall minutes since midnight UTC). We then compute the meeting's
 * local wall-clock minutes since the weekday's UTC midnight and add it, handling
 * the day wrap so the result lands on the right calendar day.
 *
 * During a spring-forward gap or fall-back fold, Intl resolves the wall-clock
 * mapping deterministically by the host's rules; we accept that resolution.
 *
 * @param {{dayOfWeek:number, startMinutes:number, timezone:string}} meeting
 * @param {number} isoYear
 * @param {number} isoWeek
 * @returns {number} UTC ms since epoch
 */
export function meetingToUtcInstant(meeting, isoYear, isoWeek) {
  const { dayOfWeek, startMinutes, timezone } = meeting;
  const utcMidnight = isoToUtcDate(isoYear, isoWeek, dayOfWeek);

  let formatter;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (err) {
    throw new Error(`Unknown or unsupported timezone: ${timezone}`);
  }

  const parts = formatter.formatToParts(utcMidnight);
  const wall = partsToObject(parts);

  // Local wall-clock minutes since midnight UTC at the weekday's UTC start.
  const wallMinutesSinceUtcMidnight =
    normalizeHour(wall.hour) * 60 + wall.minute;

  // The meeting's wall-clock start, expressed as minutes since that same
  // UTC midnight. Because the local wall clock may be ahead of (positive
  // offset) or behind (negative offset) UTC, we add the offset captured by
  // wallMinutesSinceUtcMidnight. The modulo handles day wraparound so the
  // result is the positive number of minutes from the weekday's UTC midnight
  // to the meeting's UTC start instant.
  const totalMinutes =
    ((startMinutes - wallMinutesSinceUtcMidnight) % 1440 + 1440) % 1440;

  return utcMidnight.getTime() + totalMinutes * 60000;
}

function normalizeHour(h) {
  const n = Number(h);
  return n === 24 ? 0 : n;
}

function partsToObject(parts) {
  const out = { hour: null, minute: null };
  for (const p of parts) {
    if (p.type === "hour") out.hour = p.value;
    if (p.type === "minute") out.minute = Number(p.value);
  }
  return out;
}

/**
 * Overlap in minutes between two meetings for a single ISO week.
 *
 * Both meetings are anchored to the same ISO week's Monday, so the two windows
 * live on the same absolute timeline once converted to UTC instants. A positive
 * overlap means they share real time; a negative gap means they do not. We only
 * return non-negative overlap minutes.
 *
 * @param {{dayOfWeek:number, startMinutes:number, durationMinutes:number, timezone:string}} meeting
 * @param {{dayOfWeek:number, startMinutes:number, durationMinutes:number, timezone:string}} other
 * @param {number} isoYear
 * @param {number} isoWeek
 * @returns {number} overlap minutes, >= 0
 */
export function scoreOverlapForWeek(meeting, other, isoYear, isoWeek) {
  const aStart = meetingToUtcInstant(meeting, isoYear, isoWeek);
  const bStart = meetingToUtcInstant(other, isoYear, isoWeek);
  const aEnd = aStart + meeting.durationMinutes * 60000;
  const bEnd = bStart + other.durationMinutes * 60000;
  const overlapMs = Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
  return Math.max(0, overlapMs / 60000);
}

/**
 * Full report across all ISO weeks of the reference year.
 *
 * @typedef {Object} OverlapReport
 * @property {number} score 0..1, mean overlap normalized by shorter meeting length.
 * @property {number} meanOverlapMinutes average overlap minutes across the year.
 * @property {number[]} weeklyOverlapMinutes per-week overlap in minutes.
 * @property {number[]} weeks ISO week numbers sampled.
 */

/**
 * @param {{dayOfWeek:number, startMinutes:number, durationMinutes:number, timezone:string}} meetingA
 * @param {{dayOfWeek:number, startMinutes:number, durationMinutes:number, timezone:string}} meetingB
 * @param {{referenceYear?:number}} [options] defaults to 2024
 * @returns {OverlapReport}
 */
export function describeOverlap(meetingA, meetingB, options = {}) {
  const referenceYear = options.referenceYear ?? 2024;
  const weeks = getIsoWeeksInYear(referenceYear);
  const weekly = weeks.map((w) => scoreOverlapForWeek(meetingA, meetingB, referenceYear, w));
  const mean = weekly.reduce((s, v) => s + v, 0) / weekly.length;
  const shorter = Math.min(meetingA.durationMinutes, meetingB.durationMinutes);
  const score = shorter > 0 ? mean / shorter : 0;
  return { score, meanOverlapMinutes: mean, weeklyOverlapMinutes: weekly, weeks };
}

/**
 * Single scalar score in [0, 1] for two meetings across the reference year.
 *
 * @param {{dayOfWeek:number, startMinutes:number, durationMinutes:number, timezone:string}} meetingA
 * @param {{dayOfWeek:number, startMinutes:number, durationMinutes:number, timezone:string}} meetingB
 * @param {{referenceYear?:number}} [options]
 * @returns {number}
 */
export function score(meetingA, meetingB, options = {}) {
  return describeOverlap(meetingA, meetingB, options).score;
}
