import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import Stage1 from './Stage1';
import Stage2 from './Stage2';
import Stage3 from './Stage3';
import { api } from '../api';
import './ChatInterface.css';

function floatTo16BitPCM(output, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function encodeWav({ samples, sampleRate, numChannels = 1 }) {
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * bytesPerSample, true);
  floatTo16BitPCM(view, 44, samples);

  return new Blob([view], { type: 'audio/wav' });
}

export default function ChatInterface({
  conversation,
  onSendMessage,
  isLoading,
  pendingClarification,
  onSkipClarification
}) {
  const [input, setInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isMicStarting, setIsMicStarting] = useState(false);
  const [sttError, setSttError] = useState(null);
  const messagesEndRef = useRef(null);
  const recordingRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [conversation, pendingClarification]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      onSendMessage(input);
      setInput('');
    }
  };

  const handleKeyDown = (e) => {
    // Submit on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const startRecording = async () => {
    if (isLoading || isTranscribing || isRecording || isMicStarting) return;
    setSttError(null);

    setIsMicStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);

      // ScriptProcessorNode is deprecated but still widely supported and simplest for this use-case.
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const chunks = [];

      processor.onaudioprocess = (e) => {
        const channel = e.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(channel));
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      recordingRef.current = {
        stream,
        audioContext,
        source,
        processor,
        chunks,
        sampleRate: audioContext.sampleRate,
      };
      setIsRecording(true);
    } catch (e) {
      setSttError(e?.message || 'Microphone permission was denied');
    } finally {
      setIsMicStarting(false);
    }
  };

  const stopRecording = async () => {
    if (!isRecording || !recordingRef.current) return;

    const { stream, audioContext, source, processor, chunks, sampleRate } = recordingRef.current;
    recordingRef.current = null;
    setIsRecording(false);

    try {
      processor.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      await audioContext.close();

      const totalLength = chunks.reduce((sum, a) => sum + a.length, 0);
      const merged = new Float32Array(totalLength);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.length;
      }

      const wavBlob = encodeWav({ samples: merged, sampleRate, numChannels: 1 });
      setIsTranscribing(true);
      const { text } = await api.speechToText(wavBlob, { format: 'wav' });
      const transcript = (text || '').trim();
      if (transcript) {
        setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    } catch (e) {
      setSttError(e?.message || 'Failed to transcribe audio');
    } finally {
      setIsTranscribing(false);
    }
  };

  if (!conversation) {
    return (
      <div className="chat-interface">
        <div className="empty-state">
          <h2>Welcome to LLM Council</h2>
          <p>Create a new conversation to get started</p>
        </div>
      </div>
    );
  }

  const showInputForm = conversation.messages.length === 0 || pendingClarification;
  const sttStatus = isMicStarting
    ? { tone: 'info', label: 'Requesting microphone…' }
    : isRecording
      ? { tone: 'recording', label: 'Recording… Click to stop' }
      : isTranscribing
        ? { tone: 'info', label: 'Transcribing…' }
        : null;

  return (
    <div className="chat-interface">
      <div className="messages-container">
        {conversation.messages.length === 0 ? (
          <div className="empty-state">
            <h2>Start a conversation</h2>
            <p>Ask a question to consult the LLM Council</p>
          </div>
        ) : (
          conversation.messages.map((msg, index) => (
            <div key={index} className="message-group">
              {msg.role === 'user' ? (
                <div className="user-message">
                  <div className="message-label">You</div>
                  <div className="message-content">
                    <div className="markdown-content">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="assistant-message">
                  <div className="message-label">LLM Council</div>

                  {/* Clarification check */}
                  {msg.loading?.clarification && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Analyzing your question...</span>
                    </div>
                  )}

                  {/* Clarification needed */}
                  {msg.clarification?.needs_clarification && (
                    <div className="clarification-box">
                      <div className="clarification-header">
                        <span className="clarification-icon">❓</span>
                        <span>Before consulting the council, could you clarify:</span>
                      </div>
                      <ul className="clarification-questions">
                        {msg.clarification.questions.map((q, i) => (
                          <li key={i}>{q}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Stage 1 */}
                  {msg.loading?.stage1 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Running Stage 1: Collecting individual responses...</span>
                    </div>
                  )}
                  {msg.stage1 && <Stage1 responses={msg.stage1} />}

                  {/* Stage 2 */}
                  {msg.loading?.stage2 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Running Stage 2: Peer rankings...</span>
                    </div>
                  )}
                  {msg.stage2 && (
                    <Stage2
                      rankings={msg.stage2}
                      labelToModel={msg.metadata?.label_to_model}
                      aggregateRankings={msg.metadata?.aggregate_rankings}
                    />
                  )}

                  {/* Stage 3 */}
                  {msg.loading?.stage3 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Running Stage 3: Final synthesis...</span>
                    </div>
                  )}
                  {msg.stage3 && <Stage3 finalResponse={msg.stage3} />}
                </div>
              )}
            </div>
          ))
        )}

        {isLoading && !pendingClarification && (
          <div className="loading-indicator">
            <div className="spinner"></div>
            <span>Consulting the council...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {showInputForm && (
        <form className="input-form" onSubmit={handleSubmit}>
          <div className="input-wrapper">
            {pendingClarification && (
              <div className="clarification-prompt">
                <span>Provide additional context or </span>
                <button 
                  type="button" 
                  className="skip-clarification-btn"
                  onClick={onSkipClarification}
                >
                  skip and ask anyway
                </button>
              </div>
            )}
            {sttError && <div className="stt-error">{sttError}</div>}
            {sttStatus && (
              <div className={`stt-status ${sttStatus.tone}`} aria-live="polite">
                <span className="stt-status-indicator" aria-hidden="true" />
                <span className="stt-status-text">{sttStatus.label}</span>
              </div>
            )}
            <div className="input-row">
              <textarea
                className="message-input"
                placeholder={
                  pendingClarification 
                    ? "Provide additional context..." 
                    : "Ask your question... (Shift+Enter for new line, Enter to send)"
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                rows={3}
                ref={inputRef}
              />
              <button
                type="button"
                className={`mic-button ${isRecording ? 'recording' : ''}`}
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isLoading || isTranscribing || isMicStarting}
                title={
                  isMicStarting
                    ? 'Requesting microphone'
                    : isRecording
                      ? 'Stop recording'
                      : 'Record audio'
                }
                aria-label={
                  isMicStarting
                    ? 'Requesting microphone'
                    : isRecording
                      ? 'Stop recording'
                      : 'Record audio'
                }
              >
                <svg
                  className="mic-icon"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path
                    d="M12 14a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v4a3 3 0 0 0 3 3Z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  />
                  <path
                    d="M19 11a7 7 0 0 1-14 0"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                  <path
                    d="M12 18v3"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="mic-button-label">
                  {isMicStarting ? 'Allow' : isRecording ? 'Stop' : 'Mic'}
                </span>
              </button>
              <button
                type="submit"
                className="send-button"
                disabled={!input.trim() || isLoading}
              >
                Send
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}
