import bcrypt from 'bcryptjs';

const PAYMENT_METHODS = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  cartao_debito: 'Cartao de debito',
  cartao_credito: 'Cartao de credito',
  fiado: 'Fiado'
};

// Chave pública RSA para o "connect challenge" do PagBank (a privada fica fora do repositório).
const PAGBANK_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvAoJx/AthlMgPkvnqONw
67AK4dqDsNOiBJz1SZ/c0R64TbWtRLQHaCOKMlYSmEp6mUcNYwA96TODlf+A7hDo
JbGPSvK57yubf84lKxlaW4t6vMEAww1sC4Ugfh7BmLTgmRBXMzGBIfGmgiT/vj+b
Izu6A/Mv04aKIeHYZdPrQ0pjSbkJfSlG6hp/sgvPLfzFczEw5cBhYsAzr9hAi6A4
rrp1jqEoJaIVpORvH4aZqhIZVNHc/yYzAJYgRxaoGrtjREgX6lFJihL7US1eNXRQ
fBqDyangAWo05Cv2vBjSD+U+hre3nuK1hfX//Sx4MfR+lF2K1RRNq6AgZWSyx2ZH
bQIDAQAB
-----END PUBLIC KEY-----
`;
const PAGBANK_KEY_CREATED_AT = 1787061427913;

const ADMIN_ROLE = 'admin';
const SELLER_ROLE = 'vendedor';
const VALID_ROLES = new Set([ADMIN_ROLE, SELLER_ROLE]);
const DEFAULT_CUSTOMER_NAME = 'Consumidor Final';
const DEFAULT_SECRET = 'netobebidas-chave-secreta-mude-isso-em-producao';
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const encoder = new TextEncoder();

class HttpError extends Error {
  constructor(status, detail) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

function getDb(env) {
  return env.DB || env.mercadinho_caminhar_db;
}

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    }
  });
}

function normalizePath(pathParam) {
  const raw = Array.isArray(pathParam) ? pathParam.join('/') : (pathParam || '');
  return raw.replace(/^\/+|\/+$/g, '');
}

function normalizeRole(role) {
  if (!VALID_ROLES.has(role)) throw new HttpError(400, 'Perfil de usuario invalido');
  return role;
}

function normalizePaymentMethod(method) {
  if (!PAYMENT_METHODS[method]) throw new HttpError(400, 'Forma de pagamento invalida');
  return method;
}

function normalizeEventDay(value) {
  const text = String(value || '').trim();
  return text ? text.slice(0, 40) : null;
}

function cleanBarcode(value) {
  const text = String(value || '').trim();
  return text || null;
}

function numberValue(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function intValue(value, fallback = 0) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function getTurnstileSiteKey(env) {
  return env.TURNSTILE_SITE_KEY || env.TURNSTILE_SITEKEY || '';
}

function getTurnstileSecretKey(env) {
  return env.TURNSTILE_SECRET_KEY || env.TURNSTILE_SECRET || '';
}

function turnstileState(env) {
  const siteKey = getTurnstileSiteKey(env);
  const secretKey = getTurnstileSecretKey(env);
  return {
    siteKey,
    secretKey,
    enabled: Boolean(siteKey && secretKey),
    misconfigured: Boolean(siteKey || secretKey) && !(siteKey && secretKey)
  };
}

function isTurnstileTestSecret(secretKey) {
  return [
    '1x0000000000000000000000000000000AA',
    '2x0000000000000000000000000000000AA',
    '3x0000000000000000000000000000000AA'
  ].includes(secretKey);
}

function securityConfig(env) {
  const state = turnstileState(env);
  return {
    turnstile: {
      enabled: state.enabled,
      site_key: state.enabled ? state.siteKey : '',
      misconfigured: state.misconfigured
    }
  };
}

function normalizeDateTime(value) {
  if (!value) return new Date().toISOString();
  const text = String(value);
  if (text.includes('T')) return text;
  return text.replace(' ', 'T');
}

function saleDate(value) {
  return normalizeDateTime(value).slice(0, 10);
}

function formatDay(value) {
  const date = saleDate(value);
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

function sortableDate(value) {
  return saleDate(value);
}

function base64Url(bytes) {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function base64UrlJson(data) {
  return base64Url(encoder.encode(JSON.stringify(data)));
}

function base64UrlToBytes(value) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function createAccessToken(user, env) {
  const secret = env.SECRET_KEY || DEFAULT_SECRET;
  const expiresInMinutes = intValue(env.TOKEN_EXPIRE_MINUTES, 600);
  const header = base64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64UrlJson({
    sub: user.username,
    role: user.role,
    must_change_password: Boolean(user.must_change_password),
    exp: Math.floor(Date.now() / 1000) + expiresInMinutes * 60
  });
  const signingInput = `${header}.${payload}`;
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));
  return `${signingInput}.${base64Url(signature)}`;
}

async function verifyAccessToken(token, env) {
  const [header, payload, signature] = String(token || '').split('.');
  if (!header || !payload || !signature) throw new HttpError(401, 'Token invalido');

  const secret = env.SECRET_KEY || DEFAULT_SECRET;
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify(
    'HMAC',
    key,
    base64UrlToBytes(signature),
    encoder.encode(`${header}.${payload}`)
  );
  if (!ok) throw new HttpError(401, 'Token invalido');

  const data = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)));
  if (!data.sub || (data.exp && data.exp < Math.floor(Date.now() / 1000))) {
    throw new HttpError(401, 'Token expirado');
  }
  return data;
}

async function all(db, sql, ...values) {
  const result = await db.prepare(sql).bind(...values).all();
  return result.results || [];
}

async function first(db, sql, ...values) {
  return db.prepare(sql).bind(...values).first();
}

async function run(db, sql, ...values) {
  return db.prepare(sql).bind(...values).run();
}

function lastRowId(result) {
  return result?.meta?.last_row_id || result?.meta?.lastRowId;
}

function serializeUser(row) {
  return {
    id: row.id,
    username: row.username,
    role: row.role || ADMIN_ROLE,
    must_change_password: Boolean(row.must_change_password)
  };
}

function serializeProduct(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category || 'Geral',
    barcode: row.barcode || null,
    cost_price: numberValue(row.cost_price),
    sell_price: numberValue(row.sell_price),
    stock: intValue(row.stock),
    photo: row.photo || null
  };
}

function serializeCategoryCost(row) {
  return {
    id: row.id,
    description: row.description,
    category: row.category || 'Geral',
    amount: numberValue(row.amount),
    event_day: row.event_day || 'Dia 1',
    created_at: normalizeDateTime(row.created_at)
  };
}

function serializeCustomer(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone || null,
    group_name: row.group_name || null,
    debt: numberValue(row.debt)
  };
}

function serializeSaleItem(row) {
  return {
    id: row.id,
    sale_id: row.sale_id,
    product_id: row.product_id,
    quantity: intValue(row.quantity),
    unit_sell_price: numberValue(row.unit_sell_price),
    unit_cost_price: numberValue(row.unit_cost_price),
    product: row.product_id ? {
      id: row.product_id,
      name: row.product_name || null,
      category: row.product_category || 'Geral',
      barcode: row.product_barcode || null
    } : null
  };
}

function serializeSale(row, items = []) {
  const method = row.payment_method || (row.is_paid ? 'dinheiro' : 'fiado');
  return {
    id: row.id,
    customer_id: row.customer_id,
    seller_username: row.seller_username || null,
    total_value: numberValue(row.total_value),
    is_paid: Boolean(row.is_paid),
    payment_method: method,
    payment_method_label: PAYMENT_METHODS[method] || method,
    payment_status: row.payment_status || (row.is_paid ? 'paid' : 'pending'),
    payment_provider: row.payment_provider || null,
    payment_reference: row.payment_reference || null,
    event_day: row.event_day || 'Dia 1',
    sale_date: saleDate(row.created_at),
    created_at: normalizeDateTime(row.created_at),
    customer: row.customer_name ? serializeCustomer({
      id: row.customer_id,
      name: row.customer_name,
      phone: row.customer_phone,
      group_name: row.customer_group_name,
      debt: row.customer_debt
    }) : null,
    items
  };
}

async function getSale(db, id) {
  const sale = await first(db, `
    SELECT s.*, c.name AS customer_name, c.phone AS customer_phone,
           c.group_name AS customer_group_name, c.debt AS customer_debt
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    WHERE s.id = ?
  `, id);
  if (!sale) return null;
  const items = await getSaleItems(db, id);
  return serializeSale(sale, items);
}

async function getSaleItems(db, saleId) {
  const rows = await all(db, `
    SELECT si.*, p.name AS product_name, p.category AS product_category,
           p.barcode AS product_barcode
    FROM sale_items si
    LEFT JOIN products p ON p.id = si.product_id
    WHERE si.sale_id = ?
    ORDER BY si.id
  `, saleId);
  return rows.map(serializeSaleItem);
}

// Busca os itens de varias vendas de uma vez so.
// Evita o padrao "1 query por venda", que estourava o limite de subrequisicoes
// do Worker conforme o numero de vendas crescia e derrubava o Resumo.
async function getSaleItemsBulk(db, saleIds) {
  const map = new Map();
  if (!saleIds.length) return map;
  // O D1 aceita no maximo 100 parametros por consulta
  const CHUNK = 90;
  for (let i = 0; i < saleIds.length; i += CHUNK) {
    const chunk = saleIds.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = await all(db, `
      SELECT si.*, p.name AS product_name, p.category AS product_category,
             p.barcode AS product_barcode
      FROM sale_items si
      LEFT JOIN products p ON p.id = si.product_id
      WHERE si.sale_id IN (${placeholders})
      ORDER BY si.sale_id, si.id
    `, ...chunk);
    for (const row of rows) {
      const list = map.get(row.sale_id) || [];
      list.push(serializeSaleItem(row));
      map.set(row.sale_id, list);
    }
  }
  return map;
}

// Todos os itens de uma vez, sem nenhum parametro na consulta.
// O resumo usa esta versao porque agrega o evento inteiro: assim nao existe
// risco de esbarrar no teto de parametros do D1, por maior que fique a base.
async function getAllSaleItems(db) {
  const rows = await all(db, `
    SELECT si.*, p.name AS product_name, p.category AS product_category,
           p.barcode AS product_barcode
    FROM sale_items si
    LEFT JOIN products p ON p.id = si.product_id
    ORDER BY si.sale_id, si.id
  `);
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row.sale_id) || [];
    list.push(serializeSaleItem(row));
    map.set(row.sale_id, list);
  }
  return map;
}

async function getCurrentUser(request, env, db) {
  const auth = request.headers.get('authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new HttpError(401, 'Nao autenticado');
  const payload = await verifyAccessToken(match[1], env);
  const user = await first(db, 'SELECT * FROM users WHERE username = ?', payload.sub);
  if (!user) throw new HttpError(401, 'Usuario nao encontrado');
  if (!user.role) user.role = ADMIN_ROLE;
  return user;
}

function requireAdmin(user) {
  if (user.role !== ADMIN_ROLE) throw new HttpError(403, 'Apenas administrador');
}

function requireSellerOrAdmin(user) {
  if (!VALID_ROLES.has(user.role)) throw new HttpError(403, 'Sem permissao');
}

function ensureAdminWillRemain(adminCount, user) {
  if (user.role === ADMIN_ROLE && adminCount <= 1) {
    throw new HttpError(400, 'E preciso manter ao menos um administrador');
  }
}

async function readJson(request) {
  if (!request.body) return {};
  return request.json();
}

async function readFormFields(request) {
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(await request.text());
    return {
      username: params.get('username') || '',
      password: params.get('password') || '',
      turnstileToken: params.get('cf-turnstile-response') || params.get('turnstile_token') || ''
    };
  }

  if (contentType.includes('multipart/form-data')) {
    const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[1] ||
      contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[2];
    if (boundary) {
      const fields = {};
      const body = await request.text();
      for (const part of body.split(`--${boundary}`)) {
        const name = part.match(/name="([^"]+)"/)?.[1];
        if (!name) continue;
        const value = part.split(/\r?\n\r?\n/).slice(1).join('\n\n').replace(/\r?\n--$/g, '').trimEnd();
        fields[name] = value;
      }
      return {
        username: fields.username || '',
        password: fields.password || '',
        turnstileToken: fields['cf-turnstile-response'] || fields.turnstile_token || ''
      };
    }
  }

  const form = await request.formData();
  return {
    username: form.get('username') || '',
    password: form.get('password') || '',
    turnstileToken: form.get('cf-turnstile-response') || form.get('turnstile_token') || ''
  };
}

async function verifyTurnstile(request, env, token) {
  const state = turnstileState(env);
  if (!state.enabled && !state.misconfigured) return;
  if (state.misconfigured) throw new HttpError(500, 'Turnstile nao configurado corretamente');
  if (!token) throw new HttpError(400, 'Complete a verificacao de seguranca');

  const form = new FormData();
  form.append('secret', state.secretKey);
  form.append('response', String(token));
  const remoteIp = request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim();
  if (remoteIp) form.append('remoteip', remoteIp);

  let result;
  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body: form });
    result = await response.json();
  } catch {
    throw new HttpError(400, 'Nao foi possivel validar a verificacao de seguranca');
  }

  const actionMismatch = result.action && result.action !== 'login' && !isTurnstileTestSecret(state.secretKey);
  if (!result.success || actionMismatch) {
    throw new HttpError(400, 'Verificacao de seguranca invalida. Tente novamente');
  }
}

async function login(request, env, db, ctx = {}) {
  const form = await readFormFields(request);
  const username = String(form.username || '').trim();
  const password = String(form.password || '');
  ctx.loginUsername = username;
  await verifyTurnstile(request, env, form.turnstileToken);
  const user = await first(db, 'SELECT * FROM users WHERE username = ?', username);
  if (!user || !bcrypt.compareSync(password, user.hashed_password || '')) {
    throw new HttpError(400, 'Login incorreto');
  }
  ctx.user = user;
  return json({
    access_token: await createAccessToken(user, env),
    token_type: 'bearer',
    user: serializeUser(user)
  });
}

async function listUsers(db) {
  const rows = await all(db, 'SELECT * FROM users ORDER BY username');
  return rows.map(serializeUser);
}

async function createUser(request, db) {
  const data = await readJson(request);
  const username = String(data.username || '').trim();
  if (!username || !data.password) throw new HttpError(400, 'Informe usuario e senha');
  const existing = await first(db, 'SELECT id FROM users WHERE username = ?', username);
  if (existing) throw new HttpError(400, 'Usuario ja existe');

  const role = normalizeRole(data.role || SELLER_ROLE);
  const hashed = bcrypt.hashSync(String(data.password), 10);
  const result = await run(
    db,
    'INSERT INTO users (username, hashed_password, role, must_change_password) VALUES (?, ?, ?, 1)',
    username,
    hashed,
    role
  );
  const user = await first(db, 'SELECT * FROM users WHERE id = ?', lastRowId(result));
  return serializeUser(user);
}

async function updateUser(request, db, id) {
  const data = await readJson(request);
  const user = await first(db, 'SELECT * FROM users WHERE id = ?', id);
  if (!user) throw new HttpError(404, 'Usuario nao encontrado');

  const updates = [];
  const values = [];
  if (data.username !== undefined) {
    const username = String(data.username || '').trim();
    if (!username) throw new HttpError(400, 'Informe o usuario');
    if (username !== user.username) {
      const existing = await first(db, 'SELECT id FROM users WHERE username = ?', username);
      if (existing) throw new HttpError(400, 'Usuario ja existe');
    }
    updates.push('username = ?');
    values.push(username);
  }
  if (data.password) {
    updates.push('hashed_password = ?');
    values.push(bcrypt.hashSync(String(data.password), 10));
    updates.push('must_change_password = 1');
  }
  if (data.role) {
    const role = normalizeRole(data.role);
    if (user.role === ADMIN_ROLE && role !== ADMIN_ROLE) {
      const row = await first(db, 'SELECT COUNT(*) AS count FROM users WHERE role = ?', ADMIN_ROLE);
      ensureAdminWillRemain(row.count, user);
    }
    updates.push('role = ?');
    values.push(role);
  }
  if (updates.length) {
    values.push(id);
    await run(db, `UPDATE users SET ${updates.join(', ')} WHERE id = ?`, ...values);
  }
  return serializeUser(await first(db, 'SELECT * FROM users WHERE id = ?', id));
}

async function changeOwnPassword(request, db, currentUser) {
  const data = await readJson(request);
  const newPassword = String(data.new_password || '');
  const currentPassword = String(data.current_password || '');

  if (newPassword.length < 6) {
    throw new HttpError(400, 'A nova senha precisa ter pelo menos 6 caracteres');
  }

  if (!currentUser.must_change_password) {
    if (!currentPassword || !bcrypt.compareSync(currentPassword, currentUser.hashed_password || '')) {
      throw new HttpError(400, 'Senha atual incorreta');
    }
  }

  if (bcrypt.compareSync(newPassword, currentUser.hashed_password || '')) {
    throw new HttpError(400, 'A nova senha precisa ser diferente da senha atual');
  }

  await run(
    db,
    'UPDATE users SET hashed_password = ?, must_change_password = 0 WHERE id = ?',
    bcrypt.hashSync(newPassword, 10),
    currentUser.id
  );

  const user = await first(db, 'SELECT * FROM users WHERE id = ?', currentUser.id);
  return { message: 'Senha atualizada', user: serializeUser(user) };
}

async function deleteUser(db, id, currentUser) {
  const user = await first(db, 'SELECT * FROM users WHERE id = ?', id);
  if (!user) throw new HttpError(404, 'Usuario nao encontrado');
  if (user.id === currentUser.id) throw new HttpError(400, 'Voce nao pode excluir o proprio usuario');
  if (user.role === ADMIN_ROLE) {
    const row = await first(db, 'SELECT COUNT(*) AS count FROM users WHERE role = ?', ADMIN_ROLE);
    ensureAdminWillRemain(row.count, user);
  }
  await run(db, 'DELETE FROM users WHERE id = ?', id);
  return { message: 'Usuario excluido' };
}

async function listProducts(db) {
  const rows = await all(db, 'SELECT * FROM products ORDER BY name');
  return rows.map(serializeProduct);
}

async function createProduct(request, db, user) {
  const data = await readJson(request);
  const name = String(data.name || '').trim();
  if (!name) throw new HttpError(400, 'Nome obrigatorio');

  const stock = intValue(data.stock);
  if (user.role === SELLER_ROLE && stock < 0) {
    throw new HttpError(403, 'Vendedor so pode adicionar estoque');
  }
  const category = String(data.category || 'Geral').trim() || 'Geral';
  const barcode = cleanBarcode(data.barcode);
  const cost = numberValue(data.cost_price);
  const sell = numberValue(data.sell_price);
  const photo = data.photo ? String(data.photo) : null;

  let existing = null;
  if (barcode) existing = await first(db, 'SELECT * FROM products WHERE barcode = ?', barcode);
  if (!existing) existing = await first(db, 'SELECT * FROM products WHERE name = ?', name);

  if (existing) {
    const totalCurrent = Math.max(intValue(existing.stock), 0) * numberValue(existing.cost_price);
    const totalNew = stock * cost;
    const newQty = Math.max(intValue(existing.stock), 0) + stock;
    const nextCost = newQty > 0 ? (totalCurrent + totalNew) / newQty : cost;
    const nextBarcode = existing.barcode || barcode;
    const nextPhoto = photo || existing.photo || null;
    await run(db, `
      UPDATE products
      SET name = ?, category = ?, barcode = ?, cost_price = ?, sell_price = ?, stock = ?, photo = ?
      WHERE id = ?
    `, name, category, nextBarcode, nextCost, sell, intValue(existing.stock) + stock, nextPhoto, existing.id);
    return serializeProduct(await first(db, 'SELECT * FROM products WHERE id = ?', existing.id));
  }

  const result = await run(db, `
    INSERT INTO products (name, category, barcode, cost_price, sell_price, stock, photo)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, name, category, barcode, cost, sell, stock, photo);
  return serializeProduct(await first(db, 'SELECT * FROM products WHERE id = ?', lastRowId(result)));
}

