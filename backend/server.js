require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const mongoose = require('mongoose');
const multer = require('multer');
const pdfParse = require('pdf-parse');

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

const requestWindowMs = 10 * 60 * 1000;
const requestLimit = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 45);
const ipRequestLog = new Map();

app.use((req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const recent = ipRequestLog.get(ip) || [];
    const valid = recent.filter(ts => now - ts < requestWindowMs);

    if (valid.length >= requestLimit) {
        return res.status(429).json({ error: 'Too many requests. Please retry in a few minutes.' });
    }

    valid.push(now);
    ipRequestLog.set(ip, valid);
    next();
});

async function fetchWebSearchContext(query) {
    if (!query || !query.trim()) return "";

    try {
        const ddgResponse = await axios.get("https://api.duckduckgo.com/", {
            params: {
                q: query,
                format: "json",
                no_html: 1,
                skip_disambig: 1
            },
            timeout: 7000
        });

        const data = ddgResponse.data || {};
        const related = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [];

        const relatedSnippets = related
            .flatMap(item => {
                if (item && typeof item.Text === 'string') return [item.Text];
                if (item && Array.isArray(item.Topics)) {
                    return item.Topics
                        .filter(topic => topic && typeof topic.Text === 'string')
                        .map(topic => topic.Text);
                }
                return [];
            })
            .slice(0, 5);

        const parts = [];
        if (data.AbstractText) parts.push(`Summary: ${data.AbstractText}`);
        if (data.Answer) parts.push(`Direct answer: ${data.Answer}`);
        if (relatedSnippets.length) {
            parts.push(`Related: ${relatedSnippets.join(' | ')}`);
        }

        return parts.length ? parts.join('\n') : "";
    } catch (error) {
        console.warn("Web search context failed:", error.message);
        return "";
    }
}

async function fetchLongTermMemoryContext(maxChars = Number(process.env.OPENROUTER_MEMORY_MAX_CHARS || 6000)) {
    if (mongoose.connection.readyState !== 1) return "";

    try {
        const rows = await Chat.find(
            { role: { $in: ['user', 'assistant'] } },
            { conversationId: 1, role: 1, content: 1, timestamp: 1, _id: 0 }
        )
            .sort({ timestamp: 1 })
            .lean();

        if (!rows.length) return "";

        const lines = rows
            .filter(row => typeof row.content === 'string' && row.content.trim())
            .map(row => {
                const compact = row.content.replace(/\s+/g, ' ').trim();
                return `[${row.conversationId || 'no-id'}] ${row.role}: ${compact}`;
            });

        if (!lines.length) return "";

        const chunks = [];
        let totalChars = 0;

        // Keep most recent memories first when context must be truncated.
        for (let index = lines.length - 1; index >= 0; index -= 1) {
            const line = lines[index];
            if (totalChars + line.length + 1 > maxChars) break;
            chunks.push(line);
            totalChars += line.length + 1;
        }

        chunks.reverse();
        return chunks.join('\n');
    } catch (error) {
        console.warn('Long-term memory context failed:', error.message);
        return "";
    }
}

// Connect to MongoDB (Optional but good for MERN - you can use this to save chats later)
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.log(err));

// Chat Schema (For future use if you want to save notes)
const chatSchema = new mongoose.Schema({
    conversationId: { type: String, index: true },
    role: String,
    content: String,
    timestamp: { type: Date, default: Date.now }
});
const Chat = mongoose.model('Chat', chatSchema);

const resumeContextSchema = new mongoose.Schema({
    key: { type: String, unique: true, default: 'default' },
    fileName: String,
    text: String,
    uploadedAt: { type: Date, default: Date.now }
});
const ResumeContext = mongoose.model('ResumeContext', resumeContextSchema);

