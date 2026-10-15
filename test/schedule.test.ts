import assert from "node:assert/strict";
import { test } from "node:test";
import { KitError } from "../src/errors.js";
import { normalizeSchedule } from "../src/util/schedule.js";

test("rate(1 minutes) becomes a singular AWS rate and a unix cron", () => {
  const schedule = normalizeSchedule("rate(1 minutes)", "UTC");
  assert.equal(schedule.aws, "rate(1 minute)");
  assert.equal(schedule.unix, "* * * * *");
  assert.equal(schedule.azure, "0 * * * * *");
  assert.equal(schedule.seconds, "0 * * * * *");
});

test("rate(5 minutes) divides the hour", () => {
  const schedule = normalizeSchedule("rate(5 minutes)", "UTC");
  assert.equal(schedule.aws, "rate(5 minutes)");
  assert.equal(schedule.unix, "*/5 * * * *");
});

test("a rate that does not divide 60 is rejected", () => {
  assert.throws(() => normalizeSchedule("rate(7 minutes)", "UTC"), KitError);
});

test("five-field cron is copied and AWS cron uses ? for one day field", () => {
  const schedule = normalizeSchedule("15 1 * * *", "UTC");
  assert.equal(schedule.unix, "15 1 * * *");
  assert.equal(schedule.aws, "cron(15 1 * * ? *)");
  assert.equal(schedule.seconds, "0 15 1 * * *");
});

test("AWS cron() is accepted", () => {
  const schedule = normalizeSchedule("cron(0 12 * * ? *)", "UTC");
  assert.match(schedule.unix, /^\S+ \S+ \S+ \S+ \S+$/);
});
