/** Parse a model's pregame declaration without trusting its formatting. */
export function parseOpening(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  let value;
  try { value = JSON.parse(fenced ? fenced[1] : trimmed); }
  catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (typeof value.leaderName !== 'string' || typeof value.openingMessage !== 'string') return null;
  const leaderName = value.leaderName.trim();
  const openingMessage = value.openingMessage.trim();
  if (!leaderName || leaderName.length > 60 || !openingMessage || openingMessage.length > 500) return null;
  return { leaderName, openingMessage };
}