async function updateProduct(request, db, id) {
  const data = await readJson(request);
  const product = await first(db, 'SELECT * FROM products WHERE id = ?', id);
  if (!product) throw new HttpError(404, 'Produto nao encontrado');

  const updates = [];
  const values = [];
  for (const [field, column, parser] of [
    ['name', 'name', (v) => String(v)],
    ['category', 'category', (v) => String(v || 'Geral')],
    ['cost_price', 'cost_price', numberValue],
    ['sell_price', 'sell_price', numberValue],
    ['stock', 'stock', intValue],
    ['barcode', 'barcode', cleanBarcode],
    ['photo', 'photo', (v) => (v ? String(v) : null)]
  ]) {
    if (data[field] !== undefined) {
      updates.push(`${column} = ?`);
      values.push(parser(data[field]));
    }
  }
  if (updates.length) {
    values.push(id);
    await run(db, `UPDATE products SET ${updates.join(', ')} WHERE id = ?`, ...values);
  }
  return serializeProduct(await first(db, 'SELECT * FROM products WHERE id = ?', id));
}

async function listCategoryCosts(db, filters = {}) {
  const clauses = [];
  const values = [];

  if (filters.eventDay) {
    clauses.push('event_day = ?');
    values.push(filters.eventDay);
  }
  if (filters.startDate) {
    clauses.push('datetime(created_at) >= datetime(?)');
    values.push(filters.startDate);
  }
  if (filters.endDate) {
    clauses.push('datetime(created_at) <= datetime(?)');
    values.push(filters.endDate.length === 10 ? `${filters.endDate} 23:59:59` : filters.endDate);
  }

  const rows = await all(db, `
    SELECT *
    FROM category_costs
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY datetime(created_at) DESC, id DESC
  `, ...values);
  return rows.map(serializeCategoryCost);
}

