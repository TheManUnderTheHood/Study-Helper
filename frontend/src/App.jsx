import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';

function App() {
  const API_BASE = 'http://localhost:5000';

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [useWebSearch, setUseWebSearch] = useState(true);
  const [mode, setMode] = useState('study');
  const [deepDive, setDeepDive] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [history, setHistory] = useState([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [resumeFile, setResumeFile] = useState(null);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [resumeStatus, setResumeStatus] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [speechError, setSpeechError] = useState('');
  const messagesEndRef = useRef(null);
  const recognitionRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadHistory = async () => {
    setIsHistoryLoading(true);
    try {
      const response = await axios.get(`${API_BASE}/api/history`);
      setHistory(Array.isArray(response.data?.conversations) ? response.data.conversations : []);
    } catch (error) {
      console.error('History load error:', error);
      setHistory([]);
    } finally {
      setIsHistoryLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechSupported(false);
      return undefined;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }

      const cleaned = transcript.trim();
      if (cleaned) {
        setInput(cleaned);
      }
    };

    recognition.onstart = () => {
      setIsListening(true);
      setSpeechError('');
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.onerror = (event) => {
      setIsListening(false);
      if (event.error !== 'no-speech') {
        setSpeechError(`Speech error: ${event.error}`);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.stop();
      recognitionRef.current = null;
    };
  }, []);

  const toggleSpeechToText = () => {
    if (!recognitionRef.current) return;

    if (isListening) {
      recognitionRef.current.stop();
      return;
    }

    try {
      setSpeechError('');
      recognitionRef.current.start();
    } catch (error) {
      setSpeechError('Unable to start voice input. Please try again.');
    }
  };

  const openConversation = async (selectedConversationId) => {
    if (!selectedConversationId) return;

    try {
      const response = await axios.get(`${API_BASE}/api/history/${selectedConversationId}`);
      const savedMessages = Array.isArray(response.data?.messages)
        ? response.data.messages.map(({ role, content }) => ({ role, content }))
        : [];

      setConversationId(selectedConversationId);
      setMessages(savedMessages);
    } catch (error) {
      console.error('Conversation load error:', error);
    }
  };

  const deleteConversation = async (selectedConversationId) => {
    if (!selectedConversationId) return;

    const confirmed = window.confirm('Delete this chat permanently?');
    if (!confirmed) return;

    try {
      await axios.delete(`${API_BASE}/api/history/${selectedConversationId}`);

      if (conversationId === selectedConversationId) {
        startNewChat();
      }

      loadHistory();
    } catch (error) {
      console.error('Conversation delete error:', error);
    }
  };

  const startNewChat = () => {
    setMessages([]);
    setConversationId(null);
    setInput('');
  };

  const uploadResumeContext = async () => {
    if (!resumeFile) return;

    setResumeLoading(true);
    setResumeStatus('');
    try {
      const formData = new FormData();
      formData.append('resume', resumeFile);

      const response = await axios.post(`${API_BASE}/api/resume/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      setResumeStatus(response.data?.message || 'Resume uploaded successfully.');
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Resume context uploaded. I will use it in your next chat responses.' }
      ]);
    } catch (error) {
      console.error('Resume upload error:', error);
      setResumeStatus(error.response?.data?.error || 'Failed to upload resume context.');
    } finally {
      setResumeLoading(false);
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = { role: 'user', content: input };
    const newMessages = [...messages, userMessage];
    
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      const response = await axios.post(`${API_BASE}/api/chat`, {
        messages: newMessages,
        useWebSearch,
        conversationId,
        mode,
        deepDive
      });

      const aiMessage = { role: 'assistant', content: response.data.reply };
      setMessages([...newMessages, aiMessage]);
      if (response.data.conversationId) {
        setConversationId(response.data.conversationId);
      }
      loadHistory();
    } catch (error) {
      console.error('Error:', error);
      const errorMessage = error.response?.data?.error || 'Sorry, I encountered an error. Please check your backend and API key.';
      setMessages([...newMessages, { role: 'assistant', content: errorMessage }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#1e293b_0%,_#0f172a_45%,_#020617_100%)] px-3 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto flex h-[calc(100vh-2rem)] max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-700/70 bg-slate-900/70 shadow-[0_20px_80px_rgba(2,6,23,0.7)] backdrop-blur-xl sm:h-[calc(100vh-3rem)]">
        {/* Header */}
        <div className="border-b border-slate-700/70 bg-gradient-to-r from-cyan-400/10 via-blue-400/10 to-indigo-400/10 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-[0.2em] text-cyan-300/80">PLACEMENT PREP</p>
              <h1 className="mt-1 text-xl font-bold text-slate-100 sm:text-2xl">Study Helper</h1>
              <p className="mt-1 text-sm text-slate-300">Company-specific interview, OA, and revision guidance.</p>
            </div>
            <div className="hidden items-center gap-2 sm:flex">
              <button
                type="button"
                onClick={startNewChat}
                className="rounded-full border border-cyan-300/40 bg-cyan-300/10 px-3 py-1 text-xs font-medium text-cyan-200 hover:bg-cyan-300/20"
              >
                New chat
              </button>
              <div className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-medium text-cyan-200">
                Web + AI Assistant
              </div>
            </div>
          </div>
        </div>

        <div className="border-b border-slate-700/70 p-2 md:hidden">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs uppercase tracking-wider text-slate-400">History</p>
            <button
              type="button"
              onClick={startNewChat}
              className="rounded-md border border-slate-600 px-2 py-1 text-xs text-slate-300"
            >
              New
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {history.slice(0, 8).map((item) => (
              <div
                key={item.conversationId}
                className={`shrink-0 rounded-lg border ${conversationId === item.conversationId
                  ? 'border-cyan-400 bg-cyan-500/20 text-cyan-100'
                  : 'border-slate-600 bg-slate-800/80 text-slate-300'}`}
              >
                <button
                  type="button"
                  onClick={() => openConversation(item.conversationId)}
                  className="px-3 py-2 text-left text-xs"
                >
                  {(item.title || 'Untitled chat').slice(0, 24)}
                </button>
                <button
                  type="button"
                  onClick={() => deleteConversation(item.conversationId)}
                  className="border-l border-slate-600 px-2 py-2 text-xs text-rose-300 hover:text-rose-200"
                  aria-label="Delete chat"
                  title="Delete chat"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-72 flex-col border-r border-slate-700/70 bg-slate-950/45 p-3 md:flex">
            <p className="mb-2 text-xs uppercase tracking-wider text-cyan-300">Resume Context</p>
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setResumeFile(e.target.files?.[0] || null)}
              className="mb-2 rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-2 text-xs text-slate-100"
            />
            <button
              type="button"
              onClick={uploadResumeContext}
              disabled={resumeLoading || !resumeFile}
              className="mb-3 rounded-lg border border-cyan-400/50 bg-cyan-500/10 px-2 py-2 text-xs text-cyan-200 disabled:opacity-50"
            >
              {resumeLoading ? 'Uploading...' : 'Upload resume context'}
            </button>

            {resumeStatus && (
              <div className="mb-3 rounded-lg border border-slate-700 bg-slate-900/60 p-2 text-xs text-slate-200">
                <p>{resumeStatus}</p>
              </div>
            )}

            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs uppercase tracking-wider text-slate-400">Chat history</p>
              <button
                type="button"
                onClick={loadHistory}
                className="rounded-md border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
              >
                Refresh
              </button>
            </div>
            <button
              type="button"
              onClick={startNewChat}
              className="mb-3 rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-3 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-400/20"
            >
              + New chat
            </button>
            <div className="space-y-2 overflow-y-auto pr-1">
              {isHistoryLoading && (
                <p className="text-xs text-slate-400">Loading history...</p>
              )}
              {!isHistoryLoading && history.length === 0 && (
                <p className="text-xs text-slate-400">No saved chats yet.</p>
              )}
              {history.map((item) => (
                <div
                  key={item.conversationId}
                  className={`w-full rounded-xl border p-3 text-left transition-all ${conversationId === item.conversationId
                    ? 'border-cyan-400 bg-cyan-500/20'
                    : 'border-slate-700 bg-slate-900/70 hover:border-slate-500'}`}
                >
                  <button
                    type="button"
                    onClick={() => openConversation(item.conversationId)}
                    className="w-full text-left"
                  >
                    <p className="truncate text-sm font-medium text-slate-100">{item.title || 'Untitled chat'}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-slate-400">{item.preview || 'No preview available'}</p>
                  </button>
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => deleteConversation(item.conversationId)}
                      className="rounded-md border border-rose-400/40 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/10"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </aside>

          {/* Chat Window */}
          <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:space-y-5 sm:p-6">
        {messages.length === 0 && (
          <div className="mx-auto mt-8 max-w-xl rounded-2xl border border-dashed border-slate-600 bg-slate-800/60 p-6 text-center text-slate-300">
            <p className="text-base font-medium text-slate-200">Ready for placements.</p>
            <p className="mt-1 text-sm">Ask about a company, role, or round type to get a focused prep plan.</p>
          </div>
        )}
        
        {messages.map((msg, index) => (
          <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] rounded-2xl p-4 shadow-lg sm:max-w-[80%] ${
              msg.role === 'user' 
                ? 'rounded-br-md border border-cyan-300/30 bg-gradient-to-br from-cyan-500 to-blue-600 text-white' 
                : 'rounded-bl-md border border-slate-700 bg-slate-800/90 text-slate-100'
            }`}>
              {msg.role === 'user' ? (
                <p>{msg.content}</p>
              ) : (
                <div className="markdown-content text-slate-200">
                  <ReactMarkdown>
                    {msg.content}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        ))}
        
        {isLoading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md border border-slate-700 bg-slate-800/90 p-4 text-slate-300 shadow-lg">
              <span className="animate-pulse">Thinking...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
        </div>

        {/* Input Box */}
        <form onSubmit={sendMessage} className="border-t border-slate-700/80 bg-slate-900/80 p-4 sm:p-5">
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="rounded-lg border border-slate-600 bg-slate-800/90 px-3 py-2 text-sm text-slate-100"
          >
            <option value="study">Study mode</option>
            <option value="interview">Interview simulator</option>
          </select>
          <label className="flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800/90 px-3 py-2 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={deepDive}
              onChange={(e) => setDeepDive(e.target.checked)}
              className="h-4 w-4 accent-cyan-400"
            />
            Deep dive
          </label>
        </div>

        <label className="mb-3 flex items-center gap-2 text-sm text-slate-300 select-none">
          <input
            type="checkbox"
            checked={useWebSearch}
            onChange={(e) => setUseWebSearch(e.target.checked)}
            className="h-4 w-4 accent-cyan-400"
            disabled={isLoading}
          />
          Use web search for fresher placement-focused answers
        </label>
        <div className="flex gap-2"> {/* v4 prefers gap over space-x */}
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question or paste notes here..."
            // Updated v4 class: focus:outline-hidden
            className="flex-1 rounded-xl border border-slate-600 bg-slate-800/90 p-3 text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400 transition-all"
            disabled={isLoading}
          />
          <button
            type="button"
            onClick={toggleSpeechToText}
            disabled={isLoading || !speechSupported}
            className={`rounded-xl border px-4 py-3 text-sm font-semibold transition-all ${isListening
              ? 'border-rose-400/60 bg-rose-500/15 text-rose-200'
              : 'border-slate-600 bg-slate-800/90 text-slate-200 hover:border-cyan-400/60'} disabled:cursor-default disabled:opacity-50`}
            title={speechSupported ? (isListening ? 'Stop voice input' : 'Start voice input') : 'Speech-to-text not supported in this browser'}
          >
            {isListening ? 'Listening...' : 'Mic'}
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-3 font-semibold text-white transition-all hover:brightness-110 disabled:cursor-default disabled:from-slate-600 disabled:to-slate-600"
          >
            Send
          </button>
        </div>

        {!speechSupported && (
          <p className="mt-2 text-xs text-amber-300">Speech-to-text is not supported in this browser.</p>
        )}
        {speechError && (
          <p className="mt-2 text-xs text-rose-300">{speechError}</p>
        )}

        </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;