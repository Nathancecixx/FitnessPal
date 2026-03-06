FROM python:3.13-slim

WORKDIR /srv/app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY pyproject.toml ./
COPY README.md ./
COPY app ./app

RUN pip install --no-cache-dir .

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
