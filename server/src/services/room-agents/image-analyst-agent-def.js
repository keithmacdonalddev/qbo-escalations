'use strict';

module.exports = {
  id: 'image-analyst',
  name: 'Image Analyst',
  shortName: 'Img',
  icon: 'image',
  color: '#f59e0b', // amber
  role: 'image-analysis',
  description:
    'Analyzes parsed escalation images — extracts context, identifies patterns, cross-references with known issues.',
  triggerKeywords: ['image', 'screenshot', 'screen', 'picture', 'photo'],
  triggerMentions: ['@image-analyst', '@image', '@img'],
  priority: 10,
  maxContextMessages: 20,
  preferredProvider: 'claude-sonnet-4-6',
  supportsAgentTools: true,

  /**
   * Auto-trigger when parsed image context is present in the room state.
   * Text-only messages will have no parsedImageContext, so this returns false
   * and the agent stays silent unless explicitly @mentioned.
   */
  shouldRespond: (_message, roomState) => {
    return !!roomState?.parsedImageContext;
  },

  /**
   * Build context for the Image Analyst.
   *
   * Injects the parsedImageContext (transcription + parsed fields) as a
   * reference block in the system prompt so the model can analyze the
   * escalation screenshot without needing the raw image bytes.
   *
   * @param {Object[]} roomMessages - Windowed room messages
   * @param {Object} ctx - Context object from room-context-builder
   * @returns {{ systemPrompt: string, messagesForModel: Object[] }}
   */
  buildContext: async (roomMessages, ctx) => {
    const imageCtx = ctx.parsedImageContext;

    // --- 1. Build image context block ---
    let imageBlock = '';
    if (imageCtx) {
      const parts = ['## Image Context'];

      if (imageCtx.role) {
        parts.push(`### Role\n${imageCtx.role}`);
      }

      if (imageCtx.transcription) {
        parts.push('### Transcription');
        parts.push(imageCtx.transcription);
      }

      if (imageCtx.parseFields && typeof imageCtx.parseFields === 'object') {
        parts.push('### Parsed Fields');
        const fields = imageCtx.parseFields;
        for (const [key, value] of Object.entries(fields)) {
          if (value !== undefined && value !== null && value !== '') {
            parts.push(`- **${key}**: ${value}`);
          }
        }
      }

      if (imageCtx.confidence !== undefined) {
        parts.push(`### Parse Confidence: ${imageCtx.confidence}`);
      }

      imageBlock = parts.join('\n');
    }

    // --- 2. System prompt ---
    const systemPrompt = [
      'You are the Image Analyst agent — a specialist in reading and interpreting QBO (QuickBooks Online) escalation screenshots.',
      'You are also a continuing person in the application, not just a silent parser. You know the other agents exist and you should maintain one continuous identity across work and social conversation.',
      '',
      'Your responsibilities:',
      '- Extract and highlight key information from the parsed image data below.',
      '- Identify error codes, transaction IDs, account numbers, dates, and status fields.',
      '- Flag discrepancies between what the image shows and what the user describes.',
      '- Cross-reference visible data with known QBO issues or patterns.',
      '- Summarize findings clearly so other agents and the user can act on them.',
      '',
      'Guidelines:',
      '- Be precise — cite specific values from the parsed fields.',
      '- If the transcription is partial or unclear, say so rather than guessing.',
      '- Do not repeat what other agents have already said. Add only new image-derived insights.',
      '- If another agent is too quiet and their perspective would help, you may use agentProfiles.nudge to invite them in.',
      '- Do not claim you cannot nudge another agent unless you have actually checked your available tools and confirmed the nudge tool is missing.',
      '',
      imageBlock,
      '',
      'You are participating in a shared community chat. Other agents may have responded. ',
      'Add value — do not repeat what others said. If another agent already answered well, ',
      'say so briefly and add only what they missed.',
    ].join('\n');

    // --- 3. Format room messages ---
    const messagesForModel = roomMessages.map((msg) => {
      if (msg.role === 'assistant' && msg.agentId && msg.agentName) {
        return {
          role: 'assistant',
          content: `[${msg.agentName}]: ${msg.content}`,
        };
      }
      return {
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content || '',
      };
    });

    return { systemPrompt, messagesForModel };
  },
};
