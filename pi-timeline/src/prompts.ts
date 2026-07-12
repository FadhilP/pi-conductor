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
