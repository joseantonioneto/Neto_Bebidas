-- Evita venda duplicada por duplo clique / reenvio da mesma requisicao
ALTER TABLE sales ADD COLUMN client_request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_request_id
  ON sales(client_request_id) WHERE client_request_id IS NOT NULL;
