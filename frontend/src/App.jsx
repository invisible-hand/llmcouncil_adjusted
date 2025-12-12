import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import { api } from './api';
import { localConversations } from './localConversations';
import './App.css';

function App() {
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  
  // Model settings
  const [availableModels, setAvailableModels] = useState([]);
  const [councilModels, setCouncilModels] = useState([]);
  const [chairmanModel, setChairmanModel] = useState(null);
  
  // Clarification state
  const [pendingClarification, setPendingClarification] = useState(null);
  const [originalQuery, setOriginalQuery] = useState(null);

  // Load conversations and models on mount
  useEffect(() => {
    loadConversations();
    loadModels();
  }, []);

  // Load conversation details when selected
  useEffect(() => {
    if (currentConversationId) {
      loadConversation(currentConversationId);
      // Clear any pending clarification when switching conversations
      setPendingClarification(null);
      setOriginalQuery(null);
    }
  }, [currentConversationId]);

  const loadConversations = () => {
    const convs = localConversations.list();
    setConversations(convs);
    if (!currentConversationId && convs.length > 0) {
      setCurrentConversationId(convs[0].id);
    }
  };

  const loadModels = async () => {
    try {
      const data = await api.getModels();
      setAvailableModels(data.available_models);
      setCouncilModels(data.default_council_models);
      setChairmanModel(data.default_chairman_model);
    } catch (error) {
      console.error('Failed to load models:', error);
    }
  };

  const loadConversation = (id) => {
    const conv = localConversations.get(id);
    setCurrentConversation(conv);
  };

  const handleNewConversation = () => {
    try {
      const { conversation: newConv, index } = localConversations.create();
      setConversations(index);
      setCurrentConversationId(newConv.id);
      setCurrentConversation(newConv);
      setPendingClarification(null);
      setOriginalQuery(null);
    } catch (error) {
      console.error('Failed to create conversation:', error);
    }
  };

  const handleSelectConversation = (id) => {
    setCurrentConversationId(id);
  };

  const handleSendMessage = async (content, skipClarification = false) => {
    if (!currentConversationId) return;
    if (!currentConversation) return;

    setIsLoading(true);
    const isFirstMessage = (currentConversation.messages?.length || 0) === 0;
    
    // If this is a response to clarification questions, combine with original query
    let finalContent = content;
    if (pendingClarification && originalQuery) {
      finalContent = `${originalQuery}\n\nAdditional context: ${content}`;
      setPendingClarification(null);
      setOriginalQuery(null);
      skipClarification = true; // Don't ask for clarification again
    } else {
      setOriginalQuery(content);
    }
    
    try {
      // Optimistically add user message to UI
      const userMessage = { role: 'user', content };
      setCurrentConversation((prev) => {
        const next = { ...prev, messages: [...prev.messages, userMessage] };
        localConversations.save(next);
        setConversations(localConversations.list());
        return next;
      });

      // Create a partial assistant message that will be updated progressively
      const assistantMessage = {
        role: 'assistant',
        clarification: null,
        stage1: null,
        stage2: null,
        stage3: null,
        metadata: null,
        loading: {
          clarification: false,
          stage1: false,
          stage2: false,
          stage3: false,
        },
      };

      // Add the partial assistant message
      setCurrentConversation((prev) => {
        const next = { ...prev, messages: [...prev.messages, assistantMessage] };
        localConversations.save(next);
        setConversations(localConversations.list());
        return next;
      });

      // Send message with streaming
      await api.sendMessageStream(
        currentConversationId, 
        finalContent, 
        (eventType, event) => {
          switch (eventType) {
            case 'clarification_start':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.loading.clarification = true;
                const next = { ...prev, messages };
                localConversations.save(next);
                return next;
              });
              break;

            case 'clarification_needed':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.clarification = event.data;
                lastMsg.loading.clarification = false;
                const next = { ...prev, messages };
                localConversations.save(next);
                return next;
              });
              setPendingClarification(event.data);
              setIsLoading(false);
              break;

            case 'clarification_complete':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.loading.clarification = false;
                const next = { ...prev, messages };
                localConversations.save(next);
                return next;
              });
              break;

            case 'stage1_start':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.loading.stage1 = true;
                const next = { ...prev, messages };
                localConversations.save(next);
                return next;
              });
              break;

            case 'stage1_complete':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.stage1 = event.data;
                lastMsg.loading.stage1 = false;
                const next = { ...prev, messages };
                localConversations.save(next);
                return next;
              });
              break;

            case 'stage2_start':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.loading.stage2 = true;
                const next = { ...prev, messages };
                localConversations.save(next);
                return next;
              });
              break;

            case 'stage2_complete':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.stage2 = event.data;
                lastMsg.metadata = event.metadata;
                lastMsg.loading.stage2 = false;
                const next = { ...prev, messages };
                localConversations.save(next);
                return next;
              });
              break;

            case 'stage3_start':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.loading.stage3 = true;
                const next = { ...prev, messages };
                localConversations.save(next);
                return next;
              });
              break;

            case 'stage3_complete':
              setCurrentConversation((prev) => {
                const messages = [...prev.messages];
                const lastMsg = messages[messages.length - 1];
                lastMsg.stage3 = event.data;
                lastMsg.loading.stage3 = false;
                const next = { ...prev, messages };
                localConversations.save(next);
                return next;
              });
              break;

            case 'title_complete':
              setCurrentConversation((prev) => {
                const next = { ...prev, title: event.data?.title || prev.title };
                localConversations.save(next);
                setConversations(localConversations.list());
                return next;
              });
              break;

            case 'complete':
              setIsLoading(false);
              setOriginalQuery(null);
              setConversations(localConversations.list());
              break;

            case 'error':
              console.error('Stream error:', event.message);
              setIsLoading(false);
              break;

            default:
              console.log('Unknown event type:', eventType);
          }
        },
        {
          chairmanModel,
          councilModels,
          skipClarification,
          isFirstMessage
        }
      );
    } catch (error) {
      console.error('Failed to send message:', error);
      // Remove optimistic messages on error
      setCurrentConversation((prev) => {
        if (!prev) return prev;
        const next = { ...prev, messages: prev.messages.slice(0, -2) };
        localConversations.save(next);
        setConversations(localConversations.list());
        return next;
      });
      setIsLoading(false);
    }
  };

  const handleSkipClarification = () => {
    if (originalQuery) {
      setPendingClarification(null);
      // Re-send the original query but skip clarification
      handleSendMessage(originalQuery, true);
    }
  };

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        availableModels={availableModels}
        councilModels={councilModels}
        chairmanModel={chairmanModel}
        onCouncilModelsChange={setCouncilModels}
        onChairmanModelChange={setChairmanModel}
      />
      <ChatInterface
        conversation={currentConversation}
        onSendMessage={handleSendMessage}
        isLoading={isLoading}
        pendingClarification={pendingClarification}
        onSkipClarification={handleSkipClarification}
      />
    </div>
  );
}

export default App;
