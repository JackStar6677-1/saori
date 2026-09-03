FROM node:20-alpine

RUN apk add --no-cache ffmpeg yt-dlp python3

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

# Parche de compatibilidad para @distube/yt-dlp con versiones recientes de yt-dlp
RUN node -e " \
  const fs = require('fs'); \
  const p = 'node_modules/@distube/yt-dlp/dist/index.js'; \
  if (fs.existsSync(p)) { \
    let c = fs.readFileSync(p, 'utf8'); \
    c = c.replace('noCallHome: true,', ''); \
    c = c.replace('process2.stderr?.on(\"data\", (chunk) => {\n      output += chunk;\n    });', 'let err = \"\"; process2.stderr?.on(\"data\", (chunk) => { err += chunk; });'); \
    fs.writeFileSync(p, c); \
  }"

COPY src/ ./src/

CMD ["node", "src/index.js"]