app.get('/api/history', async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
        return res.json({ conversations: [] });
    }

    try {
        const rows = await Chat.find({}, { conversationId: 1, role: 1, content: 1, timestamp: 1, _id: 0 })
            .sort({ timestamp: -1 })
            .limit(400)
            .lean();

        const byConversation = new Map();

        for (const row of rows) {
            if (!row.conversationId) continue;

            if (!byConversation.has(row.conversationId)) {
                byConversation.set(row.conversationId, {
                    conversationId: row.conversationId,
                    title: null,
                    preview: null,
                    updatedAt: row.timestamp
                });
            }

            const current = byConversation.get(row.conversationId);
            if (!current.preview && typeof row.content === 'string') {
                current.preview = row.content.slice(0, 120);
            }
        }

        const firstUserMessages = await Chat.aggregate([
            { $match: { role: 'user', conversationId: { $exists: true, $ne: null } } },
            { $sort: { timestamp: 1 } },
            {
                $group: {
                    _id: '$conversationId',
                    title: { $first: '$content' }
                }
            }
        ]);

        for (const row of firstUserMessages) {
            const current = byConversation.get(row._id);
            if (current && typeof row.title === 'string') {
                current.title = row.title.slice(0, 60);
            }
        }

        const conversations = Array.from(byConversation.values())
            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

        res.json({ conversations });
    } catch (error) {
        console.error('Error loading history:', error.message);
        res.status(500).json({ error: 'Failed to load chat history' });
    }
});

app.get('/api/history/:conversationId', async (req, res) => {
    const { conversationId } = req.params;

    if (!conversationId) {
        return res.status(400).json({ error: 'conversationId is required' });
    }

    if (mongoose.connection.readyState !== 1) {
        return res.json({ messages: [] });
    }

    try {
        const savedMessages = await Chat.find(
            { conversationId },
            { role: 1, content: 1, timestamp: 1, _id: 0 }
        )
            .sort({ timestamp: 1 })
            .lean();

        res.json({ messages: savedMessages.map(({ role, content, timestamp }) => ({ role, content, timestamp })) });
    } catch (error) {
        console.error('Error loading conversation:', error.message);
        res.status(500).json({ error: 'Failed to load conversation' });
    }
});

app.delete('/api/history/:conversationId', async (req, res) => {
    const { conversationId } = req.params;

    if (!conversationId) {
        return res.status(400).json({ error: 'conversationId is required' });
    }

    if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({ error: 'Database is not connected' });
    }

    try {
        const result = await Chat.deleteMany({ conversationId });
        res.json({ deletedCount: result.deletedCount || 0, conversationId });
    } catch (error) {
        console.error('Error deleting conversation:', error.message);
        res.status(500).json({ error: 'Failed to delete conversation' });
    }
});

app.post('/api/resume/upload', upload.single('resume'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Resume PDF file is required.' });
        }

        const isPdfByMime = req.file.mimetype === 'application/pdf';
        const isPdfByName = req.file.originalname?.toLowerCase().endsWith('.pdf');
        if (!isPdfByMime && !isPdfByName) {
            return res.status(400).json({ error: 'Only PDF resumes are supported.' });
        }

        const parsed = await pdfParse(req.file.buffer);
        const resumeText = (parsed.text || '').trim();

        if (!resumeText) {
            return res.status(400).json({ error: 'Could not extract text from PDF. Please upload a text-based PDF.' });
        }

        const maxChars = Number(process.env.RESUME_MAX_CHARS || 12000);
        const trimmedResumeText = resumeText.slice(0, maxChars);

        if (mongoose.connection.readyState === 1) {
            await ResumeContext.findOneAndUpdate(
                { key: 'default' },
                {
                    $set: {
                        fileName: req.file.originalname || 'resume.pdf',
                        text: trimmedResumeText,
                        uploadedAt: new Date()
                    }
                },
                { upsert: true, new: true }
            );
        }

        res.json({
            message: 'Resume uploaded successfully. Chat will use this as context.',
            fileName: req.file.originalname || 'resume.pdf',
            extractedChars: trimmedResumeText.length
        });
    } catch (error) {
        console.error('Resume upload error:', error.message);
        res.status(500).json({ error: error.message || 'Failed to upload resume' });
    }
});

