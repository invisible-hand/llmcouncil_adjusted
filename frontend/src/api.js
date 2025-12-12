/**
 * API client for the LLM Council backend.
 */

const API_BASE =
  import.meta.env.VITE_API_BASE ?? (import.meta.env.PROD ? '' : 'http://localhost:8001');

export const api = {
  /**
   * List all conversations.
   */
  async listConversations() {
    const response = await fetch(`${API_BASE}/api/conversations`);
    if (!response.ok) {
      throw new Error('Failed to list conversations');
    }
    return response.json();
  },

  /**
   * Get available models.
   */
  async getModels() {
    const response = await fetch(`${API_BASE}/api/models`);
    if (!response.ok) {
      throw new Error('Failed to get models');
    }
    return response.json();
  },

  /**
   * Create a new conversation.
   */
  async createConversation() {
    const response = await fetch(`${API_BASE}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      throw new Error('Failed to create conversation');
    }
    return response.json();
  },

  /**
   * Get a specific conversation.
   */
  async getConversation(conversationId) {
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}`
    );
    if (!response.ok) {
      throw new Error('Failed to get conversation');
    }
    return response.json();
  },

  /**
   * Send a message in a conversation.
   */
  async sendMessage(conversationId, content, options = {}) {
    const { chairmanModel = null, councilModels = null, skipClarification = false } = options;
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          content, 
          chairman_model: chairmanModel,
          council_models: councilModels,
          skip_clarification: skipClarification
        }),
      }
    );
    if (!response.ok) {
      throw new Error('Failed to send message');
    }
    return response.json();
  },

  /**
   * Send a message and receive streaming updates.
   * @param {string} conversationId - The conversation ID
   * @param {string} content - The message content
   * @param {function} onEvent - Callback function for each event: (eventType, data) => void
   * @param {object} options - Optional settings { chairmanModel, councilModels, skipClarification }
   * @returns {Promise<void>}
   */
  async sendMessageStream(conversationId, content, onEvent, options = {}) {
    const { chairmanModel = null, councilModels = null, skipClarification = false, isFirstMessage = false } = options;
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message/stream`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          content, 
          chairman_model: chairmanModel,
          council_models: councilModels,
          skip_clarification: skipClarification,
          is_first_message: isFirstMessage
        }),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to send message');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          try {
            const event = JSON.parse(data);
            onEvent(event.type, event);
          } catch (e) {
            console.error('Failed to parse SSE event:', e);
          }
        }
      }
    }
  },

  /**
   * Speech-to-text: upload an audio blob and receive transcript text.
   * @param {Blob} audioBlob
   * @param {object} options - { format?: string, model?: string }
   */
  async speechToText(audioBlob, options = {}) {
    const { format = 'wav', model = null } = options;
    const form = new FormData();
    form.append('file', audioBlob, `speech.${format}`);
    form.append('format', format);
    if (model) form.append('model', model);

    const response = await fetch(`${API_BASE}/api/stt`, {
      method: 'POST',
      body: form,
    });
    if (!response.ok) {
      throw new Error('Failed to transcribe audio');
    }
    return response.json();
  },
};
