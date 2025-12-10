# frontend/Dockerfile

# Etapa 1: Buildar o React
FROM node:18-alpine as build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY . .
# Aqui ele gera a pasta 'dist' com o site otimizado
RUN npm run build 

# Etapa 2: Servir com Nginx
FROM nginx:alpine
# Copia os arquivos gerados para o Nginx
COPY --from=build /app/dist /usr/share/nginx/html
# Configuração para o React Router não quebrar ao recarregar página
RUN echo 'server { \
    listen 80; \
    location / { \
        root /usr/share/nginx/html; \
        index index.html index.htm; \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]