// OpenRouter API Route
app.post('/api/chat', async (req, res) => {
    const {
        messages,
        useWebSearch = true,
        conversationId: incomingConversationId,
        mode = 'study',
        deepDive = false
    } = req.body;
    const conversationId = incomingConversationId || new mongoose.Types.ObjectId().toString();

    if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Messages are required." });
    }

    const systemPrompt = {
        role: "system",
        content: `You are an AI study helper focused on placement preparation. Mode: ${mode}. Explain concepts simply, clearly, and concisely. Use bullet points and examples where helpful. If the user asks a question, guide them to the answer rather than giving only a direct answer. Important: you may be given long-term memory from previous chats in system messages. If memory context is provided, use it and never claim that you have no memory or no access to previous chats. Instead, clearly state that you are using saved chat context provided by the app.`
    };

    try {
        const defaultTokens = Number(process.env.OPENROUTER_MAX_TOKENS || 700);
        const maxTokens = deepDive ? Math.max(defaultTokens, 1000) : defaultTokens;
        const modelFast = process.env.OPENROUTER_MODEL_FAST || process.env.OPENROUTER_MODEL || "anthropic/claude-4.6-opus";
        const modelDeep = process.env.OPENROUTER_MODEL_DEEP || process.env.OPENROUTER_MODEL || "anthropic/claude-4.6-opus";
        const selectedModel = deepDive || mode === 'interview' ? modelDeep : modelFast;

        const latestUserMessage = messages
            .filter(message => message && message.role === 'user' && typeof message.content === 'string')
            .at(-1);

        const webContext = useWebSearch
            ? await fetchWebSearchContext(latestUserMessage?.content || "")
            : "";

        const longTermMemory = incomingConversationId
            ? ""
            : await fetchLongTermMemoryContext();

        let resumeContext = "";
        if (mongoose.connection.readyState === 1) {
            const resumeDoc = await ResumeContext.findOne({ key: 'default' }, { text: 1, _id: 0 }).lean();
            const resumeMaxChars = Number(process.env.RESUME_CHAT_CONTEXT_CHARS || 4000);
            resumeContext = (resumeDoc?.text || "").slice(0, resumeMaxChars);
        }

        const promptMessages = [systemPrompt, ...messages];

        if (mode === 'interview') {
            promptMessages.splice(1, 0, {
                role: 'system',
                content: 'Interview mode is enabled. Ask one interview question at a time, evaluate the user response, then ask the next question. Keep it realistic and concise.'
            });
        }

        if (longTermMemory) {
            promptMessages.splice(1, 0, {
                role: "system",
                content: `Long-term memory from previous chats (may be truncated for token limits):\n${longTermMemory}`
            });
        } else {
            promptMessages.splice(1, 0, {
                role: "system",
                content: "No saved long-term memory was found for previous chats in this app. If user asks about earlier chats, explain that no saved history is currently available."
            });
        }

        if (resumeContext) {
            promptMessages.splice(1, 0, {
                role: 'system',
                content: `Candidate resume context (use this for personalization):\n${resumeContext}`
            });
        }

        if (webContext) {
            promptMessages.splice(1, 0, {
                role: "system",
                content: `Web context (verify and use when relevant):\n${webContext}`
            });
        }

        const response = await axios.post(
            "https://openrouter.ai/api/v1/chat/completions",
            {
                model: selectedModel,
                messages: promptMessages,
                max_tokens: maxTokens
            },
            {
                headers: {
                    "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    "HTTP-Referer": "http://localhost:5173", // Required by OpenRouter
                    "X-Title": "MERN Study Helper"
                }
            }
        );

        const aiMessage = response.data.choices?.[0]?.message?.content || "I could not generate a response.";

        // Optional persistence: never fail the request if DB is unavailable.
        if (mongoose.connection.readyState === 1) {
            try {
                await Chat.create({ conversationId, role: 'user', content: messages[messages.length - 1].content });
                await Chat.create({ conversationId, role: 'assistant', content: aiMessage });
            } catch (dbError) {
                console.warn("Skipping chat persistence due to DB error:", dbError.message);
            }
        }

        res.json({ reply: aiMessage, conversationId });
    } catch (error) {
        const providerError = error.response?.data;
        const providerMessage = providerError?.error?.message || error.message;

        console.error("Error calling OpenRouter:", providerError || error.message);

        if (error.response?.status === 402) {
            return res.status(402).json({
                error: providerMessage || "Insufficient OpenRouter credits. Lower max tokens or top up credits."
            });
        }

        res.status(500).json({ error: providerMessage || "Failed to fetch response from AI" });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));