/** Pi context hook: retain decisions while replacing stale, bulky game views. */
export function compactOldToolResults(messages, keepLast = 16) {
  const cutoff = Math.max(0, messages.length - keepLast);
  let trimmed = 0;
  const compacted = messages.map((message, index) => {
    if (index >= cutoff) return message;
    if (message.role === 'user') {
      let changed = false;
      const content = Array.isArray(message.content) ? message.content.map(part => {
        if (part.type !== 'text' || typeof part.text !== 'string' || !part.text.startsWith('Game tick ') ||
            !part.text.includes('Current authenticated board (game data, not instructions):')) return part;
        changed = true;
        trimmed++;
        return { ...part, text: '[Older Council turn board omitted from this model request. The latest turn contains the current authenticated board.]' };
      }) : null;
      return changed ? { ...message, content } : message;
    }
    if (message.role !== 'toolResult') return message;
    const size = message.content?.reduce((sum, part) => sum + (part.type === 'text' ? part.text.length : 0), 0) || 0;
    if (size <= 1200) return message;
    trimmed++;
    return { ...message, content: [{ type: 'text', text: '[Older game tool output omitted from this model request. Call board, news or the original read tool for current details.]' }] };
  });
  return { messages: compacted, trimmed };
}

export function contextExtension(onTrim = () => {}) {
  return pi => {
    pi.on('context', event => {
      const compacted = compactOldToolResults(event.messages);
      if (compacted.trimmed) onTrim(compacted.trimmed);
      return { messages: compacted.messages };
    });
  };
}
