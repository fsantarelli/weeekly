import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import * as chrono from "chrono-node";

export const config = {
  maxDuration: 300
};

const LONDON_TIME_ZONE = "Europe/London";
const SCHOOL_MATCHES = [
  "santarelli@gmail.com",
  "@kingsely.org",
  "@kings-ely.schoolpostmail.co.uk"
];

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authError = validateRequest(req);
  if (authError) {
    return res.status(401).json({ error: authError });
  }

  try {
    const env = readEnv();
    const now = new Date();
    const period = req.query?.period === "current" ? "current" : "next";
    const week = getSchoolWeek(now, period);
    const messages = await fetchSchoolMessages(env, week.lookbackStart);
    const events = extractWeeklyYear2Events(messages, week);
    const text = formatTelegramMessage(events, week, period);

    const preview = req.query?.preview === "1" || req.query?.preview === "true";
    if (!preview) {
      await sendTelegramMessage(env, text);
    }

    return res.status(200).json({
      ok: true,
      preview,
      period,
      messagesScanned: messages.length,
      eventsFound: events.length,
      weekStart: dateKey(week.start),
      weekEnd: dateKey(week.end),
      text
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || "Unexpected error" });
  }
}

function validateRequest(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return null;
  }

  const header = req.headers.authorization || "";
  if (header === `Bearer ${secret}`) {
    return null;
  }

  return "Missing or invalid cron authorization";
}

function readEnv() {
  const env = {
    zohoEmail: process.env.ZOHO_EMAIL,
    zohoPassword: process.env.ZOHO_APP_PASSWORD,
    imapHost: process.env.IMAP_HOST || "imap.zoho.eu",
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramChatId: process.env.TELEGRAM_CHAT_ID,
    imapFolders: parseCsv(process.env.IMAP_FOLDERS || "INBOX,Newsletter,Archive")
  };

  const missing = Object.entries(env)
    .filter(([key, value]) => {
      if (key === "imapFolders") return value.length === 0;
      return !value;
    })
    .map(([key]) => key);

  if (missing.length) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }

  return env;
}

async function fetchSchoolMessages(env, since) {
  const client = new ImapFlow({
    host: env.imapHost,
    port: 993,
    secure: true,
    auth: {
      user: env.zohoEmail,
      pass: env.zohoPassword
    },
    logger: false
  });

  const messages = [];
  await client.connect();

  try {
    for (const folder of env.imapFolders) {
      try {
        await client.mailboxOpen(folder, { readOnly: true });
      } catch (error) {
        console.warn(`Skipping mailbox ${folder}: ${error.message}`);
        continue;
      }

      const ids = await client.search({ since });
      if (!ids.length) {
        continue;
      }

      for await (const message of client.fetch(ids, { source: true, envelope: true, internalDate: true })) {
        const parsed = await simpleParser(message.source);
        const from = parsed.from?.text || message.envelope?.from?.map(formatAddress).join(", ") || "";
        const subject = parsed.subject || message.envelope?.subject || "";
        const text = sanitizeEmailText(parsed.text || stripHtml(parsed.html || ""));
        const haystack = `${from}\n${subject}\n${text}`.toLowerCase();

        if (!SCHOOL_MATCHES.some((match) => haystack.includes(match))) {
          continue;
        }

        messages.push({
          folder,
          date: parsed.date || message.internalDate,
          from,
          subject: normalizeText(subject),
          text
        });
      }
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return messages;
}

function extractWeeklyYear2Events(messages, week) {
  const eventsByKey = new Map();

  for (const message of messages) {
    const candidateText = `${message.subject}\n${message.text}`;
    if (!hasYear2Signal(candidateText) && !isRelevantGeneralNotice(candidateText)) {
      continue;
    }

    const windows = windowsAroundWeekDates(candidateText, week, message.date);
    for (const { date, text } of windows) {
      if (
        !hasYear2Signal(text) &&
        !hasYear2Signal(message.subject) &&
        !isRelevantGeneralNotice(text)
      ) {
        continue;
      }

      const detailText = hasYear2Signal(message.subject) ? candidateText : text;
      const event = buildEvent(message.subject, detailText, date);
      if (!event) {
        continue;
      }

      const key = `${dateKey(event.date)}|${event.type}`;
      const current = eventsByKey.get(key);
      eventsByKey.set(key, current ? mergeEvents(current, event) : event);
    }
  }

  return [...eventsByKey.values()].sort((a, b) => {
    const dateDiff = a.date.getTime() - b.date.getTime();
    if (dateDiff !== 0) return dateDiff;
    return (a.time || "").localeCompare(b.time || "");
  });
}

function windowsAroundWeekDates(text, week, messageDate) {
  const normalized = normalizeText(text);
  const paragraphs = normalized.split(/\n{2,}|(?<=\.)\s+(?=[A-Z])/);
  const windows = [];
  const referenceDate = messageDate instanceof Date ? messageDate : new Date(messageDate);
  const messageHasExplicitDates = hasExplicitCalendarDate(normalized);

  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    const paragraphHasExplicitDate = hasExplicitCalendarDate(paragraph);
    if (messageHasExplicitDates && !paragraphHasExplicitDate) {
      continue;
    }

    const parsedDates = parseDates(paragraph, referenceDate, {
      forwardDate: !paragraphHasExplicitDate
    }).filter((parsed) => hasDateExpression(parsed.text));

    for (const parsed of parsedDates) {
      const date = parsed.start.date();
      if (!isWithin(date, week.start, week.end)) {
        continue;
      }

      const windowText = [
        paragraphs[index - 1],
        paragraph,
        paragraphs[index + 1],
        paragraphs[index + 2],
        paragraphs[index + 3]
      ]
        .filter(Boolean)
        .join("\n");

      windows.push({ date, text: windowText });
    }
  }

  return dedupeWindows(windows);
}

function hasYear2Signal(text) {
  return /\b(year\s*2|y2)\b/i.test(text);
}

function isRelevantGeneralNotice(text) {
  return /\b(?:summer uniform|pe kit|school closed|school closure)\b/i.test(text);
}

function hasDateExpression(text) {
  return /\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|today|tomorrow|week commencing)\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/i.test(
    text
  );
}

