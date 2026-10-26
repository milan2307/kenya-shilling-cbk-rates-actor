FROM apify/actor-node:22 AS builder
COPY package*.json ./
RUN npm ci --include=dev --audit=false
COPY . ./
RUN npm run build

FROM apify/actor-node:22
COPY package*.json ./
RUN npm ci --omit=dev --omit=optional --audit=false && rm -r ~/.npm
COPY --from=builder /usr/src/app/dist ./dist
COPY . ./
CMD ["node", "dist/src/main.js"]
