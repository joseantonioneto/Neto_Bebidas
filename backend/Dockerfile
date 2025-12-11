# backend/Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Instala dependências
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copia o código
COPY . .

# Expõe a porta 8000
EXPOSE 8001

# Roda o servidor (0.0.0.0 permite acesso externo ao container)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]