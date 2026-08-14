FROM node:22-bookworm

# Cài đặt pdflatex + các gói tiếng Việt + TikZ / tcolorbox cho Render
RUN apt-get update && apt-get install -y --no-install-recommends \
    texlive-latex-base \
    texlive-latex-extra \
    texlive-lang-other \
    texlive-fonts-recommended \
    lmodern \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY web/package*.json ./web/
RUN cd web && npm install

COPY . .

WORKDIR /app/web
ENV PORT=5173
EXPOSE 5173

CMD ["node", "server.mjs"]
