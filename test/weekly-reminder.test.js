import test from "node:test";
import assert from "node:assert/strict";
import { __test } from "../api/weekly-reminder.js";

const week = {
  start: new Date("2026-06-29T00:00:00.000Z"),
  end: new Date("2026-07-05T23:59:59.999Z")
};

test("does not shift old activities into the target week", () => {
  const messages = [
    {
      date: new Date("2026-06-19T16:00:00.000Z"),
      subject: "Year 2 Summer Performance",
      text: "Year 2 performance will be held on Wednesday 24th June at 14:00."
    },
    {
      date: new Date("2026-06-09T16:00:00.000Z"),
      subject: "Move Up transition morning",
      text: "Year 2 pupils will attend Move-Up morning on Wednesday 17th June at 09:00."
    },
    {
      date: new Date("2026-06-20T10:00:00.000Z"),
      subject: "Botanic Gardens trip",
      text: "Year 2 visit on Monday 22nd June. We leave at 9:15am and return at 3:30pm."
    }
  ];

  assert.deepEqual(__test.extractWeeklyYear2Events(messages, week), []);
});

test("merges duplicate reminders and complementary performance details", () => {
  const messages = [
    {
      date: new Date("2026-06-27T10:00:00.000Z"),
      subject: "Year 2 Botanic Gardens trip",
      text:
        "On Monday 29th June 2026, Year 2 will visit the Botanic Gardens. " +
        "We leave at 9:15am and aim to be back for 3:30pm. " +
        "Please wear school uniform and bring a backpack and water bottle."
    },
    {
      date: new Date("2026-06-28T10:00:00.000Z"),
      subject: "Reminder: Year 2 Botanic Gardens trip",
      text:
        "Reminder for Monday 29th June 2026: Year 2 Botanic Gardens trip. " +
        "We leave at 9:15am and return at 3:30pm."
    },
    {
      date: new Date("2026-06-28T10:00:00.000Z"),
      subject: "Year 2 Summer Performance",
      text:
        "The Year 2 performance is on Wednesday 1st July 2026. " +
        "It begins promptly at 14:00 and will end at 15:00. " +
        "Please do not arrive before 13:45. Photography or recordings are not permitted."
    },
    {
      date: new Date("2026-06-29T10:00:00.000Z"),
      subject: "Year 2 costumes, Summer Performance",
      text:
        "For the Year 2 performance on Wednesday 1st July 2026, " +
        "children with thicker costumes or onesies should bring shorts and T-shirts."
    }
  ];

  const events = __test.extractWeeklyYear2Events(messages, week);
  const text = __test.formatTelegramMessage(events, week);

  assert.equal(events.length, 2);
  assert.match(text, /Mon 29 Jun, 9:15am-3:30pm: Year 2 Botanic Gardens trip/);
  assert.match(text, /Wed 1 Jul, 14:00-15:00: Year 2 Summer Performance/);
  assert.match(text, /arrive no earlier than 13:45/);
  assert.match(text, /thick costumes: bring shorts and a T-shirt/);
  assert.match(text, /no parent photography or recording/);
  assert.equal((text.match(/Year 2 Botanic Gardens trip/g) || []).length, 1);
  assert.equal((text.match(/Year 2 Summer Performance/g) || []).length, 1);
});