async function createCategoryCost(request, db) {
  const data = await readJson(request);
  const description = String(data.description || '').trim();
  const category = String(data.category || 'Geral').trim() || 'Geral';
  const amount = numberValue(data.amount);
  const eventDay = normalizeEventDay(data.event_day) || 'Dia 1';

  if (!description) throw new HttpError(400, 'Informe a descricao do custo');
  if (amount <= 0) throw new HttpError(400, 'Informe um valor maior que zero');

  const result = await run(
    db,
    'INSERT INTO category_costs (description, category, amount, event_day, created_at) VALUES (?, ?, ?, ?, ?)',
    description,
    category,
    amount,
    eventDay,
    new Date().toISOString()
  );
  return serializeCategoryCost(await first(db, 'SELECT * FROM category_costs WHERE id = ?', lastRowId(result)));
}

async function deleteCategoryCost(db, id) {
  const cost = await first(db, 'SELECT * FROM category_costs WHERE id = ?', id);
  if (!cost) throw new HttpError(404, 'Custo nao encontrado');
  await run(db, 'DELETE FROM category_costs WHERE id = ?', id);
  return { message: 'Custo removido' };
}

async function generateQrForProduct(db, id) {
  const product = await first(db, 'SELECT * FROM products WHERE id = ?', id);
  if (!product) throw new HttpError(404, 'Produto nao encontrado');
  if (product.barcode) return { barcode: product.barcode, generated: false };
  const code = `MC-${String(product.id).padStart(5, '0')}`;
  await run(db, 'UPDATE products SET barcode = ? WHERE id = ?', code, id);
  return { barcode: code, generated: true };
}

async function generateQrForAllProducts(db) {
  const pending = await all(db, "SELECT * FROM products WHERE barcode IS NULL OR barcode = '' ORDER BY id");
  const generated = [];
  for (const product of pending) {
    const code = `MC-${String(product.id).padStart(5, '0')}`;
    await run(db, 'UPDATE products SET barcode = ? WHERE id = ?', code, product.id);
    generated.push({ id: product.id, name: product.name, barcode: code });
  }
  return { message: `${generated.length} codigos gerados`, generated };
}

async function bulkCreateProducts(request, db) {
  const data = await readJson(request);
  let created = 0;
  let updated = 0;
  for (const item of data.products || []) {
    const fakeRequest = new Request('https://local/products', {
      method: 'POST',
      body: JSON.stringify(item),
      headers: { 'content-type': 'application/json' }
    });
    const before = await first(db, 'SELECT id FROM products WHERE name = ? OR barcode = ?', item.name, item.barcode || '');
    await createProduct(fakeRequest, db, { role: ADMIN_ROLE });
    if (before) updated += 1;
    else created += 1;
  }
  return { message: `${created} criados, ${updated} atualizados`, created, updated };
}

