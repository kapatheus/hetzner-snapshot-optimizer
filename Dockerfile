FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

ENV DATA_DIR=/data

VOLUME ["/data"]

CMD ["node", "src/index.js"]
