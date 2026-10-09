# Worker image: Python 3.12, PDF and font tooling, WeasyPrint system libraries. T-008 completes and tests it.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
RUN apt-get update && apt-get install -y --no-install-recommends \
      ghostscript poppler-utils fonts-dejavu-core libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b postgresql-client \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY worker/pyproject.toml worker/uv.lock ./worker/
RUN cd worker && uv sync --frozen --no-dev --no-install-project
COPY worker ./worker
RUN cd worker && uv sync --frozen --no-dev
RUN useradd --create-home --uid 10001 nutrivo && chown -R nutrivo /app
USER nutrivo
WORKDIR /app/worker
CMD ["uv", "run", "--no-dev", "nutrivo", "work"]