function xmlText(block, tag) {
  const match = block.match(new RegExp(`<(?:\\w+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, 'i'));
  return decodeXml(match?.[1] || '').trim();
}

function decodeXml(value) {
  return String(value)
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

async function importNfe(request, db) {
  const form = await request.formData();
  const file = form.get('file');
  if (!file || !String(file.name || '').toLowerCase().endsWith('.xml')) {
    throw new HttpError(400, 'Envie um arquivo XML de NF-e');
  }
  const text = await file.text();
  const detBlocks = text.match(/<(?:\w+:)?det\b[\s\S]*?<\/(?:\w+:)?det>/gi) || [];
  let created = 0;
  let updated = 0;
  const items = [];

  for (const det of detBlocks) {
    const prod = det.match(/<(?:\w+:)?prod\b[\s\S]*?<\/(?:\w+:)?prod>/i)?.[0];
    if (!prod) continue;
    const name = xmlText(prod, 'xProd');
    if (!name) continue;
    const rawBarcode = xmlText(prod, 'cEAN') || xmlText(prod, 'cEANTrib');
    const barcode = rawBarcode && rawBarcode !== 'SEM GTIN' ? rawBarcode : null;
    const qty = Math.max(intValue(numberValue(xmlText(prod, 'qCom'))), 1);
    const unitCost = numberValue(xmlText(prod, 'vUnCom'));

    let existing = null;
    if (barcode) existing = await first(db, 'SELECT * FROM products WHERE barcode = ?', barcode);
    if (!existing) existing = await first(db, 'SELECT * FROM products WHERE name = ?', name);

    if (existing) {
      const totalCurrent = Math.max(intValue(existing.stock), 0) * numberValue(existing.cost_price);
      const totalNew = qty * unitCost;
      const newQty = Math.max(intValue(existing.stock), 0) + qty;
      const nextCost = newQty > 0 ? (totalCurrent + totalNew) / newQty : numberValue(existing.cost_price);
      await run(db, `
        UPDATE products SET cost_price = ?, stock = ?, barcode = COALESCE(barcode, ?)
        WHERE id = ?
      `, nextCost, intValue(existing.stock) + qty, barcode, existing.id);
      updated += 1;
      items.push({ name, qty, action: 'atualizado' });
    } else {
      const sell = Math.round(unitCost * 1.5 * 100) / 100;
      await run(db, `
        INSERT INTO products (name, category, barcode, cost_price, sell_price, stock)
        VALUES (?, 'NF-e', ?, ?, ?, ?)
      `, name, barcode, unitCost, sell, qty);
      created += 1;
      items.push({ name, qty, cost: unitCost, sell, action: 'criado' });
    }
  }
  return { message: `NF-e importada: ${created} novos, ${updated} atualizados`, created, updated, items };
}

async function listCustomers(db) {
  const rows = await all(db, 'SELECT * FROM customers ORDER BY name');
  return rows.map(serializeCustomer);
}

async function createCustomer(request, db) {
  const data = await readJson(request);
  const name = String(data.name || '').trim();
  if (!name) throw new HttpError(400, 'Nome obrigatorio');
  const result = await run(
    db,
    'INSERT INTO customers (name, phone, group_name, debt) VALUES (?, ?, ?, 0)',
    name,
    data.phone || null,
    data.group_name || null
  );
  return serializeCustomer(await first(db, 'SELECT * FROM customers WHERE id = ?', lastRowId(result)));
}

async function updateCustomer(request, db, id) {
  const data = await readJson(request);
  const customer = await first(db, 'SELECT * FROM customers WHERE id = ?', id);
  if (!customer) throw new HttpError(404, 'Cliente nao encontrado');
  const name = String(data.name || '').trim();
  if (!name) throw new HttpError(400, 'Nome obrigatorio');
  await run(
    db,
    'UPDATE customers SET name = ?, phone = ?, group_name = ? WHERE id = ?',
    name,
    data.phone ?? customer.phone,
    data.group_name ?? customer.group_name,
    id
  );
  return serializeCustomer(await first(db, 'SELECT * FROM customers WHERE id = ?', id));
}

async function deleteCustomer(db, id) {
  const customer = await first(db, 'SELECT * FROM customers WHERE id = ?', id);
  if (!customer) throw new HttpError(404, 'Cliente nao encontrado');
  if (numberValue(customer.debt) > 0) throw new HttpError(400, 'Cliente possui divida pendente');
  await run(db, 'DELETE FROM customers WHERE id = ?', id);
  return { message: 'Cliente excluido' };
}

async function payDebt(request, db, id, user) {
  const data = await readJson(request);
  const amount = numberValue(data.amount);
  if (amount <= 0) throw new HttpError(400, 'Valor invalido');

  // Idempotencia: duplo clique na baixa cobrava o cliente duas vezes e deixava
  // a divida negativa. Se a mesma requisicao chegar de novo, devolve a anterior.
  const clientRequestId = String(data.client_request_id || '').slice(0, 64) || null;
  if (clientRequestId) {
    const existing = await first(db, 'SELECT * FROM payments WHERE client_request_id = ?', clientRequestId);
    if (existing) {
      const atual = await first(db, 'SELECT debt FROM customers WHERE id = ?', id);
      return { message: 'Baixa ja registrada', duplicate: true, debt: numberValue(atual?.debt), amount: numberValue(existing.amount) };
    }
  }

  const customer = await first(db, 'SELECT * FROM customers WHERE id = ?', id);
  if (!customer) throw new HttpError(404, 'Cliente nao encontrado');

  const debt = numberValue(customer.debt);
  // Recusa em vez de deixar a divida negativa: valor maior que o devido e
  // quase sempre engano, e antes disso o saldo era corrompido em silencio.
  if (amount > debt + 0.001) {
    throw new HttpError(400, `Valor maior que a divida. ${customer.name} deve R$ ${debt.toFixed(2)}.`);
  }

  const novaDivida = Math.max(0, debt - amount);
  await db.batch([
    db.prepare('UPDATE customers SET debt = ? WHERE id = ?').bind(novaDivida, id),
    db.prepare(`
      INSERT INTO payments (customer_id, amount, username, note, client_request_id, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(id, amount, user?.username || null, data.note || null, clientRequestId)
  ]);

  return { message: 'Pago', debt: novaDivida, amount };
}

async function listPayments(db, opts = {}) {
  const limit = opts.limit || 0;
  const offset = opts.offset || 0;
  const search = stripAccents(opts.search || '');

  let rows = await all(db, `
    SELECT p.*, c.name AS customer_name, c.group_name AS customer_group_name, c.debt AS customer_debt
    FROM payments p
    LEFT JOIN customers c ON c.id = p.customer_id
    ORDER BY datetime(p.created_at) DESC, p.id DESC
  `);

  if (search) {
    rows = rows.filter((r) => stripAccents(`${r.customer_name || ''} ${r.username || ''}`).includes(search));
  }

  const total = rows.length;
  const somaTotal = rows.reduce((acc, r) => acc + numberValue(r.amount), 0);
  const pageRows = limit ? rows.slice(offset, offset + limit) : rows;

  const items = pageRows.map((row) => ({
    id: row.id,
    customer_id: row.customer_id,
    customer_name: row.customer_name,
    customer_group_name: row.customer_group_name,
    customer_debt: numberValue(row.customer_debt),
    amount: numberValue(row.amount),
    username: row.username,
    note: row.note,
    created_at: row.created_at
  }));

  return { items, total, total_amount: somaTotal, limit, offset };
}

// Estorna uma baixa: devolve o valor para a divida do cliente e apaga o registro
async function cancelPayment(db, id) {
  const pagamento = await first(db, 'SELECT * FROM payments WHERE id = ?', id);
  if (!pagamento) throw new HttpError(404, 'Baixa nao encontrada');
  await db.batch([
    db.prepare('UPDATE customers SET debt = debt + ? WHERE id = ?')
      .bind(numberValue(pagamento.amount), pagamento.customer_id),
    db.prepare('DELETE FROM payments WHERE id = ?').bind(id)
  ]);
  return { message: 'Baixa estornada', amount: numberValue(pagamento.amount) };
}

async function bulkCreateCustomers(request, db) {
  const data = await readJson(request);
  let created = 0;
  let skipped = 0;
  for (const item of data.customers || []) {
    const name = String(item.name || '').trim();
    if (!name) {
      skipped += 1;
      continue;
    }
    const existing = await first(db, 'SELECT * FROM customers WHERE name = ?', name);
    if (existing) {
      await run(
        db,
        'UPDATE customers SET phone = COALESCE(phone, ?), group_name = COALESCE(group_name, ?) WHERE id = ?',
        item.phone || null,
        item.group_name || null,
        existing.id
      );
      skipped += 1;
      continue;
    }
    await run(
      db,
      'INSERT INTO customers (name, phone, group_name, debt) VALUES (?, ?, ?, 0)',
      name,
      item.phone || null,
      item.group_name || null
    );
    created += 1;
  }
  return { message: `${created} clientes importados, ${skipped} ignorados`, created, skipped };
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ';' && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

async function importCustomersCsv(request, db) {
  const form = await request.formData();
  const file = form.get('file');
  if (!file) throw new HttpError(400, 'Envie um arquivo CSV');
  const text = (await file.text()).replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { message: '0 clientes importados, 0 ignorados/duplicados', created: 0, skipped: 0 };
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const customers = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((h, i) => [h, cells[i] || '']));
    return {
      name: (row.nome || row.Nome || row.name || row.Name || '').trim(),
      phone: (row.telefone || row.Telefone || row.phone || '').trim() || null,
      group_name: (row.grupo || row.Grupo || row.group || '').trim() || null
    };
  });
  const result = await bulkCreateCustomers(
    new Request('https://local/customers/bulk', {
      method: 'POST',
      body: JSON.stringify({ customers }),
      headers: { 'content-type': 'application/json' }
    }),
    db
  );
  return {
    message: `${result.created} clientes importados, ${result.skipped} ignorados/duplicados`,
    created: result.created,
    skipped: result.skipped
  };
}

