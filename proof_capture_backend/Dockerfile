FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
  tesseract-ocr \
  && rm -rf /var/lib/apt/lists/*

COPY proof_capture_backend/pyproject.toml /app/pyproject.toml
COPY proof_capture_backend/app /app/app
COPY proof_capture_backend/alembic /app/alembic

RUN pip install --no-cache-dir .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "10000"]
