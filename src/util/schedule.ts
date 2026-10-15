import { KitError } from "../errors.js";
import type { ProviderName } from "../types.js";

export interface NormalizedSchedule {
  /** Original expression from YAML. */
  raw: string;
  /** Five-field cron, minute hour day month dow. */
  unix: string;
  /** AWS EventBridge schedule expression: rate(...) or cron(...). */
  aws: string;
  /** Azure NCRONTAB: second minute hour day month dow. */
  azure: string;
  /** Six-field cron with seconds, used by Huawei, Alibaba, and Tencent timers. */
  seconds: string;
}

const RATE = /^rate\(\s*(\d+)\s+(minute|minutes|hour|hours|day|days)\s*\)$/i;
const AWS_CRON = /^cron\(\s*([^)]+?)\s*\)$/i;

export function normalizeSchedule(expression: string, _timezone: string): NormalizedSchedule {
  const raw = expression.trim();
  const rate = RATE.exec(raw);
  if (rate) {
    const every = Number(rate[1]);
    const unit = rate[2].toLowerCase();
    return fromRate(raw, every, unit);
  }
  const awsCron = AWS_CRON.exec(raw);
  if (awsCron) {
    return fromAwsCron(raw, awsCron[1].trim());
  }
  const fields = raw.split(/\s+/);
  if (fields.length === 5) {
    return fromUnix(raw, fields);
  }
  if (fields.length === 6) {
    return fromSeconds(raw, fields);
  }
  throw new KitError(
    `Schedule "${expression}" is not a rate(...), an AWS cron(...), a 5-field cron, or a 6-field cron.`,
  );
}

function awsRate(every: number, unit: string): string {
  const base = unit.startsWith("minute") ? "minute" : unit.startsWith("hour") ? "hour" : "day";
  return `rate(${every} ${every === 1 ? base : `${base}s`})`;
}

function fromRate(raw: string, every: number, unit: string): NormalizedSchedule {
  if (every < 1) throw new KitError(`Schedule rate must be at least 1: ${raw}`);
  let unix: string;
  if (unit.startsWith("minute")) {
    if (every === 1) unix = "* * * * *";
    else if (60 % every === 0) unix = `*/${every} * * * *`;
    else {
      throw new KitError(
        `rate(${every} ${unit}) cannot be converted to cron because ${every} does not divide 60. Use a 5-field cron expression.`,
      );
    }
  } else if (unit.startsWith("hour")) {
    if (every === 1) unix = "0 * * * *";
    else if (24 % every === 0) unix = `0 */${every} * * *`;
    else {
      throw new KitError(
        `rate(${every} ${unit}) cannot be converted to cron because ${every} does not divide 24. Use a 5-field cron expression.`,
      );
    }
  } else {
    if (every !== 1) {
      throw new KitError(`Only rate(1 day) is supported. For other day intervals, use a cron expression.`);
    }
    unix = "0 0 * * *";
  }
  const [minute, hour, day, month, dow] = unix.split(" ");
  return {
    raw,
    unix,
    aws: awsRate(every, unit),
    azure: `0 ${minute} ${hour} ${day} ${month} ${dow}`,
    seconds: `0 ${minute} ${hour} ${day} ${month} ${dow}`,
  };
}

function fromAwsCron(raw: string, inner: string): NormalizedSchedule {
  const fields = inner.split(/\s+/);
  if (fields.length !== 6) {
    throw new KitError(`AWS cron() must have 6 fields (minute hour day-of-month month day-of-week year). Got "${inner}".`);
  }
  const [minute, hour, day, month, dow, year] = fields;
  const unixDow = dow === "?" ? "*" : dow;
  const unixDay = day === "?" ? "*" : day;
  const unix = `${minute} ${hour} ${unixDay} ${month} ${unixDow}`;
  return {
    raw,
    unix,
    aws: `cron(${minute} ${hour} ${day} ${month} ${dow} ${year ?? "*"})`,
    azure: `0 ${minute} ${hour} ${unixDay} ${month} ${unixDow}`,
    seconds: `0 ${minute} ${hour} ${unixDay} ${month} ${unixDow}`,
  };
}

function fromUnix(raw: string, fields: string[]): NormalizedSchedule {
  const [minute, hour, day, month, dow] = fields;
  let awsDay = day;
  let awsDow = dow;
  if (day === "*" && (dow === "*" || dow === "?")) awsDow = "?";
  else if (dow !== "*" && dow !== "?" && (day === "*" || day === "?")) awsDay = "?";
  else if (day !== "*" && day !== "?" && (dow === "*" || dow === "?")) awsDow = "?";
  return {
    raw,
    unix: fields.join(" "),
    aws: `cron(${minute} ${hour} ${awsDay} ${month} ${awsDow} *)`,
    azure: `0 ${minute} ${hour} ${day} ${month} ${dow}`,
    seconds: `0 ${minute} ${hour} ${day} ${month} ${dow}`,
  };
}

function fromSeconds(raw: string, fields: string[]): NormalizedSchedule {
  const [second, minute, hour, day, month, dow] = fields;
  if (second !== "0" && second !== "00") {
    throw new KitError(
      `Schedule "${raw}" has a non-zero seconds field. Cloud schedulers in this kit run at most once a minute. Use second 0.`,
    );
  }
  const unix = `${minute} ${hour} ${day} ${month} ${dow}`;
  return fromUnix(unix, unix.split(" "));
}

export function scheduleFor(provider: ProviderName, schedule: NormalizedSchedule): { expression: string; timezone: string } {
  switch (provider) {
    case "aws":
      return { expression: schedule.aws, timezone: "UTC" };
    case "azure":
      return { expression: schedule.azure, timezone: "UTC" };
    case "alibaba":
    case "tencent":
    case "huawei":
      return { expression: schedule.seconds, timezone: "UTC" };
    default:
      return { expression: schedule.unix, timezone: "UTC" };
  }
}