// Texto sem acento e em minusculo, para a busca casar com ou sem acento
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');
function stripAccents(value) {
  return String(value ?? '').normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase().trim();
}

// Lista de vendas com paginacao. Os itens de cada venda so sao buscados para a
// pagina que vai ser exibida — e o que mantem o historico leve com o passar do evento.
async function listSales(db, opts = {}) {
  const limit = opts.limit || 0;
  const offset = opts.offset || 0;
  const search = stripAccents(opts.search || '');
  const method = opts.method || '';
  const status = opts.status || '';

  const clauses = [];
  const values = [];
  if (method) {
    clauses.push('s.payment_method = ?');
    values.push(method);
  }
  if (status === 'fiado') clauses.push('s.is_paid = 0');
  else if (status === 'pago') clauses.push('s.is_paid = 1');

  let rows = await all(db, `
    SELECT s.*, c.name AS customer_name, c.phone AS customer_phone,
           c.group_name AS customer_group_name, c.debt AS customer_debt
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY datetime(s.created_at) DESC, s.id DESC
  `, ...values);

  // O SQLite nao tem "unaccent", entao o filtro por nome e feito aqui
  if (search) {
    rows = rows.filter((r) => stripAccents(`${r.customer_name || ''} ${r.seller_username || ''}`).includes(search));
  }

  const total = rows.length;
  const pageRows = limit ? rows.slice(offset, offset + limit) : rows;
  const itemsBySale = await getSaleItemsBulk(db, pageRows.map((r) => r.id));
  const items = pageRows.map((row) => serializeSale(row, itemsBySale.get(row.id) || []));

  // Sem limit devolve o array puro (compatibilidade com o formato antigo)
  return limit ? { items, total, limit, offset } : items;
}

async function listCustomerSales(db, customerId) {
  const rows = await all(db, `
    SELECT s.*, c.name AS customer_name, c.phone AS customer_phone,
           c.group_name AS customer_group_name, c.debt AS customer_debt
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    WHERE s.customer_id = ?
    ORDER BY datetime(s.created_at) DESC, s.id DESC
  `, customerId);
  const itemsBySale = await getSaleItemsBulk(db, rows.map((r) => r.id));
  return rows.map((row) => serializeSale(row, itemsBySale.get(row.id) || []));
}

// Cancela uma venda: devolve o estoque de cada item, reverte a divida (se era fiado) e apaga o registro.
async function cancelSale(db, id) {
  const sale = await first(db, 'SELECT * FROM sales WHERE id = ?', id);
  if (!sale) throw new HttpError(404, 'Venda nao encontrada');
  const items = await all(db, 'SELECT * FROM sale_items WHERE sale_id = ?', id);

  const comandos = items.map((item) =>
    db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?')
      .bind(intValue(item.quantity), item.product_id));

  // Se a venda era fiado e o cliente ja tinha quitado, o MAX(0, ...) engolia a
  // diferenca em silencio. Agora esse saldo a devolver volta na resposta.
  let creditoAoCliente = 0;
  if (!sale.is_paid && sale.customer_id) {
    const cliente = await first(db, 'SELECT debt FROM customers WHERE id = ?', sale.customer_id);
    const dividaAtual = numberValue(cliente?.debt);
    const valor = numberValue(sale.total_value);
    if (valor > dividaAtual) creditoAoCliente = Number((valor - dividaAtual).toFixed(2));
    comandos.push(db.prepare('UPDATE customers SET debt = MAX(0, debt - ?) WHERE id = ?')
      .bind(valor, sale.customer_id));
  }

  comandos.push(db.prepare('DELETE FROM sale_items WHERE sale_id = ?').bind(id));
  comandos.push(db.prepare('DELETE FROM sales WHERE id = ?').bind(id));
  await db.batch(comandos);

  return {
    message: creditoAoCliente > 0
      ? `Venda cancelada. Atencao: o cliente ja tinha pago, devolver R$ ${creditoAoCliente.toFixed(2)}.`
      : 'Venda cancelada e estoque restaurado',
    restored_items: items.length,
    credit_to_customer: creditoAoCliente
  };
}

async function createSale(request, db, user) {
  const data = await readJson(request);

  // Idempotencia: o app manda um id unico por carrinho. Se a mesma requisicao
  // chegar duas vezes (duplo clique, rede lenta, reenvio), devolve a venda que
  // ja foi gravada em vez de criar outra e baixar o estoque de novo.
  const clientRequestId = String(data.client_request_id || '').slice(0, 64) || null;
  if (clientRequestId) {
    const existing = await first(db, 'SELECT id FROM sales WHERE client_request_id = ?', clientRequestId);
    if (existing) {
      return { message: 'Venda ja registrada', duplicate: true, sale: await getSale(db, existing.id) };
    }
  }

  const paymentMethod = normalizePaymentMethod(data.payment_method || 'dinheiro');
  const eventDay = normalizeEventDay(data.event_day) || 'Dia 1';
  let isPaid = data.is_paid === undefined || data.is_paid === null ? paymentMethod !== 'fiado' : Boolean(data.is_paid);
  if (paymentMethod === 'fiado') isPaid = false;

  const customer = await first(db, 'SELECT * FROM customers WHERE id = ?', intValue(data.customer_id));
  if (!customer) throw new HttpError(404, 'Cliente nao encontrado');
  if (!isPaid && customer.name === DEFAULT_CUSTOMER_NAME) {
    throw new HttpError(400, 'Fiado exige um cliente identificado. Selecione ou cadastre o cliente.');
  }

  const counts = new Map();
  if (Array.isArray(data.items) && data.items.length) {
    for (const item of data.items) {
      const qty = intValue(item.quantity);
      if (qty <= 0) throw new HttpError(400, 'Quantidade invalida');
      const id = intValue(item.product_id);
      counts.set(id, (counts.get(id) || 0) + qty);
    }
  } else if (Array.isArray(data.product_ids) && data.product_ids.length) {
    for (const id of data.product_ids) counts.set(intValue(id), (counts.get(intValue(id)) || 0) + 1);
  } else {
    throw new HttpError(400, 'Carrinho vazio');
  }

  let total = 0;
  const saleItems = [];
  for (const [productId, qty] of counts.entries()) {
    const product = await first(db, 'SELECT * FROM products WHERE id = ?', productId);
    if (!product) throw new HttpError(404, `Produto ${productId} nao encontrado`);
    if (intValue(product.stock) < qty) throw new HttpError(400, `Sem estoque: ${product.name}`);
    total += numberValue(product.sell_price) * qty;
    saleItems.push({
      product_id: productId,
      quantity: qty,
      unit_sell_price: numberValue(product.sell_price),
      unit_cost_price: numberValue(product.cost_price)
    });
  }

  // Tudo numa transacao so. Antes, a venda, a baixa do estoque e a soma da
  // divida eram gravadas em comandos separados: se a requisicao morresse no
  // meio, a venda ficava registrada sem entrar na divida do cliente.
  const proximo = await first(db, 'SELECT COALESCE(MAX(id), 0) + 1 AS proximoId FROM sales');
  const saleId = intValue(proximo?.proximoId) || 1;

  const comandos = [
    db.prepare(`
      INSERT INTO sales (
        id, customer_id, seller_username, total_value, is_paid, payment_method,
        payment_status, payment_provider, payment_reference, event_day,
        client_request_id, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(
      saleId,
      customer.id,
      user.username,
      total,
      isPaid ? 1 : 0,
      paymentMethod,
      isPaid ? 'paid' : 'pending',
      data.payment_provider || null,
      data.payment_reference || null,
      eventDay,
      clientRequestId
    )
  ];

  for (const item of saleItems) {
    comandos.push(db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, quantity, unit_sell_price, unit_cost_price)
      VALUES (?, ?, ?, ?, ?)
    `).bind(saleId, item.product_id, item.quantity, item.unit_sell_price, item.unit_cost_price));
    comandos.push(db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?')
      .bind(item.quantity, item.product_id));
  }

  if (!isPaid) {
    comandos.push(db.prepare('UPDATE customers SET debt = debt + ? WHERE id = ?')
      .bind(total, customer.id));
  }

  try {
    await db.batch(comandos);
  } catch (err) {
    // Duas vendas simultaneas podem disputar o mesmo id: falha inteira, sem
    // gravar nada pela metade. O vendedor so precisa repetir.
    throw new HttpError(409, 'Nao foi possivel concluir a venda. Tente novamente.');
  }

  return { message: 'Venda realizada', sale: await getSale(db, saleId) };
}