function hasExplicitCalendarDate(text) {
  return /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/i.test(
    text
  );
}

function parseDates(text, referenceDate, options = { forwardDate: true }) {
  const parsers = [
    chrono.en?.GB?.casual,
    chrono.en?.GB,
    chrono.en?.casual,
    chrono.casual,
    chrono
  ];

  for (const parser of parsers) {
    if (typeof parser?.parse === "function") {
      return parser.parse(text, referenceDate, options);
    }
  }

  throw new Error("No compatible chrono-node parser found");
}

function dedupeWindows(windows) {
  const seen = new Set();
  return windows.filter((window) => {
    const key = `${dateKey(window.date)}|${window.text}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function mergeEvents(current, incoming) {
  const time =
    timeSpecificity(incoming.time) > timeSpecificity(current.time)
      ? incoming.time
      : current.time;

  return {
    ...current,
    time,
    details: [...new Set([...current.details, ...incoming.details])],
    score: Math.max(current.score, incoming.score)
  };
}

function timeSpecificity(value) {
  if (!value) return 0;
  if (value.includes("-")) return 2;
  return 1;
}

function buildEvent(subject, text, date) {
  const combined = `${subject}\n${text}`;
  const lower = combined.toLowerCase();

  if (lower.includes("performance")) {
    const start = firstTime(combined, [
      /(?:begin|starts?|commence)\w*\s+(?:promptly\s+)?at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
      /performance[^.\n]*?\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i
    ]);
    const end = firstTime(combined, [
      /(?:end|finish|conclude)\w*[^.\n]*?\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i
    ]);
    const arrival = firstTime(combined, [
      /not\s+(?:to\s+)?arrive[^.\n]*?before\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i
    ]);
    const notes = [];
    if (/thick(?:er)? costumes?|onesies/i.test(combined)) {
      notes.push("thick costumes: bring shorts and a T-shirt");
    }
    if (/photography or recordings[^.\n]*not permitted|no photography/i.test(combined)) {
      notes.push("no parent photography or recording");
    }
    if (/wrap ?around care/i.test(combined)) {
      notes.push("collection after the show unless wraparound is booked");
    }

    return {
      date,
      type: "performance",
      title: "Year 2 Summer Performance",
      time: formatTimeRange(start, end),
      details: [
        arrival ? `Parents: arrive no earlier than ${arrival}` : null,
        ...notes
      ].filter(Boolean),
      score: 20 + notes.length + Boolean(start) + Boolean(end)
    };
  }

  if (/\b(botanic gardens?|botanic garden)\b/i.test(combined)) {
    const leave = firstTime(combined, [
      /(?:leave|leaving|depart)\w*[^.\n]*?\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i
    ]);
    const back = firstTime(combined, [
      /(?:back|return|arrival back)[^.\n]*?\b(?:for|at|by)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i
    ]);
    const bring = [];
    if (/backpack/i.test(combined)) bring.push("backpack");
    if (/water bottle/i.test(combined)) bring.push("water bottle");
    if (/sun ?hat/i.test(combined)) bring.push("sun hat");
    if (/rain ?coat/i.test(combined)) bring.push("raincoat");

    return {
      date,
      type: "botanic-trip",
      title: "Year 2 Botanic Gardens trip",
      time: formatTimeRange(leave, back),
      details: [
        /school uniform/i.test(combined) ? "School uniform" : null,
        bring.length ? `Bring: ${bring.join(", ")}` : null
      ].filter(Boolean),
      score: 20 + bring.length + Boolean(leave) + Boolean(back)
    };
  }

  if (/\bmove[- ]?up|transition morning\b/i.test(combined)) {
    const start = firstTime(combined, [
      /(?:from|at|promptly at)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i
    ]);
    return {
      date,
      type: "move-up",
      title: "Year 2 Move-Up morning",
      time: start,
      details: ["Year 2 pupils visit the Prep school and Year 3 teaching team"],
      score: 10 + Boolean(start)
    };
  }

  if (/\bswimming lessons?\b/i.test(combined)) {
    return {
      date,
      type: "swimming",
      title: "Year 2 swimming lesson",
      time: /\bmorning\b/i.test(combined) ? "morning" : "",
      details: [],
      score: 5
    };
  }

  if (/\b(?:summer uniform|pe kit)\b/i.test(combined)) {
    return {
      date,
      type: "uniform",
      title: "Hot-weather uniform adjustment",
      time: "",
      details: ["PE kit may be worn instead of summer uniform"],
      score: 5
    };
  }

  return null;
}

function firstTime(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return normalizeTime(match[1]);
    }
  }
  return "";
}

function formatTimeRange(start, end) {
  if (start && end) return `${start}-${end}`;
  return start || end || "";
}

function formatTelegramMessage(events, week, period = "next") {
  const label = period === "current" ? "Year 2, remaining this week" : "Year 2 this week";
  const header = `${label}: ${formatDate(week.start)} - ${formatDate(week.end)}`;
  if (!events.length) {
    return `${header}\n\nNo Year 2 activities found in the latest school emails.`;
  }

  const lines = [header, ""];
  for (const event of events) {
    const timeText = event.time ? `, ${event.time}` : "";
    lines.push(`- ${formatDate(event.date)}${timeText}: ${event.title}`);
    for (const detail of event.details) {
      lines.push(`  ${detail}`);
    }
  }

  return lines.join("\n");
}

async function sendTelegramMessage(env, text) {
  const response = await fetch(`https://api.telegram.org/bot${env.telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: env.telegramChatId,
      text,
      disable_web_page_preview: true
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram send failed: ${response.status} ${body}`);
  }
}

function getSchoolWeek(now, period = "next") {
  const londonNow = londonDateAtNoon(now);
  const day = londonNow.getUTCDay();
  let start;
  let end;

  if (period === "current") {
    start = londonNow;
    end = addDays(londonNow, day === 0 ? 0 : 7 - day);
  } else {
    const daysUntilMonday = (8 - day) % 7 || 7;
    start = addDays(londonNow, daysUntilMonday);
    end = addDays(start, 6);
  }

  const lookbackStart = addDays(londonNow, -45);

  return {
    start: startOfUtcDay(start),
    end: endOfUtcDay(end),
    lookbackStart: startOfUtcDay(lookbackStart)
  };
}

function londonDateAtNoon(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LONDON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), 12));
}

function isWithin(date, start, end) {
  return date >= start && date <= end;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short"
  }).format(date);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function endOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}

function sanitizeEmailText(value) {
  return normalizeText(value)
    .replace(/^Exchange Received:.*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

function cleanTitle(value) {
  return normalizeText(value)
    .replace(/\s+/g, " ")
    .replace(/^[*: -]+|[*: -]+$/g, "")
    .slice(0, 120);
}

function sentenceCase(value) {
  const text = cleanTitle(value);
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Year 2 activity";
}

function normalizeTime(value) {
  return value.replace(/\s+/g, "").toLowerCase();
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatAddress(address) {
  const mailbox = address.address || `${address.mailbox || ""}@${address.host || ""}`;
  return address.name ? `${address.name} <${mailbox}>` : mailbox;
}

export const __test = {
  extractWeeklyYear2Events,
  formatTelegramMessage,
  getSchoolWeek
};
