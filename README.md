# Meeting Time Overlap Scorer

Computes a similarity score between two recurring weekly meeting windows across timezones, accounting for DST shifts.

```js
import { score, describeOverlap } from "meeting-time-overlap-scorer";

const a = { dayOfWeek: 1, startMinutes: 540, durationMinutes: 60, timezone: "America/New_York" };
const b = { dayOfWeek: 1, startMinutes: 540, durationMinutes: 60, timezone: "Asia/Tokyo" };

score(a, b, { referenceYear: 2024 });

const overlap = describeOverlap(a, b, { referenceYear: 2024 });
overlap.score;
overlap.meanOverlapMinutes;
```

## Why

Scheduling the same recurring meeting across teams in different timezones is awkward: a 9am New York slot and a 9am London slot overlap in the morning most of the year but drift apart near a DST transition. A single "they overlap / they don't" answer misrepresents a year where they overlap 47 weeks and diverge 5.

This library samples the DST-sensitive overlap across every ISO week of a chosen reference year and reports the average, normalized by the shorter meeting length. The trade-off: sampling is O(weeks × meetings) rather than symbolically solving the IANA tz transition calendar, but it is correct for all IANA zones and needs no third-party tz database.

## Edge you will hit

`Intl.DateTimeFormat` is the only DST-aware primitive in the standard library, and it operates in wall-clock terms. To find whether two windows overlap in *UTC* on a given week, this library converts each meeting's wall-clock start to a UTC instant for that ISO week and then compares instants. If either timezone has an ambiguous or nonexistent local time during a given week's transition (a spring-forward gap or fall-back fold), the wall-clock-to-UTC conversion is inherently ambiguous; `Intl` resolves it deterministically by the host's rules, and this library accepts whatever `Intl` returns for that week. Do not rely on sub-minute resolution during transition weeks.

The reference year is a constructor argument, not the current year. Pass an explicit year in tests so scores are reproducible across machines and across runs.

## Exports

- `score(meetingA, meetingB, options): number` — 0..1 overlap score.
- `describeOverlap(meetingA, meetingB, options): OverlapReport` — full report.
- `scoreOverlapForWeek(meeting, other, isoYear, isoWeek): number` — overlap minutes for a single ISO week.
- `meetingToUtcInstant(meeting, isoYear, isoWeek): number` — UTC ms for the meeting's start in a given ISO week.
- `getIsoWeeksInYear(isoYear): number[]` — list of ISO week numbers (1..52 or 53).

## Design notes

The window stores values eagerly rather than keeping running aggregates. Running
sums drift with floating point over long streams, and recomputing from a small
buffer is cheap enough that the drift is not worth the speed.

## Limitations

Values are coerced to floats, so very large integers lose precision. If you need
exact integer aggregates over a window, this is the wrong tool.