async function salesSummary(request, db) {
  const url = new URL(request.url);
  const eventDay = url.searchParams.get('event_day');
  const startDate = url.searchParams.get('start_date');
  const endDate = url.searchParams.get('end_date');
  // Quando o grafico esta filtrado por produto, by_day passa a somar so ele
  const chartProductId = intValue(url.searchParams.get('product_id')) || 0;

  const clauses = [];
  const values = [];
  if (eventDay) {
    clauses.push('s.event_day = ?');
    values.push(eventDay);
  }
  if (startDate) {
    clauses.push('datetime(s.created_at) >= datetime(?)');
    values.push(startDate);
  }
  if (endDate) {
    clauses.push('datetime(s.created_at) <= datetime(?)');
    values.push(endDate.length === 10 ? `${endDate} 23:59:59` : endDate);
  }

  const rows = await all(db, `
    SELECT s.*, c.name AS customer_name, c.phone AS customer_phone,
           c.group_name AS customer_group_name, c.debt AS customer_debt
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY datetime(s.created_at) DESC, s.id DESC
  `, ...values);

  const byPayment = {};
  const byEventDay = {};
  const byProduct = {};
  const bySeller = {};
  const byDay = {};
  let grossTotal = 0;
  let directCostTotal = 0;
  let debtTotal = 0;
  const sales = [];

  const itemsBySale = await getAllSaleItems(db);

  for (const row of rows) {
    const items = itemsBySale.get(row.id) || [];
    const sale = serializeSale(row, items);
    sales.push(sale);
    const method = sale.payment_method;
    const total = numberValue(sale.total_value);
    grossTotal += total;
    if (!sale.is_paid) debtTotal += total;

    byPayment[method] ||= { payment_method: method, label: PAYMENT_METHODS[method] || method, count: 0, total: 0 };
    byPayment[method].count += 1;
    byPayment[method].total += total;

    const day = formatDay(row.created_at);
    const dayKey = sortableDate(row.created_at);
    byEventDay[day] ||= { event_day: day, date: dayKey, count: 0, total: 0 };
    byEventDay[day].count += 1;
    byEventDay[day].total += total;

    byDay[dayKey] ||= { date: dayKey, total: 0 };
    if (!chartProductId) byDay[dayKey].total += total;

    const seller = sale.seller_username || 'desconhecido';
    bySeller[seller] ||= { seller, count: 0, total: 0 };
    bySeller[seller].count += 1;
    bySeller[seller].total += total;

    for (const item of items) {
      const itemCost = item.quantity * item.unit_cost_price;
      const itemTotal = item.quantity * item.unit_sell_price;
      directCostTotal += itemCost;
      if (chartProductId && item.product_id === chartProductId) byDay[dayKey].total += itemTotal;
      byProduct[item.product_id] ||= {
        product_id: item.product_id,
        name: item.product?.name || `Produto ${item.product_id}`,
        category: item.product?.category || 'Geral',
        quantity: 0,
        total: 0,
        cost: 0
      };
      byProduct[item.product_id].quantity += item.quantity;
      byProduct[item.product_id].total += itemTotal;
      byProduct[item.product_id].cost += itemCost;
    }
  }

  const categoryCosts = await listCategoryCosts(db, { eventDay, startDate, endDate });
  const indirectCostTotal = categoryCosts.reduce((sum, cost) => sum + numberValue(cost.amount), 0);
  const byCategoryCost = {};
  for (const cost of categoryCosts) {
    byCategoryCost[cost.category] ||= { category: cost.category, count: 0, total: 0 };
    byCategoryCost[cost.category].count += 1;
    byCategoryCost[cost.category].total += numberValue(cost.amount);
  }

  const costTotal = directCostTotal + indirectCostTotal;
  const paidTotal = grossTotal - debtTotal;
  return {
    filters: { event_day: eventDay, start_date: startDate, end_date: endDate },
    totals: {
      sales_count: sales.length,
      gross_total: grossTotal,
      paid_total: paidTotal,
      debt_total: debtTotal,
      direct_cost_total: directCostTotal,
      indirect_cost_total: indirectCostTotal,
      cost_total: costTotal,
      profit_total: grossTotal - costTotal
    },
    by_payment_method: Object.values(byPayment).sort((a, b) => a.label.localeCompare(b.label)),
    by_event_day: Object.values(byEventDay).sort((a, b) => a.date.localeCompare(b.date)),
    by_seller: Object.values(bySeller).sort((a, b) => b.total - a.total),
    by_category_cost: Object.values(byCategoryCost).sort((a, b) => b.total - a.total),
    category_costs: categoryCosts,
    top_products: Object.values(byProduct).sort((a, b) => b.total - a.total),
    by_day: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date))
    // O array completo de vendas saiu daqui: o historico agora tem modulo
    // proprio e pagina sob demanda, o que deixou o resumo bem mais leve.
  };
}


async function handle(request, env, params, ctx = {}) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: json({}).headers });

  const db = getDb(env);
  if (!db) throw new HttpError(500, 'Binding D1 DB nao configurado');
  ctx.db = db;

  const path = normalizePath(params.path);
  const parts = path ? path.split('/') : [];
  const [resource, second, third] = parts;
  ctx.parts = parts;
  ctx.path = path;

  if (!resource || (resource === 'health' && request.method === 'GET')) {
    return json({ status: 'ok', timestamp: new Date().toISOString(), runtime: 'cloudflare-d1' });
  }

  if (resource === 'security' && second === 'config' && request.method === 'GET') {
    return json(securityConfig(env));
  }

  // Endpoint público do "connect challenge" do PagBank (serve a chave pública)
  if (resource === 'public-key' && request.method === 'GET') {
    return json({ public_key: PAGBANK_PUBLIC_KEY, created_at: PAGBANK_KEY_CREATED_AT });
  }

  if (resource === 'token' && request.method === 'POST') return login(request, env, db, ctx);

  const currentUser = await getCurrentUser(request, env, db);
  ctx.user = currentUser;

  if (resource === 'me' && request.method === 'GET') return json(serializeUser(currentUser));

  if (resource === 'users' && second === 'me' && third === 'password' && request.method === 'POST') {
    return json(await changeOwnPassword(request, db, currentUser));
  }

  if (currentUser.must_change_password) {
    throw new HttpError(403, 'Troque sua senha antes de continuar');
  }

  if (resource === 'payment-methods' && request.method === 'GET') {
    requireSellerOrAdmin(currentUser);
    return json(Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label })));
  }

  if (resource === 'pix' && second === 'charge' && !third && request.method === 'POST') {
    requireSellerOrAdmin(currentUser);
    return json(await createPixCharge(request, env));
  }

  if (resource === 'pix' && second === 'charge' && third && request.method === 'GET') {
    requireSellerOrAdmin(currentUser);
    return json(await getPixStatus(third, env));
  }

  if (resource === 'vouchers') {
    requireSellerOrAdmin(currentUser);
    if (!second && request.method === 'GET') return json(await listVouchers(db));
    if (!second && request.method === 'POST') return json(await createVoucher(request, db, currentUser));
    if (second === 'summary' && request.method === 'GET') return json(await voucherSummary(db));
    if (second === 'code' && third && request.method === 'GET') return json(await getVoucherByCode(db, third));
    if (second && third === 'redeem' && request.method === 'POST') return json(await redeemVoucher(db, intValue(second), currentUser));
    if (second && third === 'cancel' && request.method === 'POST') {
      requireAdmin(currentUser);
      return json(await cancelVoucher(db, intValue(second)));
    }
  }

  if (resource === 'users') {
    requireAdmin(currentUser);
    if (!second && request.method === 'GET') return json(await listUsers(db));
    if (!second && request.method === 'POST') return json(await createUser(request, db));
    if (second && request.method === 'PUT') return json(await updateUser(request, db, intValue(second)));
    if (second && request.method === 'DELETE') return json(await deleteUser(db, intValue(second), currentUser));
  }

  if (resource === 'activity-logs' && request.method === 'GET') {
    requireAdmin(currentUser);
    return json(await listActivityLogs(db, new URL(request.url)));
  }

  if (resource === 'products') {
    if (!second && request.method === 'GET') {
      requireSellerOrAdmin(currentUser);
      return json(await listProducts(db));
    }
    if (!second && request.method === 'POST') {
      requireSellerOrAdmin(currentUser);
      return json(await createProduct(request, db, currentUser));
    }
    if (second === 'barcode' && third && request.method === 'GET') {
      requireSellerOrAdmin(currentUser);
      const product = await first(db, 'SELECT * FROM products WHERE barcode = ?', decodeURIComponent(third));
      if (!product) throw new HttpError(404, 'Produto nao encontrado com este codigo');
      return json(serializeProduct(product));
    }
    requireAdmin(currentUser);
    if (second === 'generate-qrcode-all' && request.method === 'POST') return json(await generateQrForAllProducts(db));
    if (second === 'generate-qrcode' && third && request.method === 'POST') return json(await generateQrForProduct(db, intValue(third)));
    if (second === 'bulk' && request.method === 'POST') return json(await bulkCreateProducts(request, db));
    if (second === 'import-nfe' && request.method === 'POST') return json(await importNfe(request, db));
    if (second && request.method === 'PUT') return json(await updateProduct(request, db, intValue(second)));
  }

  if (resource === 'category-costs') {
    requireAdmin(currentUser);
    if (!second && request.method === 'GET') return json(await listCategoryCosts(db));
    if (!second && request.method === 'POST') return json(await createCategoryCost(request, db));
    if (second && request.method === 'DELETE') return json(await deleteCategoryCost(db, intValue(second)));
  }

  if (resource === 'customers') {
    if (!second && request.method === 'GET') {
      requireSellerOrAdmin(currentUser);
      return json(await listCustomers(db));
    }
    if (!second && request.method === 'POST') {
      requireSellerOrAdmin(currentUser);
      return json(await createCustomer(request, db));
    }
    if (second === 'bulk' && request.method === 'POST') {
      requireAdmin(currentUser);
      return json(await bulkCreateCustomers(request, db));
    }
    if (second === 'import-csv' && request.method === 'POST') {
      requireAdmin(currentUser);
      return json(await importCustomersCsv(request, db));
    }
    if (second && third === 'pay' && request.method === 'POST') {
      requireSellerOrAdmin(currentUser);
      return json(await payDebt(request, db, intValue(second), currentUser));
    }
    if (second && third === 'sales' && request.method === 'GET') {
      requireSellerOrAdmin(currentUser);
      return json(await listCustomerSales(db, intValue(second)));
    }
    if (second && request.method === 'PUT') {
      requireSellerOrAdmin(currentUser);
      return json(await updateCustomer(request, db, intValue(second)));
    }
    if (second && request.method === 'DELETE') {
      requireAdmin(currentUser);
      return json(await deleteCustomer(db, intValue(second)));
    }
  }

  if (resource === 'payments') {
    requireAdmin(currentUser);
    if (!second && request.method === 'GET') {
      const q = new URL(request.url).searchParams;
      return json(await listPayments(db, {
        limit: intValue(q.get('limit')) || 0,
        offset: intValue(q.get('offset')) || 0,
        search: q.get('search') || ''
      }));
    }
    if (second && third === 'cancel' && request.method === 'POST') {
      return json(await cancelPayment(db, intValue(second)));
    }
  }

  if (resource === 'sales') {
    if (!second && request.method === 'GET') {
      requireAdmin(currentUser);
      const q = new URL(request.url).searchParams;
      return json(await listSales(db, {
        limit: intValue(q.get('limit')) || 0,
        offset: intValue(q.get('offset')) || 0,
        search: q.get('search') || '',
        method: q.get('method') || '',
        status: q.get('status') || ''
      }));
    }
    if (!second && request.method === 'POST') {
      requireSellerOrAdmin(currentUser);
      return json(await createSale(request, db, currentUser));
    }
    if (second && third === 'cancel' && request.method === 'POST') {
      requireAdmin(currentUser);
      return json(await cancelSale(db, intValue(second)));
    }
  }

  if (resource === 'reports' && second === 'summary' && request.method === 'GET') {
    requireAdmin(currentUser);
    return json(await salesSummary(request, db));
  }

  throw new HttpError(404, 'Rota nao encontrada');
}

