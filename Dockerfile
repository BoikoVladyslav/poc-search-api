FROM ghcr.io/puppeteer/puppeteer:21.5.0

WORKDIR /usr/src/app

# Копіюємо тільки файли залежностей спочатку
COPY package.json ./

# НАЛАШТУВАННЯ:
# 1. Пропускаємо завантаження Chromium (він є в образі)
# 2. Вказуємо шлях до нього явно
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# ВСТАНОВЛЕННЯ:
# --no-audit: не перевіряти вразливості (швидше)
# --no-fund: не показувати повідомлення про донати
# --omit=dev: не ставити зайві бібліотеки для розробки
# --verbose: щоб бачити деталі в логах, якщо знову зависне
RUN npm install --no-audit --no-fund --omit=dev --verbose

# Копіюємо решту файлів
COPY . .

# Запуск
CMD [ "node", "server.js" ]
