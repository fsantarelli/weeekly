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
    const week = getNextSchoolWeek(now);
    const messages = await fetchSchoolMessages(env, week.lookbackStart);
    const events = extractWeeklyYear2Events(messages, week);
    const text = formatTelegramMessage(events, week);

    await sendTelegramMessage(env, text);

    return res.status(200).json({
      ok: true,
      messagesScanned: messages.length,
      eventsFound: events.length,
      weekStart: dateKey(week.start),
      weekEnd: dateKey(week.end)
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
        const text = normalizeText(parsed.text || stripHtml(parsed.html || ""));
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
    if (!hasYear2Signal(candidateText)) {
      continue;
    }

    const windows = windowsAroundWeekDates(candidateText, week);
    for (const windowText of windows) {
      if (!hasYear2Signal(windowText) && !hasYear2Signal(message.subject)) {
        continue;
      }

      const parsedDates = chrono.en.GB.casual.parse(windowText, week.start, { forwardDate: true });
      for (const parsed of parsedDates) {
        const start = parsed.start.date();
        if (!isWithin(start, week.start, week.end)) {
          continue;
        }

        const title = inferTitle(message.subject, windowText);
        const times = extractTimes(windowText);
        const notes = inferNotes(windowText);
        const key = `${dateKey(start)}|${title}|${times.join(",")}`;

        if (!eventsByKey.has(key)) {
          eventsByKey.set(key, {
            date: start,
            title,
            times,
            notes,
            sourceSubject: message.subject
          });
        }
      }
    }
  }

  return [...eventsByKey.values()].sort((a, b) => {
    const dateDiff = a.date.getTime() - b.date.getTime();
    if (dateDiff !== 0) return dateDiff;
    return (a.times[0] || "").localeCompare(b.times[0] || "");
  });
}

function windowsAroundWeekDates(text, week) {
  const normalized = normalizeText(text);
  const paragraphs = normalized.split(/\n{2,}|(?<=\.)\s+(?=[A-Z])/);
  const windows = [];

  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    const parsedDates = chrono.en.GB.casual.parse(paragraph, week.start, { forwardDate: true });
    const hasWeekDate = parsedDates.some((parsed) => isWithin(parsed.start.date(), week.start, week.end));
    if (!hasWeekDate) {
      continue;
    }

    windows.push(
      [
        paragraphs[index - 1],
        paragraph,
        paragraphs[index + 1],
        paragraphs[index + 2]
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return windows;
}

function hasYear2Signal(text) {
  return /\b(year\s*2|y2)\b/i.test(text);
}

function inferTitle(subject, text) {
  const combined = `${subject}\n${text}`;
  const subjectTitle = subject.replace(/^fwd:\s*/i, "").trim();

  const patterns = [
    /year\s*2[^.\n]*(trip|visit)[^.\n]*/i,
    /year\s*2[^.\n]*(performance)[^.\n]*/i,
    /year\s*2[^.\n]*(swimming|club|concert|meeting)[^.\n]*/i,
    /(?:trip|visit)[^.\n]*(year\s*2|botanic|garden)[^.\n]*/i,
    /(?:performance)[^.\n]*(year\s*2|Hayward)[^.\n]*/i
  ];

  for (const pattern of patterns) {
    const match = combined.match(pattern);
    if (match) {
      return sentenceCase(cleanTitle(match[0]));
    }
  }

  return sentenceCase(cleanTitle(subjectTitle || "Year 2 activity"));
}

function extractTimes(text) {
  const times = new Set();
  const patterns = [
    /\b(?:at|from|by|before|after|until|for)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/gi,
    /\b(\d{1,2}:\d{2}\s*(?:am|pm)?)\b/gi,
    /\b(\d{1,2}\s*(?:am|pm))\b/gi
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      times.add(normalizeTime(match[1]));
    }
  }

  return [...times];
}

function inferNotes(text) {
  const noteBits = [];
  const lower = text.toLowerCase();

  if (lower.includes("backpack")) noteBits.push("bring backpack");
  if (lower.includes("water bottle")) noteBits.push("bring water bottle");
  if (lower.includes("sun hat") || lower.includes("sunhat")) noteBits.push("bring sun hat");
  if (lower.includes("raincoat") || lower.includes("rain coat")) noteBits.push("bring raincoat");
  if (lower.includes("school uniform")) noteBits.push("school uniform");
  if (lower.includes("no photography") || lower.includes("photography or recordings")) {
    noteBits.push("no parent photography/recording");
  }
  if (lower.includes("wrap around") || lower.includes("wraparound")) {
    noteBits.push("wraparound as booked");
  }

  return noteBits;
}

function formatTelegramMessage(events, week) {
  const header = `Year 2 activities: ${formatDate(week.start)} - ${formatDate(week.end)}`;
  if (!events.length) {
    return `${header}\n\nNo Year 2 activities found in the latest school emails.`;
  }

  const lines = [header, ""];
  for (const event of events) {
    const timeText = event.times.length ? ` (${event.times.join(", ")})` : "";
    const notesText = event.notes.length ? `\n   Notes: ${event.notes.join("; ")}` : "";
    lines.push(`- ${formatDate(event.date)}${timeText}: ${event.title}${notesText}`);
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

function getNextSchoolWeek(now) {
  const londonNow = londonDateAtNoon(now);
  const day = londonNow.getUTCDay();
  const daysUntilMonday = (8 - day) % 7 || 7;
  const start = addDays(londonNow, daysUntilMonday);
  const end = addDays(start, 6);
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
