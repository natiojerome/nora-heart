import { Temporal } from "@js-temporal/polyfill";
import {
  TaskError,
  type TaskCalendar,
  type TaskSchedule,
} from "../../../contracts/tasks.ts";
export class Calendar implements TaskCalendar {
  validate(value: unknown): TaskSchedule {
    try {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw Error();
      const s = value as TaskSchedule;
      if (
        typeof s.timezone !== "string" ||
        !s.timezone ||
        /^[+-]/.test(s.timezone)
      )
        throw Error();
      Temporal.Instant.from("2026-01-01T00:00:00Z").toZonedDateTimeISO(
        s.timezone,
      );
      if (s.kind === "once") {
        if (typeof s.at !== "string") throw Error();
        return {
          kind: "once",
          at: (/(?:Z|[+-]\d{2}:\d{2})$/.test(s.at)
            ? Temporal.Instant.from(s.at)
            : Temporal.PlainDateTime.from(s.at)
                .toZonedDateTime(s.timezone, { disambiguation: "compatible" })
                .toInstant()
          ).toString({ smallestUnit: "millisecond" }),
          timezone: s.timezone,
        };
      }
      if (
        s.kind !== "recurring" ||
        !["daily", "weekdays", "weekly"].includes(s.frequency) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.time)
      )
        throw Error();
      if (
        s.frequency === "weekly" &&
        (!Number.isInteger(s.weekday) || s.weekday! < 0 || s.weekday! > 6)
      )
        throw Error();
      return {
        kind: "recurring",
        frequency: s.frequency,
        time: s.time,
        timezone: s.timezone,
        ...(s.frequency === "weekly" ? { weekday: s.weekday } : {}),
      };
    } catch {
      throw new TaskError(
        "Planning invalide : préciser date, heure et fuseau IANA.",
      );
    }
  }
  next(schedule: TaskSchedule, after: string): string | null {
    const instant = Temporal.Instant.from(after);
    if (schedule.kind === "once")
      return Temporal.Instant.compare(schedule.at, instant) > 0
        ? schedule.at
        : null;
    let date = instant.toZonedDateTimeISO(schedule.timezone).toPlainDate();
    const [hour, minute] = schedule.time.split(":").map(Number);
    for (;;) {
      const weekday = date.dayOfWeek % 7,
        allowed =
          schedule.frequency === "daily" ||
          (schedule.frequency === "weekdays"
            ? weekday >= 1 && weekday <= 5
            : weekday === schedule.weekday);
      if (allowed) {
        const candidate = Temporal.ZonedDateTime.from(
          {
            year: date.year,
            month: date.month,
            day: date.day,
            hour,
            minute,
            timeZone: schedule.timezone,
          },
          { disambiguation: "compatible" },
        ).toInstant();
        if (Temporal.Instant.compare(candidate, instant) > 0)
          return candidate.toString({ smallestUnit: "millisecond" });
      }
      date = date.add({ days: 1 });
    }
  }
}
