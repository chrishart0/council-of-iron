/** Pi context hook: retain recent decisions while replacing bulky old tool responses. */
export function compactOldToolResults(messages, keepLast = 16) {
  const cutoff = Math.max(0, messages.length - keepLast);
  let trimmed = 0;
  const compacted = messages.map((message, index) => {
    if (index >= cutoff || message.role !== 'toolResult') return message;
    const size = message.content?.reduce((sum, part) => sum + (part.type === 'text' ? part.text.length : 0), 0) || 0;
    if (size <= 1200) return message;
    trimmed++;
    return { ...message, content: [{ type: 'text', text: '[Older game tool output omitted from this model request. Call situation or the original read tool for current details.]' }] };
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
