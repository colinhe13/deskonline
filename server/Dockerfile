FROM node:22-alpine
RUN npm config set registry https://registry.npmmirror.com
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY prisma ./prisma
RUN npx prisma generate
COPY dist ./dist
EXPOSE 3001
CMD ["node", "dist/index.js"]
