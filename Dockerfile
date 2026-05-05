FROM python:3.10-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8000

WORKDIR /app

COPY app.py /app/app.py
COPY homehub /app/homehub
COPY static /app/static
COPY AGENTS.md /app/AGENTS.md
COPY README.md /app/README.md

RUN mkdir -p /app/data

EXPOSE 8000

CMD ["python", "app.py"]
