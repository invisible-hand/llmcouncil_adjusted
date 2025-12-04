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
            className="settings-toggle" 
            onClick={() => setShowSettings(!showSettings)}
            title="Settings"
          >
            ⚙️
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
