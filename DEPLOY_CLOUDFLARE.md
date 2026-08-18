# Deploy no Cloudflare

Status atual:

- Projeto Cloudflare Pages: `mercadinho-caminhar`
- URL de producao: `https://mercadinho-caminhar.pages.dev`
- Banco D1: `mercadinho-caminhar-db`
- Database ID: `7a7fbcbc-fd0e-4419-be9d-5563a86afd5a`
- API `/api/*`: Cloudflare Pages Functions em `frontend/functions/api/[[path]].js`
- Banco resetado em `2026-08-02`: apenas 1 usuario administrador, sem clientes, produtos ou vendas
- Primeiro login: todo usuario criado com senha provisoria precisa cadastrar uma nova senha antes de usar o sistema
- Custos por setor/categoria: despesas como gelo, cebola e embalagens podem ser lançadas no estoque e entram no fechamento como custo indireto
- `SECRET_KEY` configurado como segredo no Cloudflare Pages
- Login protegido por Cloudflare Turnstile quando `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` estiverem configuradas

Este deploy nao depende mais de Render, Postgres externo ou `BACKEND_URL`.

## Arquitetura

- `frontend/src`: app React/Vite.
- `frontend/functions/api/[[path]].js`: API serverless equivalente ao backend principal.
- `frontend/d1/schema.sql`: schema do banco D1.
- `frontend/wrangler.jsonc`: configuracao do Pages e binding D1 `DB`.

## Publicar uma nova versao

Na pasta `frontend`:

```bash
npm run build
npx wrangler pages deploy dist --project-name mercadinho-caminhar --branch main
```

## Testes rapidos

Health check publico:

```bash
curl https://mercadinho-caminhar.pages.dev/api/health
```

Resposta esperada:

```json
{"status":"ok","runtime":"cloudflare-d1"}
```

Conferir contagens no D1:

```bash
npx wrangler d1 execute mercadinho-caminhar-db --remote --command "SELECT 'users' AS table_name, COUNT(*) AS count FROM users UNION ALL SELECT 'customers', COUNT(*) FROM customers UNION ALL SELECT 'products', COUNT(*) FROM products UNION ALL SELECT 'sales', COUNT(*) FROM sales UNION ALL SELECT 'sale_items', COUNT(*) FROM sale_items;"
```

## Aplicar schema novamente

Use apenas se o banco for recriado ou se houver novas tabelas/indices:

```bash
npx wrangler d1 execute mercadinho-caminhar-db --remote --file ./d1/schema.sql
```

Para aplicar a regra de troca obrigatoria em um D1 existente que ainda nao tenha a coluna:

```bash
npx wrangler d1 execute mercadinho-caminhar-db --remote --file ./d1/2026-08-02-add-must-change-password.sql
```

Para aplicar a tabela de custos por setor/categoria em um D1 existente:

```bash
npx wrangler d1 execute mercadinho-caminhar-db --remote --file ./d1/2026-08-02-add-category-costs.sql
```

## Estado inicial do banco

O D1 remoto foi deixado sem dados comerciais para testes e cadastro manual:

- `users`: 1
- `customers`: 0
- `products`: 0
- `category_costs`: 0
- `sales`: 0
- `sale_items`: 0

Nao registre senha no repositorio. Para trocar a senha do administrador, entre no sistema e edite o usuario pela tela de usuarios.

Novos usuarios criados pelo menu **Usuarios** ficam marcados automaticamente para trocar a senha no primeiro login. Enquanto a troca nao for feita, a API bloqueia as rotas de clientes, produtos, vendas e relatorios.

## Migrar dados do SQLite local novamente

O banco local original fica em:

```text
backend/netobebidas.db
```

Use esta etapa apenas se quiser migrar dados antigos no futuro. Para repetir a migracao, gere um SQL temporario a partir do SQLite e importe com:

```bash
npx wrangler d1 execute mercadinho-caminhar-db --remote --file CAMINHO_DO_SQL_GERADO
```

Atencao: se o SQL gerado tiver `DELETE FROM ...`, ele substitui os dados atuais no D1. Faca backup antes de repetir essa etapa em producao.

## Segredo JWT

O segredo `SECRET_KEY` ja foi configurado no Cloudflare Pages. Se precisar rotacionar:

```bash
npx wrangler pages secret put SECRET_KEY --project-name mercadinho-caminhar
```

Depois publique novamente:

```bash
npm run build
npx wrangler pages deploy dist --project-name mercadinho-caminhar --branch main
```

Quando `SECRET_KEY` mudar, usuarios logados precisam entrar novamente.

## Cloudflare Turnstile no login

O Turnstile precisa de duas partes:

- Widget na tela de login.
- Validacao server-side no endpoint `/api/token` usando a API Siteverify da Cloudflare.

O codigo ja esta preparado. Para ativar em producao:

1. Acesse o painel da Cloudflare.
2. Abra **Turnstile**.
3. Clique em **Add widget**.
4. Nome sugerido: `Mercadinho Caminhar Login`.
5. Em dominios/hostnames, adicione:
   - `mercadinho-caminhar.pages.dev`
   - Seu dominio personalizado, se houver.
6. Escolha o modo gerenciado padrao.
7. Copie a **Site key** e a **Secret key**.

Configure as chaves no Pages:

```bash
cd frontend
npx wrangler pages secret put TURNSTILE_SITE_KEY --project-name mercadinho-caminhar
npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name mercadinho-caminhar
```

Depois publique novamente:

```bash
npm run build
npx wrangler pages deploy dist --project-name mercadinho-caminhar --branch main
```

Para conferir se a configuracao chegou na Function:

```bash
curl https://mercadinho-caminhar.pages.dev/api/security/config
```

Resposta esperada apos configurar as duas chaves:

```json
{"turnstile":{"enabled":true,"site_key":"...","misconfigured":false}}
```

Se aparecer `enabled: false`, o login continua funcionando sem Turnstile. Se aparecer `misconfigured: true`, falta uma das duas chaves e o login fica bloqueado ate corrigir.

Para teste local, a Cloudflare fornece chaves dummy que funcionam em qualquer dominio. Use apenas em desenvolvimento:

```bash
TURNSTILE_SITE_KEY=1x00000000000000000000AA
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

## Referencias oficiais

- Cloudflare Pages: https://developers.cloudflare.com/pages/
- Pages Functions: https://developers.cloudflare.com/pages/functions/
- D1: https://developers.cloudflare.com/d1/
- Wrangler D1: https://developers.cloudflare.com/workers/wrangler/commands/#d1
- Turnstile client-side rendering: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
- Turnstile server-side validation: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
