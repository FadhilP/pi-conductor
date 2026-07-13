function messageText(message: any) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: any) =>
      part.type === "text" ? part.text : part.type === "image" ? "[image]" : "",
    )
    .join(" ");
}

export function promptText(message: any) {
  return messageText(message).slice(0, 80);
}

export function promptTitle(message: any) {
  const text = messageText(message).replace(/\s+/g, " ").trim();
  return text.length > 60 ? `${text.slice(0, 59).trimEnd()}…` : text;
}

export function extractSessionTitle(message: any) {
  if (!Array.isArray(message?.content)) return { message };
  const index = message.content.findLastIndex((part: any) => part.type === "text"),
    part = message.content[index],
    match = part?.text.match(
      /\s*<!-- pi-session-title:\s*([^<>\r\n]{1,200}?)\s*-->\s*$/i,
    );
  if (!match) return { title: undefined, message };
  const title = promptTitle({ content: match[1] }),
    text = part.text.slice(0, match.index).trimEnd(),
    content = [...message.content];
  text ? (content[index] = { ...part, text }) : content.splice(index, 1);
  return { title, message: { ...message, content } };
}
