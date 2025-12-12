import { useState } from 'react';
import './Sidebar.css';

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  availableModels,
  councilModels,
  chairmanModel,
  onCouncilModelsChange,
  onChairmanModelChange,
}) {
  const [showSettings, setShowSettings] = useState(false);

  const handleCouncilModelToggle = (model) => {
    if (councilModels.includes(model)) {
      // Remove model (but keep at least 2)
      if (councilModels.length > 2) {
        onCouncilModelsChange(councilModels.filter(m => m !== model));
      }
    } else {
      // Add model (max 6)
      if (councilModels.length < 6) {
        onCouncilModelsChange([...councilModels, model]);
      }
    }
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="header-row">
          <h1>LLM Council</h1>
          <button 
            className={`settings-toggle ${showSettings ? 'active' : ''}`}
            onClick={() => setShowSettings(!showSettings)}
            title="Settings"
            aria-label="Settings"
          >
            <svg
              className="settings-icon"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
                stroke="currentColor"
                strokeWidth="1.8"
              />
              <path
                d="M19.4 15a8.44 8.44 0 0 0 .1-1 8.44 8.44 0 0 0-.1-1l2.1-1.6a.7.7 0 0 0 .2-.9l-2-3.4a.7.7 0 0 0-.9-.3l-2.5 1a8.2 8.2 0 0 0-1.7-1l-.4-2.7a.7.7 0 0 0-.7-.6h-4a.7.7 0 0 0-.7.6l-.4 2.7a8.2 8.2 0 0 0-1.7 1l-2.5-1a.7.7 0 0 0-.9.3l-2 3.4a.7.7 0 0 0 .2.9L4.6 13a8.44 8.44 0 0 0-.1 1 8.44 8.44 0 0 0 .1 1l-2.1 1.6a.7.7 0 0 0-.2.9l2 3.4c.2.3.6.4.9.3l2.5-1c.5.4 1.1.8 1.7 1l.4 2.7c.1.3.4.6.7.6h4c.3 0 .6-.2.7-.6l.4-2.7c.6-.2 1.2-.6 1.7-1l2.5 1c.3.1.7 0 .9-.3l2-3.4a.7.7 0 0 0-.2-.9L19.4 15Z"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
                opacity="0.95"
              />
            </svg>
          </button>
        </div>
        <button className="new-conversation-btn" onClick={onNewConversation}>
          + New Conversation
        </button>
      </div>

      {showSettings && (
        <div className="settings-panel">
          <div className="settings-section">
            <h3>Chairman Model</h3>
            <p className="settings-hint">Synthesizes the final response</p>
            <select 
              value={chairmanModel || ''} 
              onChange={(e) => onChairmanModelChange(e.target.value)}
              className="model-select"
            >
              {availableModels && availableModels.map((model) => (
                <option key={model} value={model}>
                  {model.split('/')[1] || model}
                </option>
              ))}
            </select>
          </div>

          <div className="settings-section">
            <h3>Council Members</h3>
            <p className="settings-hint">Select 2-6 models to participate</p>
            <div className="council-models-list">
              {availableModels && availableModels.map((model) => (
                <label key={model} className="model-checkbox">
                  <input
                    type="checkbox"
                    checked={councilModels.includes(model)}
                    onChange={() => handleCouncilModelToggle(model)}
                    disabled={
                      councilModels.includes(model) && councilModels.length <= 2
                    }
                  />
                  <span className="model-name">{model.split('/')[1] || model}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="conversation-list">
        {conversations.length === 0 ? (
          <div className="no-conversations">No conversations yet</div>
        ) : (
          conversations.map((conv) => (
            <div
              key={conv.id}
              className={`conversation-item ${
                conv.id === currentConversationId ? 'active' : ''
              }`}
              onClick={() => onSelectConversation(conv.id)}
            >
              <div className="conversation-title">
                {conv.title || 'New Conversation'}
              </div>
              <div className="conversation-meta">
                {conv.message_count} messages
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
