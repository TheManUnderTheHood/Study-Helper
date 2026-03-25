# Study Helper

A full-stack placement preparation assistant built with React + Node.js.

It supports:
- AI chat for interview/OA prep
- Resume PDF upload as persistent chat context
- Web-enhanced responses (optional toggle)
- Voice input (speech-to-text) in chat
- Interview simulator mode
- Chat history with open/delete

## Tech Stack

- Frontend: React, Vite, Tailwind utility classes
- Backend: Express, Axios, Mongoose
- Database: MongoDB
- AI Provider: OpenRouter Chat Completions API

## Project Structure

```text
Study helper/
  backend/
    server.js
    package.json
  frontend/
    src/
    package.json
```

## Prerequisites

- Node.js 18+
- npm
- MongoDB Atlas or local MongoDB instance
- OpenRouter API key

## Setup

### 1) Clone and open project

```bash
git clone <your-repo-url>
cd "Study helper"
```

### 2) Backend setup

```bash
cd backend
npm install
```

Create a `.env` file in `backend/`:

```env
PORT=5000
MONGO_URI=your_mongodb_connection_string
OPENROUTER_API_KEY=your_openrouter_api_key

# Optional tuning
OPENROUTER_MAX_TOKENS=700
OPENROUTER_MEMORY_MAX_CHARS=6000
RESUME_MAX_CHARS=12000
RESUME_CHAT_CONTEXT_CHARS=4000
RATE_LIMIT_MAX_REQUESTS=45
OPENROUTER_MODEL=anthropic/claude-4.6-opus
OPENROUTER_MODEL_FAST=anthropic/claude-4.6-opus
OPENROUTER_MODEL_DEEP=anthropic/claude-4.6-opus
```

Start backend:

```bash
npm run dev
```

### 3) Frontend setup

Open a new terminal:

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on Vite dev server (default: `http://localhost:5173`).

## Available Scripts

### Backend

- `npm run dev` - start backend with nodemon
- `npm start` - start backend with node

### Frontend

- `npm run dev` - start Vite dev server
- `npm run build` - build production bundle
- `npm run preview` - preview production build
- `npm run lint` - lint frontend code

## API Endpoints

### Chat

- `POST /api/chat`
  - body:
    - `messages`: array of `{ role, content }`
    - `useWebSearch`: boolean
    - `conversationId`: optional string
    - `mode`: `study` or `interview`
    - `deepDive`: boolean
  - returns:
    - `reply`
    - `conversationId`

### History

- `GET /api/history` - list conversations
- `GET /api/history/:conversationId` - get messages for one conversation
- `DELETE /api/history/:conversationId` - delete one conversation

### Resume Context

- `POST /api/resume/upload`
  - multipart form-data:
    - `resume`: PDF file
  - stores extracted text as context for future chat replies

## Key Features

### Resume-aware chat
Upload your resume once, and the assistant personalizes future responses using that context.

### Voice input
Use the mic button in chat input to dictate questions via browser speech recognition.

### Interview simulator
Switch mode to `interview` for step-by-step mock interview style responses.

### Long-term memory
New chats can leverage past saved chat context (truncated safely for token limits).

## Notes

- Speech-to-text depends on browser support (`SpeechRecognition` / `webkitSpeechRecognition`).
- Resume upload currently supports PDF only.
- For best output length, keep `OPENROUTER_MAX_TOKENS` at or above `700`.

## Future Improvements

- Per-user authentication and private data isolation
- DOCX/TXT resume upload support
- Better ATS-style resume scoring pipeline
- Streaming token responses for faster UX

## License

ISC (as defined in backend package metadata)
