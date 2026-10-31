FROM node:24-alpine

WORKDIR /app
COPY package.json server.js ./
COPY public ./public
RUN mkdir /data && chown node:node /data

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_FILE=/data/store.json

EXPOSE 3000
USER node
CMD ["node", "server.js"]
