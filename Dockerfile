FROM registry.suse.com/bci/nodejs:20

LABEL org.opencontainers.image.title="telco-site-console" \
      org.opencontainers.image.description="Northline site console for the SUSE Telco Cloud workshop" \
      org.opencontainers.image.source="https://github.com/avaleror/telco-site-console" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.base.name="registry.suse.com/bci/nodejs:20"

WORKDIR /app

# UID/GID 1000 must match runAsUser/runAsGroup in the chart.
RUN groupadd --gid 1000 console && \
    useradd --uid 1000 --gid console --no-create-home --shell /sbin/nologin console

COPY --chown=1000:1000 app/server.js app/index.html /app/

USER 1000
EXPOSE 3000
ENV PORT=3000 NODE_ENV=production

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -sf http://localhost:3000/health || exit 1

CMD ["node", "/app/server.js"]
