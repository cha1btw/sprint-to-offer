import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addDays, formatHm, kyivDate, minuteToUtc, parseHm, weekday } from "../lib/time.ts";

describe("Kyiv time helpers", () => {
  test("09:00 is UTC+3 before the clock change and UTC+2 after it", () => {
    assert.equal(minuteToUtc("2026-10-24", 540).toISOString(), "2026-10-24T06:00:00.000Z");
    assert.equal(minuteToUtc("2026-10-26", 540).toISOString(), "2026-10-26T07:00:00.000Z");
  });

  test("minutes past midnight belong to the next calendar day", () => {
    assert.equal(minuteToUtc("2026-11-02", 1470).toISOString(), "2026-11-02T22:30:00.000Z");
  });

  test("a time skipped in spring moves one hour later", () => {
    // 28 March 2027: clocks jump from 03:00 to 04:00.
    assert.equal(minuteToUtc("2027-03-28", 3 * 60 + 30).toISOString(), "2027-03-28T01:30:00.000Z");
  });

  test("kyivDate uses the Kyiv calendar, not UTC", () => {
    assert.equal(kyivDate(new Date("2026-10-19T22:30:00Z")), "2026-10-20");
  });

  test("weekday, addDays, formatHm and parseHm", () => {
    assert.equal(weekday("2026-10-19"), 1);
    assert.equal(weekday("2026-10-25"), 7);
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(formatHm(1470), "00:30");
    assert.equal(parseHm("7:05"), 425);
    assert.equal(parseHm("24:00"), null);
    assert.equal(parseHm("abc"), null);
  });
});
