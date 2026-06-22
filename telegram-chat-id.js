export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Missing or invalid authorization" });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return res.status(500).json({ error: "Missing TELEGRAM_BOT_TOKEN" });
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
  const body = await response.json();
  if (!response.ok || !body.ok) {
    return res.status(500).json({ error: "Telegram getUpdates failed", details: body });
  }

  const chats = body.result
    .map((update) => update.message?.chat || update.channel_post?.chat)
    .filter(Boolean)
    .map((chat) => ({
      id: chat.id,
      type: chat.type,
      title: chat.title,
      username: chat.username,
      first_name: chat.first_name,
      last_name: chat.last_name
    }));

  const uniqueChats = [...new Map(chats.map((chat) => [chat.id, chat])).values()];
  return res.status(200).json({ chats: uniqueChats });
}
