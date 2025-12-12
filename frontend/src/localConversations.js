const INDEX_KEY = 'llmc:index:v1';
const CONV_PREFIX = 'llmc:conv:v1:';

function convKey(id) {
  return `${CONV_PREFIX}${id}`;
}

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getIndex() {
  const raw = localStorage.getItem(INDEX_KEY);
  const idx = raw ? safeJsonParse(raw, []) : [];
  return Array.isArray(idx) ? idx : [];
}

function setIndex(index) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

function upsertIndexItem(item) {
  const index = getIndex();
  const existingIdx = index.findIndex((c) => c.id === item.id);
  const nextItem = {
    id: item.id,
    created_at: item.created_at,
    title: item.title || 'New Conversation',
    message_count: item.message_count ?? 0,
  };

  if (existingIdx >= 0) index[existingIdx] = nextItem;
  else index.unshift(nextItem);

  // newest first
  index.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  setIndex(index);
  return index;
}

function randomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const localConversations = {
  list() {
    return getIndex();
  },

  create() {
    const id = randomId();
    const conversation = {
      id,
      created_at: nowIso(),
      title: 'New Conversation',
      messages: [],
    };
    localStorage.setItem(convKey(id), JSON.stringify(conversation));
    const index = upsertIndexItem({
      id,
      created_at: conversation.created_at,
      title: conversation.title,
      message_count: 0,
    });
    return { conversation, index };
  },

  get(id) {
    const raw = localStorage.getItem(convKey(id));
    if (!raw) return null;
    const conv = safeJsonParse(raw, null);
    return conv && typeof conv === 'object' ? conv : null;
  },

  save(conversation) {
    if (!conversation?.id) throw new Error('Conversation missing id');
    localStorage.setItem(convKey(conversation.id), JSON.stringify(conversation));

    const index = upsertIndexItem({
      id: conversation.id,
      created_at: conversation.created_at || nowIso(),
      title: conversation.title || 'New Conversation',
      message_count: Array.isArray(conversation.messages) ? conversation.messages.length : 0,
    });
    return index;
  },

  updateTitle(id, title) {
    const conv = this.get(id);
    if (!conv) return null;
    const next = { ...conv, title: title || conv.title };
    const index = this.save(next);
    return { conversation: next, index };
  },

  remove(id) {
    localStorage.removeItem(convKey(id));
    const index = getIndex().filter((c) => c.id !== id);
    setIndex(index);
    return index;
  },
};


