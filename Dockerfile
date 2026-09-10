FROM node:20-bookworm-slim

# Install Python 3, pip, and build tools for XGBoost inference
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Set up Python virtual environment
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Copy and install Python dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy package manifests and install root dependencies
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy frontend manifests, install and build frontend bundle
COPY frontend/package*.json ./frontend/
RUN cd frontend && (npm ci || npm install)

COPY . .

RUN cd frontend && npm run build

ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

CMD ["node", "server.js"]
