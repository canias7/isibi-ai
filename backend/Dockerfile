# GoFarther AI backend — Python + LibreOffice headless for true document
# conversion (docx/xlsx/pptx ↔ pdf with formatting preserved).
#
# Kept on python:3.11-slim to match the prior PYTHON_VERSION env on Render.
# LibreOffice is installed without JRE or Base (we don't need databases) and
# without most language packs to keep the image under ~1 GB.

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DEBIAN_FRONTEND=noninteractive \
    # Give LibreOffice a predictable profile dir so first launch isn't slow
    HOME=/tmp

WORKDIR /app

# System packages:
#   libreoffice-core/writer/calc/impress — conversion engines for doc/xls/ppt
#   fonts-liberation + fonts-dejavu-core — decent default fonts so exports
#                                          don't fall back to Courier
#   curl, build-essential — small footprint, needed for a few pip wheels
#   libpq5 — runtime for psycopg/asyncpg if any wheels link against it
RUN apt-get update && apt-get install -y --no-install-recommends \
        libreoffice-core \
        libreoffice-writer \
        libreoffice-calc \
        libreoffice-impress \
        fonts-liberation \
        fonts-dejavu-core \
        curl \
        build-essential \
        libpq5 \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Install Python deps first so we can cache this layer across code changes
COPY requirements.txt ./
RUN pip install -r requirements.txt

# Copy the rest of the backend source
COPY . .

# Warm the LibreOffice user profile so the first /convert request doesn't
# pay the 3-5 second init cost. Failure is non-fatal — some CI envs don't
# allow running soffice during build.
RUN mkdir -p /tmp/lo-profile \
    && soffice --headless \
        -env:UserInstallation=file:///tmp/lo-profile \
        --terminate_after_init > /dev/null 2>&1 || true

EXPOSE 8000

# Match the startCommand from render.yaml. Render sets $PORT at runtime; use
# a shell form so env expansion works.
CMD gunicorn main:app \
    --workers ${WEB_CONCURRENCY:-4} \
    --worker-class uvicorn.workers.UvicornWorker \
    --bind 0.0.0.0:${PORT:-8000} \
    --timeout 120
