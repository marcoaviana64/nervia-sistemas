# Ponte SEFAZ — Google Cloud Run (região southamerica-east1). Só biblioteca padrão do Python.
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY main.py .
ENV PYTHONUNBUFFERED=1
CMD ["python", "main.py"]
