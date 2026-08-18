# Deploy do backend FastAPI no Render (legado)

Este caminho ficou como referencia legada. O deploy atual usa Cloudflare Pages Functions + D1 e nao precisa de Render.

Atencao: os planos pagos do Render podem gerar custo mensal. Evite criar Blueprint pelo `render.yaml` se a intencao for manter tudo no plano Cloudflare/D1.

O arquivo `render.yaml` foi removido para evitar criacao acidental de servicos pagos no Render.

## Como publicar

1. Suba este repositorio para o GitHub.
2. No Render Dashboard, escolha **New > Blueprint**.
3. Conecte o repositorio.
4. O Render deve detectar o arquivo `render.yaml`.
5. Confirme a criacao do Web Service e do Postgres.
6. Aguarde o deploy terminar.

Ao final, o backend tera uma URL parecida com:

```text
https://mercadinho-caminhar-api.onrender.com
```

Teste:

```bash
curl https://mercadinho-caminhar-api.onrender.com/health
```

## Conectar o frontend do Cloudflare ao backend

Depois que a API estiver online, configure a URL no Cloudflare Pages:

```bash
npx wrangler pages secret put BACKEND_URL --project-name mercadinho-caminhar
```

Quando o Wrangler pedir o valor, informe a URL base do backend:

```text
https://mercadinho-caminhar-api.onrender.com
```

Depois publique novamente o frontend:

```bash
cd frontend
npm run build
npx wrangler pages deploy dist --project-name mercadinho-caminhar --branch main
```

Teste final:

```bash
curl https://mercadinho-caminhar.pages.dev/api/health
```

Se estiver tudo certo, deve retornar `{"status":"ok", ...}`.

## Dados atuais

O deploy cria um banco Postgres novo. Se quiser levar os dados do `backend/netobebidas.db` para producao, faca a migracao depois que o Postgres estiver criado.

O banco local atual tem dados de clientes, produtos, vendas e usuarios. Nao apague o arquivo `.db` ate confirmar que os dados entraram no Postgres.
