FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git python3 ca-certificates \
 && npm install -g pnpm@10.28.2 \
 && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /workspace /srv && chown -R node:node /workspace /srv
WORKDIR /srv
COPY --chown=node:node src/policy.mjs /srv/policy.mjs
COPY --chown=node:node container/server.mjs /srv/server.mjs
USER node
EXPOSE 8080
CMD ["node","/srv/server.mjs"]
