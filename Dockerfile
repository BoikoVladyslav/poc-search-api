FROM ghcr.io/puppeteer/puppeteer:23.0.0

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY . .

EXPOSE 8080
CMD ["node", "server.js"]
