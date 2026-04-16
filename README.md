# isibi.ai

No-code app builder powered by AI. Describe your app in plain language, and isibi.ai generates a fully functional web application.

## Tech Stack

- **Frontend:** React + TypeScript (Vite)
- **Backend:** FastAPI (Python 3.11)
- **Database:** PostgreSQL (async via SQLAlchemy)
- **Cache:** Redis
- **AI:** Claude by Anthropic

## Quick Start with Docker

```bash
git clone <repo-url> && cd isibi.ai
docker-compose up
```

The app will be available at `http://localhost:8000`. API docs at `http://localhost:8000/docs`.

## Manual Setup

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then fill in your values
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend dev server runs at `http://localhost:5173` and proxies API requests to the backend.

## Environment Variables

| Variable | Description | Required |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string (asyncpg) | Yes |
| `JWT_SECRET` | Secret key for JWT token signing | Yes |
| `REDIS_URL` | Redis connection string | No |
| `RESEND_API_KEY` | Resend API key for transactional emails | No |
| `ANTHROPIC_API_KEY` | Anthropic API key for AI generation | Yes |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins | No |
| `UPLOADS_DIR` | Directory for file uploads | No |

## Project Structure

```
isibi.ai/
  backend/
    main.py              # FastAPI app entry point
    models/              # SQLAlchemy models
    routes/              # API route handlers
    generator/           # AI app generation engine
    middleware/          # Rate limiting, caching, logging
    worker/              # Background tasks and scheduler
    alembic/             # Database migrations
  frontend/
    src/
      components/        # React components
      pages/             # Page-level views
      stores/            # Zustand state stores
      api/               # API client
      types/             # TypeScript types
```

## API Documentation

- **Swagger UI:** `http://localhost:8000/docs`
- **ReDoc:** `http://localhost:8000/redoc`
- **Health check:** `GET /api/health`

## License

All rights reserved.
