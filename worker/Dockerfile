# Worker image (D-13): Python 3.12, PDF and font tooling, WeasyPrint system libraries, and ClamAV for the malware scan
# of supplier uploads (T-802, H03, docs/09: clamscan in this container, no outside scanning service). Built from the
# repository root (render.yaml: dockerContext .). Only the worker's source and prompts go in: no tests, cassettes or local venv.
FROM python:3.15-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never UV_PYTHON=/usr/local/bin/python3.12 UV_PROJECT_ENVIRONMENT=/app/worker/.venv
RUN apt-get update && apt-get install -y --no-install-recommends \
      ghostscript poppler-utils fonts-dejavu-core libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b postgresql-client \
      clamav clamav-freshclam \
    && rm -rf /var/lib/apt/lists/*
# Signatures are fetched when the image is built, so every deploy scans with the day's database. A build that cannot
# fetch them fails here rather than shipping a scanner without signatures (clamscan would refuse every file, and the
# scan jobs would fail visibly, never pass).
RUN freshclam --stdout --show-progress=no && clamscan --version
# Pinned, never :latest, so a rebuild of the same commit gets the same resolver.
COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /usr/local/bin/uv
WORKDIR /app/worker
COPY worker/pyproject.toml worker/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY worker/src ./src
COPY worker/prompts ./prompts
RUN uv sync --frozen --no-dev && useradd --create-home --uid 10001 nutrivo
USER nutrivo
# SIGTERM (a Render deploy or restart) stops polling and drains in-flight jobs; unacknowledged messages reappear.
STOPSIGNAL SIGTERM
CMD ["/app/worker/.venv/bin/nutrivo", "work"]
