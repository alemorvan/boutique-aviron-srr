# ============================================================
# Catalogue Vestimentaire - Société des régates Rennaises
# Image Docker multi-stages :
#   Stage 1 (build)  : python:alpine -> exécute build/build.py
#                      -> produit /dist (site statique + catalogue.pdf)
#   Stage 2 (serve)  : nginx-unprivileged -> sert /dist sur 8080
#                      -> injecte GOOGLE_SCRIPT_URL au démarrage
# ============================================================
#
# Build :
#   docker build -t boutique-srr .
#
# Run (local, sans enregistrement Google Sheets) :
#   docker run --rm -p 8080:8080 boutique-srr
#
# Run avec Google Sheets :
#   docker run --rm -p 8080:8080 \
#     -e GOOGLE_SCRIPT_URL="https://script.google.com/macros/s/XXX/exec" \
#     boutique-srr
#
# Puis ouvrir http://localhost:8080
# ============================================================

# -----------------------------------------------------------
# Stage 1 : build du site statique + catalogue PDF
# -----------------------------------------------------------
FROM python:3.12-alpine AS builder

WORKDIR /src

# Pré-installer les dépendances (layer mis en cache)
COPY build/requirements.txt ./build/requirements.txt
RUN pip install --no-cache-dir -r build/requirements.txt

# Copier les sources nécessaires au build
COPY build/            ./build/
COPY config/           ./config/
COPY index.html        ./
COPY css/              ./css/
COPY js/               ./js/
COPY assets/           ./assets/
COPY images/           ./images/

# Exécuter le build : dist/ = site prêt à servir
RUN python3 build/build.py --source . --output /dist

# -----------------------------------------------------------
# Stage 2 : serveur nginx non-root (port 8080)
# -----------------------------------------------------------
FROM nginxinc/nginx-unprivileged:1.27-alpine

LABEL org.opencontainers.image.title="Catalogue Vestimentaire SRR"
LABEL org.opencontainers.image.description="Boutique en ligne de la Société des régates Rennaises"
LABEL org.opencontainers.image.source="https://github.com/societe-regates-rennaises/boutique"

# L'image de base tourne en utilisateur non-root sur le port 8080.
USER root

# Config nginx du projet
COPY --chown=nginx:nginx nginx.conf /etc/nginx/conf.d/default.conf

# Récupérer le site statique construit au stage précédent
COPY --from=builder --chown=nginx:nginx /dist /usr/share/nginx/html

# Script d'entrée : génère js/runtime-config.js depuis les variables
# d'environnement puis lance nginx. Assure une permission d'écriture
# ciblée sur le dossier js/ pour l'utilisateur nginx.
COPY --chown=nginx:nginx docker/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh \
 && chown -R nginx:nginx /usr/share/nginx/html/js

USER nginx

EXPOSE 8080

# Healthcheck simple : endpoint /healthz défini dans nginx.conf
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:8080/healthz || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
