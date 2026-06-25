FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies (required for some Python packages like psycopg)
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Hugging Face Spaces exposes port 7860
ENV PORT=7860
EXPOSE 7860

# Run the FastAPI application
CMD ["python", "main.py"]
