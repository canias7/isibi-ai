# Go Farther

A ChatGPT-style chat UI built with React + Vite + TypeScript.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build to dist/
```

## Connect a real model

Out of the box it runs in **demo mode** (a local mock streams a placeholder
reply). To stream real answers, set a chat endpoint that accepts
`POST { messages: {role, content}[] }` and returns a streamed text response:

```bash
# .env
VITE_CHAT_API=https://lkpfeqrelvziltfwpuxi.supabase.co/functions/v1/chat
```

A Supabase project (`gofarther-ai`) is already provisioned to host that
endpoint as an Edge Function.
