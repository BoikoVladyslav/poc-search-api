FROM ghcr.io/puppeteer/puppeteer:21.5.0

WORKDIR /usr/src/app

COPY package*.json ./


ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN npm install

COPY . .

CMD [ "node", "index.js" ]
