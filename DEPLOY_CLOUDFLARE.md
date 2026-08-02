# Deploy no Cloudflare

Status atual:

- Projeto Cloudflare Pages criado: `mercadinho-caminhar`
- URL de produção: `https://mercadinho-caminhar.pages.dev`
- Ultimo deploy validado com HTTP 200 em `2026-08-02`
- Proxy `/api/*` publicado em Cloudflare Pages Functions

Este projeto tem duas partes:

- `frontend`: React/Vite. Pode ser hospedado no Cloudflare Pages.
- `backend`: FastAPI + SQLAlchemy. Precisa rodar em um servidor/container com banco persistente, ou ser migrado para Cloudflare Workers/D1.

## Caminho recomendado agora

Hospede o frontend no Cloudflare Pages e publique o backend em um serviço que rode Docker/Postgres. Depois configure a variável `BACKEND_URL` no Pages com a URL pública do backend.

Exemplo:

```text
BACKEND_URL=https://api.seu-dominio.com
```

No código, o frontend usa `VITE_API_URL` quando ela existe. Se ela não existir, ele tenta chamar `/api`. Para Cloudflare Pages, este repositorio ja inclui um proxy em `frontend/functions/api/[[path]].js`; ele encaminha chamadas `/api/*` para a URL definida em `BACKEND_URL`.

Use `VITE_API_URL` apenas se quiser que o navegador chame a API diretamente, sem passar pelo proxy do Cloudflare Pages.

Quando o backend estiver publicado, configure:

```bash
npx wrangler pages secret put BACKEND_URL --project-name mercadinho-caminhar
```

Informe somente a base da API, por exemplo:

```text
https://api.seu-dominio.com
```

Depois publique novamente:

```bash
npm run build
npx wrangler pages deploy dist --project-name mercadinho-caminhar --branch main
```

## Deploy do frontend via Cloudflare Pages

Na pasta `frontend`:

```bash
npm ci
npm run build
npx wrangler pages project create mercadinho-caminhar --production-branch main
npx wrangler pages deploy dist --project-name mercadinho-caminhar --branch main
```

Se o projeto `mercadinho-caminhar` já existir no Cloudflare, pule o comando `pages project create`.

Para publicar uma nova versão depois de alterar o frontend:

```bash
npm run build
npx wrangler pages deploy dist --project-name mercadinho-caminhar --branch main
```

## Deploy do frontend pelo painel Cloudflare

1. Acesse Cloudflare Dashboard > Workers & Pages > Create application > Pages.
2. Conecte o repositório Git.
3. Configure:
   - Root directory: `frontend`
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variable/secret: `BACKEND_URL` com a URL pública do backend
4. Faça o deploy.

## Backend

O backend atual não é um site estático. Ele usa FastAPI e banco SQL via SQLAlchemy.

Opções:

- Manter o backend como Docker com Postgres usando o `docker-compose.yml` atual em um VPS/Render/Fly/Railway/Supabase/Neon + servidor Python.
- Migrar o backend para Cloudflare Workers + D1. Isso exige trocar SQLAlchemy/SQLite por bindings D1 e adaptar as rotas.
- Usar Cloudflare apenas como DNS/proxy na frente de um backend hospedado fora.

Para produção, defina estas variáveis no backend:

```text
DATABASE_URL=postgresql://usuario:senha@host:5432/netobebidas
SECRET_KEY=uma-chave-longa-e-secreta
TOKEN_EXPIRE_MINUTES=600
```

## Referências oficiais

- Cloudflare Pages com Vite: https://developers.cloudflare.com/pages/framework-guides/deploy-a-vite3-project/
- Direct Upload com Wrangler: https://developers.cloudflare.com/pages/get-started/direct-upload/
- Cloudflare D1: https://developers.cloudflare.com/d1/
- Cloudflare Containers: https://developers.cloudflare.com/containers/
