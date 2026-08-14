FROM node:22-bookworm

# Cài đặt pdflatex + các gói tiếng Việt + TikZ / tcolorbox cho Render.
# poppler-utils cho `pdftoppm`: OCR tách trang PDF thành ảnh trước khi gọi model.
RUN apt-get update && apt-get install -y --no-install-recommends \
    texlive-latex-base \
    texlive-latex-extra \
    texlive-lang-other \
    texlive-fonts-recommended \
    lmodern \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY web/package*.json ./web/
RUN cd web && npm install

COPY . .

WORKDIR /app/web
ENV PORT=5173
EXPOSE 5173

CMD ["node", "server.mjs"]
