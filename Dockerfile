FROM node:22-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node agents ./agents
COPY --chown=node:node public ./public
RUN mkdir -p data && chown node:node data
USER node
ENV HOST=0.0.0.0 PORT=3000
EXPOSE 3000
VOLUME /app/data
CMD ["node", "src/server.js"]
