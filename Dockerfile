FROM node:22-bookworm-slim

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

RUN mkdir -p /app/storage/uploads /app/storage/artifacts /app/temp

EXPOSE 3000
CMD ["npm", "start"]