function pagbankConfig(env) {
  const token = env.PAGBANK_TOKEN || '';
  const base = env.PAGBANK_ENV === 'sandbox'
    ? 'https://sandbox.api.pagseguro.com'
    : 'https://api.pagseguro.com';
  return { token, base };
}

// Cria uma cobranca PIX (order com QR Code) no PagBank e devolve o texto/imagem do QR
async function createPixCharge(request, env) {
  const { token, base } = pagbankConfig(env);
  if (!token) throw new HttpError(503, 'PIX automatico nao configurado');
  const data = await readJson(request);
  const cents = Math.round(numberValue(data.amount) * 100);
  if (cents <= 0) throw new HttpError(400, 'Valor invalido');

  const expiration = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const taxId = String(env.PAGBANK_DEFAULT_TAXID || '').replace(/\D/g, '');
  const customer = {
    name: String(data.customer_name || env.PAGBANK_DEFAULT_NAME || 'Consumidor Final').slice(0, 60),
    email: env.PAGBANK_DEFAULT_EMAIL || 'cliente@mercadinhocaminhar.com'
  };
  if (taxId) customer.tax_id = taxId;

  const body = {
    reference_id: String(data.reference_id || `venda-${Date.now()}`).slice(0, 60),
    customer,
    items: [{ name: 'Venda Mercadinho Caminhar', quantity: 1, unit_amount: cents }],
    qr_codes: [{ amount: { value: cents }, expiration_date: expiration }]
  };

  const resp = await fetch(`${base}/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify(body)
  });
  const result = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = result?.error_messages?.[0]?.description || result?.message || 'erro ao gerar cobranca PIX';
    throw new HttpError(502, `PagBank: ${msg}`);
  }
  const qr = (result.qr_codes && result.qr_codes[0]) || {};
  const image = (qr.links || []).find((l) => l.media === 'image/png' || (l.rel || '').includes('QRCODE.PNG'));
  return {
    order_id: result.id || null,
    qr_text: qr.text || null,
    qr_image: image ? image.href : null,
    expiration: qr.expiration_date || expiration
  };
}

// Consulta um pedido no PagBank e informa se ja foi pago
async function getPixStatus(orderId, env) {
  const { token, base } = pagbankConfig(env);
  if (!token) throw new HttpError(503, 'PIX automatico nao configurado');
  const resp = await fetch(`${base}/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${token}`, accept: 'application/json' }
  });
  const result = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new HttpError(502, 'Erro ao consultar pagamento');
  const charges = result.charges || [];
  const paid = charges.some((c) => c.status === 'PAID');
  return { paid, status: paid ? 'PAID' : (charges[0] ? charges[0].status : 'WAITING') };
}

// ===== Pré-venda (vouchers de combo com QR Code) =====
function serializeVoucher(row) {
  return {
    id: row.id,
    code: row.code,
    customer_name: row.customer_name,
    customer_phone: row.customer_phone || null,
    product: row.product || 'Combo',
    quantity: intValue(row.quantity),
    unit_price: numberValue(row.unit_price),
    total_value: numberValue(row.total_value),
    payment_method: row.payment_method,
    payment_method_label: PAYMENT_METHODS[row.payment_method] || row.payment_method,
    status: row.status,
    created_by: row.created_by || null,
    created_at: row.created_at,
    redeemed_by: row.redeemed_by || null,
    redeemed_at: row.redeemed_at || null
  };
}

function generateVoucherCode() {
  const arr = new Uint8Array(3);
  crypto.getRandomValues(arr);
  const n = (arr[0] << 16) | (arr[1] << 8) | arr[2];
  return 'CB-' + n.toString(36).toUpperCase().padStart(5, '0').slice(-5);
}

async function listVouchers(db) {
  const rows = await all(db, 'SELECT * FROM vouchers ORDER BY created_at DESC, id DESC');
  return rows.map(serializeVoucher);
}

async function createVoucher(request, db, user) {
  const data = await readJson(request);
  const name = String(data.customer_name || '').trim();
  if (!name) throw new HttpError(400, 'Informe o nome do comprador');
  const quantity = Math.max(1, intValue(data.quantity) || 1);
  const unitPrice = numberValue(data.unit_price);
  if (unitPrice <= 0) throw new HttpError(400, 'Preco invalido');
  const paymentMethod = normalizePaymentMethod(data.payment_method || 'dinheiro');
  const product = String(data.product || 'Combo').trim() || 'Combo';
  const phone = String(data.customer_phone || '').trim() || null;
  const total = unitPrice * quantity;

  let code = null;
  for (let i = 0; i < 12; i++) {
    const candidate = generateVoucherCode();
    const exists = await first(db, 'SELECT id FROM vouchers WHERE code = ?', candidate);
    if (!exists) { code = candidate; break; }
  }
  if (!code) throw new HttpError(500, 'Nao foi possivel gerar o codigo do voucher');

  const result = await run(db, `
    INSERT INTO vouchers (code, customer_name, customer_phone, product, quantity, unit_price, total_value, payment_method, status, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pago', ?, CURRENT_TIMESTAMP)
  `, code, name, phone, product, quantity, unitPrice, total, paymentMethod, user.username);

  // Registra o comprador na lista de clientes (se ainda nao existir)
  try {
    const existingCustomer = await first(db, 'SELECT id, phone FROM customers WHERE lower(name) = lower(?)', name);
    if (!existingCustomer) {
      await run(db, 'INSERT INTO customers (name, phone, group_name, debt) VALUES (?, ?, ?, 0)', name, phone, 'Pré-venda');
    } else if (phone && !existingCustomer.phone) {
      await run(db, 'UPDATE customers SET phone = ? WHERE id = ?', phone, existingCustomer.id);
    }
  } catch { /* nao bloqueia a criacao do voucher */ }

  return serializeVoucher(await first(db, 'SELECT * FROM vouchers WHERE id = ?', lastRowId(result)));
}

async function getVoucherByCode(db, code) {
  const row = await first(db, 'SELECT * FROM vouchers WHERE code = ?', String(code || '').trim().toUpperCase());
  if (!row) throw new HttpError(404, 'Voucher nao encontrado');
  return serializeVoucher(row);
}

async function redeemVoucher(db, id, user) {
  const row = await first(db, 'SELECT * FROM vouchers WHERE id = ?', id);
  if (!row) throw new HttpError(404, 'Voucher nao encontrado');
  if (row.status === 'retirado') throw new HttpError(409, `Ja retirado em ${row.redeemed_at || 'data desconhecida'}`);
  if (row.status === 'cancelado') throw new HttpError(409, 'Voucher cancelado');
  await run(db, `UPDATE vouchers SET status = 'retirado', redeemed_by = ?, redeemed_at = CURRENT_TIMESTAMP WHERE id = ?`, user.username, id);
  return serializeVoucher(await first(db, 'SELECT * FROM vouchers WHERE id = ?', id));
}

async function cancelVoucher(db, id) {
  const row = await first(db, 'SELECT * FROM vouchers WHERE id = ?', id);
  if (!row) throw new HttpError(404, 'Voucher nao encontrado');
  if (row.status === 'retirado') throw new HttpError(409, 'Nao da para cancelar um voucher ja retirado');
  await run(db, `UPDATE vouchers SET status = 'cancelado' WHERE id = ?`, id);
  return serializeVoucher(await first(db, 'SELECT * FROM vouchers WHERE id = ?', id));
}

async function voucherSummary(db) {
  const rows = await all(db, 'SELECT * FROM vouchers');
  let vouchersVendidos = 0, vouchersRetirados = 0, vouchersPendentes = 0;
  let combosVendidos = 0, combosRetirados = 0, combosPendentes = 0, arrecadado = 0;
  for (const r of rows) {
    if (r.status === 'cancelado') continue;
    const q = intValue(r.quantity);
    vouchersVendidos += 1;
    combosVendidos += q;
    arrecadado += numberValue(r.total_value);
    if (r.status === 'retirado') { vouchersRetirados += 1; combosRetirados += q; }
    else { vouchersPendentes += 1; combosPendentes += q; }
  }
  return {
    vouchers_vendidos: vouchersVendidos,
    vouchers_retirados: vouchersRetirados,
    vouchers_pendentes: vouchersPendentes,
    combos_vendidos: combosVendidos,
    combos_retirados: combosRetirados,
    combos_pendentes: combosPendentes,
    valor_arrecadado: arrecadado
  };
}

// ===== Registro de atividades (auditoria) =====
// Descreve a acao a partir do metodo + rota. Retorna null para rotas que nao devem ser logadas.
function describeAction(method, parts) {
  const [r, s, t] = parts;
  const M = method.toUpperCase();
  if (r === 'token' && M === 'POST') return 'Login';
  if (r === 'users' && s === 'me' && t === 'password') return 'Trocou a propria senha';
  if (r === 'sales' && t === 'cancel' && M === 'POST') return 'Cancelou venda';
  if (r === 'sales' && M === 'POST') return 'Registrou venda';
  if (r === 'products' && M === 'POST' && !s) return 'Cadastrou/abasteceu produto';
  if (r === 'products' && M === 'PUT') return 'Editou produto';
  if (r === 'products' && M === 'DELETE') return 'Excluiu produto';
  if (r === 'products' && s === 'generate-qrcode-all') return 'Gerou QR codes em massa';
  if (r === 'products' && t === 'generate-qrcode') return 'Gerou QR code de produto';
  if (r === 'products' && s === 'import-nfe') return 'Importou NF-e';
  if (r === 'customers' && M === 'POST' && !s) return 'Cadastrou cliente';
  if (r === 'customers' && t === 'pay') return 'Recebeu pagamento de fiado';
  if (r === 'payments' && t === 'cancel') return 'Estornou baixa de fiado';
  if (r === 'customers' && M === 'PUT') return 'Editou cliente';
  if (r === 'customers' && M === 'DELETE') return 'Excluiu cliente';
  if (r === 'customers' && (s === 'bulk' || s === 'import-csv')) return 'Importou clientes';
  if (r === 'vouchers' && M === 'POST' && !s) return 'Criou pre-venda';
  if (r === 'vouchers' && t === 'redeem') return 'Deu baixa em voucher';
  if (r === 'vouchers' && t === 'cancel') return 'Cancelou voucher';
  if (r === 'users' && M === 'POST') return 'Criou usuario';
  if (r === 'users' && M === 'PUT') return 'Editou usuario';
  if (r === 'users' && M === 'DELETE') return 'Excluiu usuario';
  if (r === 'category-costs' && M === 'POST') return 'Lancou custo de setor';
  if (r === 'category-costs' && M === 'DELETE') return 'Excluiu custo de setor';
  if (r === 'pix' && s === 'charge' && M === 'POST') return 'Gerou cobranca PIX';
  return null;
}

// Extrai um resumo curto e seguro da resposta (nunca inclui senha/foto)
function summarizePayload(data) {
  if (!data || typeof data !== 'object') return '';
  const bits = [];
  if (data.code) bits.push(String(data.code));
  if (data.name) bits.push(String(data.name).slice(0, 60));
  if (data.customer_name) bits.push(String(data.customer_name).slice(0, 60));
  if (data.username) bits.push(String(data.username).slice(0, 40));
  if (data.customer && data.customer.name) bits.push(String(data.customer.name).slice(0, 60));
  if (data.quantity !== undefined && data.quantity !== null) bits.push(`${data.quantity}x`);
  if (data.total_value !== undefined) bits.push(`R$ ${numberValue(data.total_value).toFixed(2)}`);
  else if (data.amount !== undefined) bits.push(`R$ ${numberValue(data.amount).toFixed(2)}`);
  if (data.payment_method_label) bits.push(String(data.payment_method_label));
  if (data.stock !== undefined && data.stock !== null && data.name) bits.push(`estoque ${intValue(data.stock)}`);
  if (data.message && bits.length === 0) bits.push(String(data.message).slice(0, 80));
  return bits.join(' · ').slice(0, 200);
}

async function writeActivityLog(db, entry) {
  try {
    await run(db, `
      INSERT INTO activity_logs (username, role, action, detail, method, path, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `, entry.username || null, entry.role || null, entry.action, entry.detail || null,
       entry.method, entry.path, entry.status);
  } catch { /* auditoria nunca deve quebrar a operacao */ }
}

async function listActivityLogs(db, url) {
  const limit = Math.min(500, Math.max(1, intValue(url.searchParams.get('limit')) || 200));
  const user = (url.searchParams.get('user') || '').trim();
  const rows = user
    ? await all(db, 'SELECT * FROM activity_logs WHERE username = ? ORDER BY id DESC LIMIT ?', user, limit)
    : await all(db, 'SELECT * FROM activity_logs ORDER BY id DESC LIMIT ?', limit);
  return rows.map((r) => ({
    id: r.id, username: r.username, role: r.role, action: r.action,
    detail: r.detail, method: r.method, path: r.path, status: r.status,
    created_at: r.created_at
  }));
}

export async function onRequest({ request, env, params }) {
  const ctx = {};
  let response;
  try {
    response = await handle(request, env, params, ctx);
  } catch (error) {
    if (error instanceof HttpError) response = json({ detail: error.detail }, error.status);
    else {
      console.error(error);
      response = json({ detail: 'Erro interno' }, 500);
    }
  }

  // Auditoria: registra apenas acoes que alteram dados (e o login), nunca leituras.
  try {
    const action = describeAction(request.method, ctx.parts || []);
    if (action && ctx.db) {
      const ok = response.status >= 200 && response.status < 300;
      let detail = '';
      if (ok) {
        try {
          const body = await response.clone().json();
          detail = summarizePayload(Array.isArray(body) ? body[0] : body);
        } catch { /* resposta sem JSON */ }
      } else {
        try {
          const body = await response.clone().json();
          detail = `FALHOU: ${String(body.detail || '').slice(0, 120)}`;
        } catch { detail = 'FALHOU'; }
      }
      const username = ctx.user?.username || ctx.loginUsername || null;
      await writeActivityLog(ctx.db, {
        username,
        role: ctx.user?.role || null,
        action: ok ? action : `${action} (falhou)`,
        detail,
        method: request.method,
        path: '/' + (ctx.path || ''),
        status: response.status
      });
    }
  } catch { /* auditoria nunca deve quebrar a resposta */ }

  return response;
}
