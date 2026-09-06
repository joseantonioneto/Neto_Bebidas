import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import axios from 'axios';
import {
  AppBar, Toolbar, Typography, Button, Container, Grid, Paper,
  Card, CardContent, CardActions, List, ListItem,
  IconButton, Select, MenuItem, FormControl, InputLabel,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Box, Snackbar, Alert, Tab, Tabs, TextField, Dialog, DialogTitle,
  DialogContent, DialogActions, Badge, Chip, Autocomplete,
  BottomNavigation, BottomNavigationAction, Fab, Drawer,
  useMediaQuery, useTheme, Divider, LinearProgress, Switch,
  FormControlLabel, CircularProgress, TablePagination, Tooltip
} from '@mui/material';

import {
  ShoppingCart, PersonAdd, Inventory, Add, Assessment,
  Logout, Storefront, Edit, Delete, Search, TrendingUp, Storage,
  AdminPanelSettings, Remove, Download, PointOfSale, QrCodeScanner,
  CameraAlt, UploadFile, Close, People, CloudUpload,
  PhotoCamera, ContentCopy, ManageSearch, QrCode2, CheckCircle, AccessTime,
  ConfirmationNumber, Share, Fastfood, ReceiptLong, Refresh, PriceCheck
} from '@mui/icons-material';

import QRCode from 'qrcode';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import { format, subDays, parseISO, isAfter } from 'date-fns';

import caminharLogo from './assets/caminhar-logo-branco.png';
import igrejaCristoRei from './assets/igreja-cristo-rei.png';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const api = axios.create({ baseURL: API_BASE });

const ROLE_LABELS = { admin: 'Administrador', vendedor: 'Vendedor' };
const FALLBACK_PAYMENT_METHODS = [
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'pix', label: 'Pix' },
  { value: 'cartao_debito', label: 'Cartão de débito' },
  { value: 'cartao_credito', label: 'Cartão de crédito' },
  { value: 'fiado', label: 'Fiado' }
];

// ==== Configuração PIX (dados da conta que RECEBE o pagamento) ====
// Preencha com a chave e os dados do recebedor. Usado para gerar o QR "Pix Copia e Cola".
const PIX_CONFIG = {
  chave: 'b951c6fb-a380-4fd6-a528-4696c158e53e',   // chave aleatória
  nome: 'Jose Antonio Souza Neto',                  // recebedor (máx. 25 caracteres, sem acento)
  cidade: 'Natal'                                   // cidade do recebedor
};
const pixConfigured = () => PIX_CONFIG.chave && PIX_CONFIG.chave !== 'SUA_CHAVE_PIX_AQUI';

// PIX automático via PagBank: só ligar quando a conta estiver liberada na whitelist de produção.
// Enquanto false, o "Cobrar via PIX" usa o QR estático com confirmação manual.
const PIX_AUTO_ENABLED = false;

// Preço padrão do combo na pré-venda (antecipado). Editável na hora de registrar.
const COMBO_PRESALE_PRICE = 30;

// Monta um campo EMV (id + tamanho + valor) do padrão BR Code
function pixField(id, value) {
  const v = String(value);
  return `${id}${v.length.toString().padStart(2, '0')}${v}`;
}
// CRC16-CCITT (polinômio 0x1021) exigido pelo BR Code
function pixCrc16(payload) {
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
// Gera o payload "Pix Copia e Cola" (estático com valor) a partir da config + valor da venda
function buildPixPayload({ chave, nome, cidade, valor, txid = '***' }) {
  const clean = (s, max) => String(s || '')
    .normalize('NFD').replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, max);
  const nomeF = clean(nome, 25) || 'RECEBEDOR';
  const cidadeF = clean(cidade, 15) || 'BRASIL';
  const mai = pixField('00', 'br.gov.bcb.pix') + pixField('01', String(chave).trim());
  let p = '';
  p += pixField('00', '01');       // Payload Format Indicator
  p += pixField('26', mai);        // Merchant Account Information - PIX
  p += pixField('52', '0000');     // Merchant Category Code
  p += pixField('53', '986');      // Moeda = BRL
  if (valor && Number(valor) > 0) p += pixField('54', Number(valor).toFixed(2));
  p += pixField('58', 'BR');       // País
  p += pixField('59', nomeF);      // Nome do recebedor
  p += pixField('60', cidadeF);    // Cidade do recebedor
  p += pixField('62', pixField('05', txid)); // Additional data - txid
  p += '6304';                     // CRC placeholder
  return p + pixCrc16(p);
}

// Redimensiona/comprime qualquer imagem para um JPEG quadrado (evita fotos de vários MB)
async function resizeImageToDataUrl(file, size = 200, quality = 0.72) {
  const dataUrl = await new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  const scale = Math.max(size / img.width, size / img.height); // cobre o quadrado
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

// Compõe um cartão de voucher (QR + infos) num único PNG, para o comprador guardar/receber
async function composeVoucherImage(voucher, qrDataUrl) {
  const W = 440, H = 600;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1a237e';
  ctx.fillRect(0, 0, W, 74);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = 'bold 24px system-ui, Arial, sans-serif';
  ctx.fillText('MERCADINHO CAMINHAR', W / 2, 36);
  ctx.font = '15px system-ui, Arial, sans-serif';
  ctx.fillText('Voucher de Pré-venda — Igreja de Cristo Rei', W / 2, 58);

  const qr = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = qrDataUrl;
  });
  const qrSize = 270;
  ctx.drawImage(qr, (W - qrSize) / 2, 96, qrSize, qrSize);

  ctx.fillStyle = '#1a237e';
  ctx.font = 'bold 32px system-ui, Arial, sans-serif';
  ctx.fillText(voucher.code, W / 2, 415);
  ctx.fillStyle = '#111111';
  ctx.font = 'bold 22px system-ui, Arial, sans-serif';
  ctx.fillText(voucher.customer_name || '', W / 2, 452);
  ctx.fillStyle = '#2e7d32';
  ctx.font = 'bold 24px system-ui, Arial, sans-serif';
  ctx.fillText(`${voucher.quantity}x ${voucher.product} · R$ ${Number(voucher.total_value || 0).toFixed(2)}`, W / 2, 492);
  ctx.fillStyle = '#666666';
  ctx.font = '16px system-ui, Arial, sans-serif';
  ctx.fillText('Apresente este QR Code na retirada', W / 2, 540);
  return canvas.toDataURL('image/png');
}

const formatCurrency = (value) => Number(value || 0).toFixed(2);

// Deixa o texto em minusculo e sem acento, para a busca achar "Stefany"
// digitando "Stefany" com ou sem acento, nos dois sentidos.
// O regex e montado por escape para nao depender do encoding deste arquivo.
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

const normalizeText = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(COMBINING_MARKS, '')
  .toLowerCase()
  .trim();

// Id unico por carrinho, usado para o servidor descartar reenvios da mesma venda
const newRequestId = () => (
  window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
);

// Formata data/hora no fuso de Brasília. O banco grava em UTC (sem indicador de fuso),
// então marcamos como UTC (Z) antes de converter para America/Sao_Paulo.
function formatDateTimeBR(value, dateOnly = false) {
  if (!value) return '';
  let s = String(value).trim();
  if (s.includes(' ') && !s.includes('T')) s = s.replace(' ', 'T');
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleString('pt-BR', dateOnly
    ? { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }
    : { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
const createSaleCode = () => `mercadinho-${Date.now()}`;
const TURNSTILE_SCRIPT_ID = 'cloudflare-turnstile-api';
const DEFAULT_SECURITY_CONFIG = { turnstile: { enabled: false, site_key: '', misconfigured: false } };

let turnstileScriptPromise = null;

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileScriptPromise) return turnstileScriptPromise;

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(TURNSTILE_SCRIPT_ID);
    const resolveWhenReady = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('Turnstile indisponível'));
    };

    if (existing) {
      existing.addEventListener('load', resolveWhenReady, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = resolveWhenReady;
    script.onerror = reject;
    document.head.appendChild(script);
  });

  return turnstileScriptPromise;
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
}, (error) => Promise.reject(error));

function TurnstileWidget({ siteKey, resetKey, onVerify, onExpire, onError }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);

  useEffect(() => {
    if (!siteKey || !containerRef.current) return undefined;
    let mounted = true;

    loadTurnstileScript()
      .then((turnstile) => {
        if (!mounted || !containerRef.current) return;
        if (widgetIdRef.current) turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action: 'login',
          theme: 'light',
          size: 'flexible',
          callback: onVerify,
          'expired-callback': onExpire,
          'timeout-callback': onExpire,
          'error-callback': onError
        });
      })
      .catch(onError);

    return () => {
      mounted = false;
      if (window.turnstile && widgetIdRef.current) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
  }, [siteKey, resetKey, onVerify, onExpire, onError]);

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', minHeight: 65, width: '100%', overflow: 'hidden' }}>
      <div ref={containerRef} />
    </Box>
  );
}

// --- SELETOR DE GRUPO (lista + botão de cadastrar novo) ---
function GroupPicker({ value, onChange, groups }) {
  const [adding, setAdding] = useState(false);
  const [novo, setNovo] = useState('');
  const options = useMemo(() => {
    const s = new Set(groups);
    if (value) s.add(value);
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [groups, value]);

  const confirmNew = () => {
    if (!novo.trim()) return;
    onChange(novo.trim());
    setAdding(false);
    setNovo('');
  };

  if (adding) {
    return (
      <Box display="flex" gap={1} alignItems="center">
        <TextField autoFocus size="small" label="Nome do novo grupo" fullWidth value={novo}
          onChange={(e) => setNovo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && confirmNew()} />
        <Button size="small" variant="contained" disabled={!novo.trim()} onClick={confirmNew}>OK</Button>
        <IconButton size="small" onClick={() => { setAdding(false); setNovo(''); }}><Close fontSize="small" /></IconButton>
      </Box>
    );
  }
  return (
    <Box display="flex" gap={1} alignItems="center">
      <FormControl fullWidth size="small">
        <InputLabel>Grupo</InputLabel>
        <Select label="Grupo" value={options.includes(value) ? value : ''} onChange={(e) => onChange(e.target.value)}>
          <MenuItem value=""><em>Sem grupo</em></MenuItem>
          {options.map((g) => <MenuItem key={g} value={g}>{g}</MenuItem>)}
        </Select>
      </FormControl>
      <Button size="small" variant="outlined" startIcon={<Add />} onClick={() => setAdding(true)} sx={{ flexShrink: 0 }}>Novo</Button>
    </Box>
  );
}

// --- SCANNER COMPONENT ---
function BarcodeScanner({ open, onClose, onScan }) {
  const html5QrCodeRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    let scanner = null;
    let stopped = false;

    // Para o scanner com segurança: o stop() pode LANÇAR erro síncrono
    // ("Cannot stop, scanner is not running or paused") — por isso o try/catch.
    const stopScanner = async () => {
      if (stopped) return;
      stopped = true;
      const s = html5QrCodeRef.current;
      html5QrCodeRef.current = null;
      if (!s) return;
      try { await s.stop(); } catch { /* já parado/parando */ }
      try { s.clear(); } catch { /* ignore */ }
    };

    const startScanner = async () => {
      const { Html5Qrcode } = await import('html5-qrcode');
      scanner = new Html5Qrcode("barcode-reader");
      html5QrCodeRef.current = scanner;

      try {
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
          (decodedText) => {
            onScan(decodedText);
            onClose();
            stopScanner();
          },
          () => {}
        );
      } catch (err) {
        console.error("Scanner error:", err);
      }
    };

    const timer = setTimeout(startScanner, 300);

    return () => {
      clearTimeout(timer);
      stopScanner();
    };
  }, [open, onScan, onClose]);

  if (!open) return null;

  return (
    <Dialog open={open} onClose={onClose} fullScreen>
      <AppBar position="static" sx={{ bgcolor: '#1a237e' }}>
        <Toolbar>
          <IconButton edge="start" color="inherit" onClick={onClose}><Close /></IconButton>
          <Typography variant="h6" sx={{ ml: 1 }}>Scanner</Typography>
        </Toolbar>
      </AppBar>
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, bgcolor: '#000', p: 2 }}>
        <div id="barcode-reader" style={{ width: '100%', maxWidth: 400 }} />
        <Typography color="white" sx={{ mt: 2 }}>Aponte a câmera para o código de barras ou QR Code</Typography>
      </Box>
    </Dialog>
  );
}

function App() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [token, setToken] = useState(localStorage.getItem('token'));
  const [currentUser, setCurrentUser] = useState(null);
  const [authForm, setAuthForm] = useState({ username: '', password: '' });
  const [securityConfig, setSecurityConfig] = useState(DEFAULT_SECURITY_CONFIG);
  const [securityConfigLoaded, setSecurityConfigLoaded] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);

  const [tabValue, setTabValue] = useState('resumo');
  const [cart, setCart] = useState([]);
  // Trava contra venda duplicada: bloqueia o botao enquanto a venda esta sendo
  // gravada e manda um id unico por carrinho para o servidor ignorar reenvios.
  const [savingSale, setSavingSale] = useState(false);
  const saleRequestIdRef = useRef(null);
  const [cancellingSaleId, setCancellingSaleId] = useState(null);
  const [products, setProducts] = useState([]);
  const [categoryCosts, setCategoryCosts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [salesHistory, setSalesHistory] = useState([]);
  // Modulo de Historico de Vendas: carrega sob demanda e paginado
  const [salesTotal, setSalesTotal] = useState(0);
  const [salesPage, setSalesPage] = useState(0);
  const [salesPerPage, setSalesPerPage] = useState(25);
  const [salesQuery, setSalesQuery] = useState('');
  const [salesStatusFilter, setSalesStatusFilter] = useState('');
  const [salesMethodFilter, setSalesMethodFilter] = useState('');
  const [loadingSales, setLoadingSales] = useState(false);
  const [users, setUsers] = useState([]);
  const [reportSummary, setReportSummary] = useState(null);
  const [paymentMethods, setPaymentMethods] = useState(FALLBACK_PAYMENT_METHODS);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('dinheiro');
  const [loginError, setLoginError] = useState('');
  // status: 'loading' | 'waiting' (aguardando pagto automatico) | 'manual' (fallback QR estatico) | 'paid' | 'expired'
  const [pixDialog, setPixDialog] = useState({ open: false, status: 'loading', valor: 0, orderId: '', qrText: '', qrImage: '', expiresAt: 0 });
  const [pixNow, setPixNow] = useState(0);
  const [stockQuery, setStockQuery] = useState('');
  const [stockCategoryFilter, setStockCategoryFilter] = useState('');
  const [estoqueQuery, setEstoqueQuery] = useState('');
  const [estoqueCategoryFilter, setEstoqueCategoryFilter] = useState('');

  // Pré-venda (vouchers)
  const [vouchers, setVouchers] = useState([]);
  const [voucherSummaryData, setVoucherSummaryData] = useState(null);
  const [openVoucherDialog, setOpenVoucherDialog] = useState(false);
  const [voucherForm, setVoucherForm] = useState({ customer_name: '', customer_phone: '', quantity: 1, unit_price: COMBO_PRESALE_PRICE, payment_method: 'dinheiro' });
  const [voucherResult, setVoucherResult] = useState({ open: false, voucher: null, qr: '' });
  const [redeemDialog, setRedeemDialog] = useState({ open: false, voucher: null });
  const [voucherCodeInput, setVoucherCodeInput] = useState('');

  const [daysFilter, setDaysFilter] = useState(7);
  const [productFilter, setProductFilter] = useState(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [searchTermProduct, setSearchTermProduct] = useState('');
  const [feedback, setFeedback] = useState({ open: false, message: '', severity: 'success' });

  const [openNewClientDialog, setOpenNewClientDialog] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientGroup, setNewClientGroup] = useState('Caminhar Cristo Rei');
  const [clientSort, setClientSort] = useState('nome'); // 'nome' | 'grupo' | 'divida'
  const [clientGroupFilter, setClientGroupFilter] = useState('');   // '' = todos, '__sem__' = sem grupo
  const [clientDebtFilter, setClientDebtFilter] = useState('todos'); // 'todos' | 'fiado' | 'quitados'
  const [customerDialog, setCustomerDialog] = useState({ open: false, id: null, name: '', phone: '', group_name: '', debt: 0, sales: [], loadingSales: false });
  const [activityLogs, setActivityLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logUserFilter, setLogUserFilter] = useState('');

  const [openProductDialog, setOpenProductDialog] = useState(false);
  const [openEditProductDialog, setOpenEditProductDialog] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: '', category: 'Geral', cost_price: '', sell_price: '', stock: '', barcode: '', photo: '' });
  const [editProductData, setEditProductData] = useState({ id: null, name: '', category: 'Geral', cost_price: '', sell_price: '', stock: '', barcode: '', photo: '' });
  const [photoUploading, setPhotoUploading] = useState(false);
  const [openCategoryCostDialog, setOpenCategoryCostDialog] = useState(false);
  const [categoryCostForm, setCategoryCostForm] = useState({ description: '', category: 'Geral', amount: '', event_day: 'Dia 1' });

  const [openPayDialog, setOpenPayDialog] = useState(false);
  const [payData, setPayData] = useState({ customerId: null, customerName: '', amount: '', debt: 0 });
  // Trava da baixa de fiado: sem isso o duplo clique descontava o valor 2x
  const [savingPayment, setSavingPayment] = useState(false);
  const payRequestIdRef = useRef(null);
  // Modulo de Baixas
  const [payments, setPayments] = useState([]);
  const [paymentsTotal, setPaymentsTotal] = useState(0);
  const [paymentsSum, setPaymentsSum] = useState(0);
  const [paymentsPage, setPaymentsPage] = useState(0);
  const [paymentsPerPage, setPaymentsPerPage] = useState(25);
  const [paymentsQuery, setPaymentsQuery] = useState('');
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [cancellingPaymentId, setCancellingPaymentId] = useState(null);

  const [openUserDialog, setOpenUserDialog] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userForm, setUserForm] = useState({ username: '', password: '', role: 'vendedor' });
  const [passwordChangeForm, setPasswordChangeForm] = useState({ newPassword: '', confirmPassword: '' });

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanTarget, setScanTarget] = useState('sale'); // 'sale' | 'newProduct' | 'editProduct'
  const [cartOpen, setCartOpen] = useState(false);
  const [qrPrintDialog, setQrPrintDialog] = useState(false);
  const [qrPrintOnlyGenerated, setQrPrintOnlyGenerated] = useState(true);

  const [importClientsDialog, setImportClientsDialog] = useState(false);
  const [importNfeDialog, setImportNfeDialog] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [nfeImportResult, setNfeImportResult] = useState(null);

  const isAdmin = currentUser?.role === 'admin';
  const turnstileEnabled = Boolean(securityConfig.turnstile?.enabled && securityConfig.turnstile?.site_key);
  const turnstileMisconfigured = Boolean(securityConfig.turnstile?.misconfigured);
  const loginBlocked = !securityConfigLoaded || turnstileMisconfigured || (turnstileEnabled && !turnstileToken);

  const showFeedback = useCallback((message, severity) => setFeedback({ open: true, message, severity }), []);

  const resetTurnstile = useCallback(() => {
    setTurnstileToken('');
    setTurnstileResetKey(prev => prev + 1);
  }, []);

  const handleTurnstileExpire = useCallback(() => {
    setTurnstileToken('');
    showFeedback('Verificacao expirada. Confirme novamente.', 'info');
  }, [showFeedback]);

  const handleTurnstileError = useCallback(() => {
    setTurnstileToken('');
    showFeedback('Nao foi possivel carregar a verificacao de seguranca', 'warning');
  }, [showFeedback]);

  useEffect(() => {
    let active = true;
    api.get('/security/config')
      .then((res) => {
        if (active) setSecurityConfig(res.data || DEFAULT_SECURITY_CONFIG);
      })
      .catch(() => {
        if (active) setSecurityConfig(DEFAULT_SECURITY_CONFIG);
      })
      .finally(() => {
        if (active) setSecurityConfigLoaded(true);
      });
    return () => { active = false; };
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const meRes = await api.get('/me');
      const userIsAdmin = meRes.data.role === 'admin';
      setCurrentUser(meRes.data);
      if (meRes.data.role === 'vendedor') {
        setTabValue(prev => prev === 'resumo' ? 'vender' : prev);
      }

      if (meRes.data.must_change_password) {
        setProducts([]);
        setCategoryCosts([]);
        setCustomers([]);
        setSalesHistory([]);
        setUsers([]);
        setReportSummary(null);
        return;
      }

      const [prodRes, custRes, methodsRes] = await Promise.all([
        api.get('/products/'),
        api.get('/customers/'),
        api.get('/payment-methods')
      ]);
      setProducts(prodRes.data);
      setCustomers(custRes.data);
      setSelectedCustomer(prev => {
        if (prev) return prev;
        const defaultCustomer = custRes.data.find(c => c.name === 'Consumidor Final');
        return defaultCustomer ? defaultCustomer.id : prev;
      });
      setPaymentMethods(methodsRes.data);

      if (userIsAdmin) {
        // Cada bloco e tratado em separado: se o resumo falhar, o resto da tela
        // continua valendo — e o erro aparece, em vez de mostrar R$ 0,00 calado.
        // O historico de vendas saiu daqui: agora tem aba propria e carrega
        // paginado, so quando aberta. O resumo tem seu proprio efeito.
        const [usersRes, categoryCostsRes] = await Promise.allSettled([
          api.get('/users/'), api.get('/category-costs/')
        ]);
        if (usersRes.status === 'fulfilled') setUsers(usersRes.value.data);
        if (categoryCostsRes.status === 'fulfilled') setCategoryCosts(categoryCostsRes.value.data);
      } else {
        setSalesHistory([]);
        setUsers([]);
        setReportSummary(null);
        setCategoryCosts([]);
      }
    } catch (error) {
      if (error.response && error.response.status === 401) {
        localStorage.removeItem('token'); setToken(null); setCurrentUser(null);
      }
    }
  }, []);

  // Resumo: consulta propria, para uma falha aqui nao derrubar o resto da tela.
  // O product_id vai junto porque o total por dia do grafico e somado no servidor.
  const fetchSummary = useCallback(async (productId) => {
    try {
      const { data } = await api.get('/reports/summary', {
        params: productId ? { product_id: productId } : {}
      });
      setReportSummary(data);
    } catch {
      showFeedback('Não consegui carregar o resumo agora. Toque em atualizar para tentar de novo.', 'warning');
    }
  }, [showFeedback]);

  // Historico de vendas paginado — so busca a pagina que esta na tela
  const fetchSalesPage = useCallback(async (opts = {}) => {
    setLoadingSales(true);
    try {
      const { data } = await api.get('/sales/', {
        params: {
          limit: opts.perPage ?? salesPerPage,
          offset: (opts.page ?? salesPage) * (opts.perPage ?? salesPerPage),
          search: opts.search ?? salesQuery,
          status: opts.status ?? salesStatusFilter,
          method: opts.method ?? salesMethodFilter
        }
      });
      setSalesHistory(data.items || []);
      setSalesTotal(data.total || 0);
    } catch {
      showFeedback('Não consegui carregar o histórico de vendas.', 'error');
    } finally {
      setLoadingSales(false);
    }
  }, [salesPerPage, salesPage, salesQuery, salesStatusFilter, salesMethodFilter, showFeedback]);

  // Baixas de fiado — carrega paginado, so com a aba aberta
  const fetchPaymentsPage = useCallback(async (opts = {}) => {
    setLoadingPayments(true);
    try {
      const { data } = await api.get('/payments', {
        params: {
          limit: opts.perPage ?? paymentsPerPage,
          offset: (opts.page ?? paymentsPage) * (opts.perPage ?? paymentsPerPage),
          search: opts.search ?? paymentsQuery
        }
      });
      setPayments(data.items || []);
      setPaymentsTotal(data.total || 0);
      setPaymentsSum(data.total_amount || 0);
    } catch {
      showFeedback('Não consegui carregar as baixas.', 'error');
    } finally {
      setLoadingPayments(false);
    }
  }, [paymentsPerPage, paymentsPage, paymentsQuery, showFeedback]);

  const addToCart = useCallback((p) => {
    if (p.stock <= 0) return showFeedback('Sem estoque!', 'warning');
    setCart(prev => {
      const existing = prev.find((item) => item.id === p.id);
      if (existing) {
        if (existing.quantity >= p.stock) {
          showFeedback('Quantidade máxima em estoque!', 'warning');
          return prev;
        }
        return prev.map((item) => item.id === p.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { ...p, quantity: 1 }];
    });
  }, [showFeedback]);

  useEffect(() => {
    if (!token) return undefined;
    const timeoutId = window.setTimeout(() => {
      fetchData();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [token, fetchData]);

  // Resumo: carrega ao abrir a aba (assim reflete as vendas mais recentes) e
  // refaz quando o filtro de produto do grafico muda
  useEffect(() => {
    if (!token || !isAdmin || tabValue !== 'resumo') return;
    fetchSummary(productFilter?.id);
  }, [token, isAdmin, tabValue, productFilter, fetchSummary]);

  // Historico de vendas: so busca com a aba aberta, e espera a digitacao parar
  useEffect(() => {
    if (!token || !isAdmin || tabValue !== 'vendas') return undefined;
    const timeoutId = window.setTimeout(() => { fetchSalesPage(); }, salesQuery ? 350 : 0);
    return () => window.clearTimeout(timeoutId);
  }, [token, isAdmin, tabValue, salesQuery, fetchSalesPage]);

  // Baixas: so busca com a aba aberta, esperando a digitacao parar
  useEffect(() => {
    if (!token || !isAdmin || tabValue !== 'baixas') return undefined;
    const timeoutId = window.setTimeout(() => { fetchPaymentsPage(); }, paymentsQuery ? 350 : 0);
    return () => window.clearTimeout(timeoutId);
  }, [token, isAdmin, tabValue, paymentsQuery, fetchPaymentsPage]);

  // Atualiza o estoque em tempo real enquanto a aba Consulta estiver aberta
  useEffect(() => {
    if (!token || tabValue !== 'consulta') return undefined;
    const intervalId = window.setInterval(() => { fetchData(); }, 20000);
    return () => window.clearInterval(intervalId);
  }, [token, tabValue, fetchData]);

  const fetchActivityLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const { data } = await api.get('/activity-logs', { params: { limit: 300 } });
      setActivityLogs(data);
    } catch { /* silencioso */ }
    setLogsLoading(false);
  }, []);

  const fetchVouchers = useCallback(async () => {
    try {
      const [listRes, sumRes] = await Promise.all([api.get('/vouchers'), api.get('/vouchers/summary')]);
      setVouchers(listRes.data);
      setVoucherSummaryData(sumRes.data);
    } catch { /* silencioso */ }
  }, []);

  // Carrega os vouchers ao abrir a aba Pré-venda
  useEffect(() => {
    if (!token || tabValue !== 'prevenda') return undefined;
    fetchVouchers();
    return undefined;
  }, [token, tabValue, fetchVouchers]);

  // Carrega o registro de atividades ao abrir a aba (somente admin)
  useEffect(() => {
    if (!token || tabValue !== 'atividade') return undefined;
    fetchActivityLogs();
    return undefined;
  }, [token, tabValue, fetchActivityLogs]);

  // PIX automático: consulta o PagBank a cada 4s e faz a contagem regressiva do QR
  useEffect(() => {
    if (!pixDialog.open || pixDialog.status !== 'waiting' || !pixDialog.orderId) return undefined;
    let active = true;
    const poll = async () => {
      try {
        const { data } = await api.get(`/pix/charge/${encodeURIComponent(pixDialog.orderId)}`);
        if (active && data.paid) setPixDialog(prev => ({ ...prev, status: 'paid' }));
      } catch { /* ignora erro transitório de rede */ }
    };
    const pollId = window.setInterval(poll, 4000);
    const tickId = window.setInterval(() => {
      setPixNow(Date.now());
      if (Date.now() > pixDialog.expiresAt) {
        setPixDialog(prev => (prev.status === 'waiting' ? { ...prev, status: 'expired' } : prev));
      }
    }, 1000);
    poll();
    return () => { active = false; window.clearInterval(pollId); window.clearInterval(tickId); };
  }, [pixDialog.open, pixDialog.status, pixDialog.orderId, pixDialog.expiresAt]);

  // Quando o pagamento é confirmado, mostra o ✓ e finaliza a venda automaticamente
  useEffect(() => {
    if (pixDialog.status !== 'paid') return undefined;
    const t = window.setTimeout(() => { finalizePixSale(pixDialog.orderId); }, 1600);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixDialog.status]);

  const handleLogin = async () => {
    if (!securityConfigLoaded) return showFeedback('Carregando verificacao de seguranca', 'info');
    if (turnstileMisconfigured) return showFeedback('Turnstile nao configurado corretamente no Cloudflare', 'error');
    if (turnstileEnabled && !turnstileToken) return showFeedback('Complete a verificacao de seguranca', 'warning');

    try {
      const formData = new URLSearchParams();
      formData.append('username', authForm.username);
      formData.append('password', authForm.password);
      if (turnstileEnabled) formData.append('cf-turnstile-response', turnstileToken);
      const response = await api.post('/token', formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      localStorage.setItem('token', response.data.access_token);
      setCurrentUser(response.data.user);
      setTabValue(response.data.user?.role === 'admin' ? 'resumo' : 'vender');
      if (response.data.user?.must_change_password) {
        showFeedback('Cadastre uma nova senha para continuar', 'info');
      }
      setToken(response.data.access_token);
    } catch (error) {
      const detail = error.response?.data?.detail;
      const status = error.response?.status;
      setLoginError(
        !error.response
          ? 'Não foi possível conectar ao servidor. Verifique a internet e tente novamente.'
          : (status === 400 || status === 401)
            ? 'Usuário ou senha incorretos. Confira os dados e tente de novo.'
            : (detail || 'Não foi possível entrar. Tente novamente.')
      );
      if (turnstileEnabled) resetTurnstile();
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token'); setToken(null); setCurrentUser(null); setCart([]);
    setPasswordChangeForm({ newPassword: '', confirmPassword: '' });
  };

  const handleRequiredPasswordChange = async () => {
    const newPassword = passwordChangeForm.newPassword.trim();
    const confirmPassword = passwordChangeForm.confirmPassword.trim();
    if (newPassword.length < 6) return showFeedback('A nova senha precisa ter pelo menos 6 caracteres', 'warning');
    if (newPassword !== confirmPassword) return showFeedback('As senhas não conferem', 'warning');

    try {
      const res = await api.post('/users/me/password', { new_password: newPassword });
      setPasswordChangeForm({ newPassword: '', confirmPassword: '' });
      setCurrentUser(res.data.user);
      showFeedback('Senha alterada. Bem-vindo!', 'success');
      fetchData();
    } catch (error) {
      showFeedback(error.response?.data?.detail || 'Erro ao alterar senha', 'error');
    }
  };

  // --- SCANNER ---
  const handleBarcodeScan = useCallback(async (code) => {
    if (scanTarget === 'newProduct') {
      setNewProduct(prev => ({ ...prev, barcode: code }));
      showFeedback(`Código lido: ${code}`, 'info');
      return;
    }
    if (scanTarget === 'editProduct') {
      setEditProductData(prev => ({ ...prev, barcode: code }));
      showFeedback(`Código lido: ${code}`, 'info');
      return;
    }
    if (scanTarget === 'voucher') {
      const c = String(code || '').trim().toUpperCase();
      try {
        const { data } = await api.get(`/vouchers/code/${encodeURIComponent(c)}`);
        setRedeemDialog({ open: true, voucher: data });
      } catch {
        showFeedback(`Voucher não encontrado: ${c}`, 'warning');
      }
      return;
    }
    try {
      const res = await api.get(`/products/barcode/${encodeURIComponent(code)}`);
      const product = res.data;
      addToCart(product);
      showFeedback(`${product.name} adicionado!`, 'success');
    } catch {
      showFeedback(`Produto não encontrado: ${code}`, 'warning');
    }
  }, [scanTarget, addToCart, showFeedback]);

  const openScanner = (target) => {
    setScanTarget(target);
    setScannerOpen(true);
  };

  // --- CALCULOS ---
  const stockMetrics = useMemo(() => {
    let totalCost = 0;
    let potentialRevenue = 0;
    products.forEach(p => {
      const stock = Math.max(p.stock, 0);
      totalCost += stock * p.cost_price;
      potentialRevenue += stock * p.sell_price;
    });
    return { totalCost, potentialProfit: potentialRevenue - totalCost };
  }, [products]);

  // O servidor ja devolve o total por dia (respeitando o filtro de produto);
  // aqui so recortamos a janela escolhida.
  const chartData = useMemo(() => {
    const cutoffDate = subDays(new Date(), daysFilter);
    return (reportSummary?.by_day || [])
      .filter((row) => isAfter(parseISO(row.date), cutoffDate))
      .map((row) => ({ day: format(parseISO(row.date), 'dd/MM'), total: row.total }));
  }, [reportSummary, daysFilter]);

  const totalSold = reportSummary?.totals?.gross_total ?? 0;
  const totalDebtCurrent = customers.reduce((acc, customer) => acc + customer.debt, 0);
  const totalCash = reportSummary?.totals?.paid_total ?? (totalSold - totalDebtCurrent);
  const reportDebt = reportSummary?.totals?.debt_total ?? totalDebtCurrent;
  const reportProfit = reportSummary?.totals?.profit_total ?? stockMetrics.potentialProfit;
  const directCostTotal = reportSummary?.totals?.direct_cost_total ?? 0;
  const categoryCostTotal = categoryCosts.reduce((sum, cost) => sum + Number(cost.amount || 0), 0);
  const indirectCostTotal = reportSummary?.totals?.indirect_cost_total ?? categoryCostTotal;
  const cartTotal = cart.reduce((sum, item) => sum + (item.sell_price * item.quantity), 0);
  const categoryOptions = [...new Set(products.map((p) => p.category || 'Geral'))].sort();

  const filteredCustomers = customers
    .filter(c => normalizeText(c.name).includes(normalizeText(searchTerm)))
    .filter(c => !clientGroupFilter
      || (clientGroupFilter === '__sem__' ? !c.group_name : c.group_name === clientGroupFilter))
    .filter(c => clientDebtFilter === 'todos'
      || (clientDebtFilter === 'fiado' ? c.debt > 0 : c.debt <= 0))
    .sort((a, b) => {
      if (clientSort === 'divida') return b.debt - a.debt || a.name.localeCompare(b.name);
      if (clientSort === 'grupo') return (a.group_name || 'zzz').localeCompare(b.group_name || 'zzz') || a.name.localeCompare(b.name);
      return a.name.localeCompare(b.name);
    });

  // Quanto a lista filtrada tem a receber — serve de meta na hora da cobranca
  const filteredDebtTotal = filteredCustomers.reduce((acc, c) => acc + Math.max(0, c.debt), 0);
  const filteredDebtCount = filteredCustomers.filter(c => c.debt > 0).length;

  // Grupos existentes (únicos) para cadastro rápido por clique
  const customerGroups = useMemo(() => {
    const set = new Set();
    customers.forEach(c => { if (c.group_name) set.add(c.group_name); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [customers]);

  // Resumo por grupo, para o seletor mostrar onde tem fiado em aberto
  const groupDebtSummary = useMemo(() => {
    const mapa = {};
    customers.forEach(c => {
      const chave = c.group_name || '__sem__';
      mapa[chave] ||= { comFiado: 0, total: 0 };
      if (c.debt > 0) {
        mapa[chave].comFiado += 1;
        mapa[chave].total += c.debt;
      }
    });
    return mapa;
  }, [customers]);
  const filteredProducts = products.filter(p => {
    const term = normalizeText(searchTermProduct);
    if (!term) return true;
    return normalizeText(p.name).includes(term) || normalizeText(p.barcode) === term;
  }).sort((a, b) => a.name.localeCompare(b.name));

  // Leitor USB no notebook: o leitor "digita" o código e envia Enter
  const handleSearchEnter = (e) => {
    if (e.key !== 'Enter') return;
    const term = searchTermProduct.trim();
    if (!term) return;
    const exact = products.find(p => (p.barcode || '').toLowerCase() === term.toLowerCase());
    if (exact) {
      addToCart(exact);
      showFeedback(`${exact.name} adicionado!`, 'success');
      setSearchTermProduct('');
    } else if (filteredProducts.length === 1) {
      addToCart(filteredProducts[0]);
      showFeedback(`${filteredProducts[0].name} adicionado!`, 'success');
      setSearchTermProduct('');
    }
  };

  // --- ACOES ---
  const updateCartQuantity = (productId, quantity) => {
    const product = products.find((p) => p.id === productId);
    const nextQuantity = Math.max(0, Math.min(parseInt(quantity || 0), product?.stock || 0));
    if (nextQuantity === 0) {
      setCart(cart.filter((item) => item.id !== productId));
      return;
    }
    setCart(cart.map((item) => item.id === productId ? { ...item, quantity: nextQuantity } : item));
  };

  const removeFromCart = (id) => setCart(cart.filter(i => i.id !== id));

  const handleFinishSale = async (isPaid) => {
    if (savingSale) return;
    if (!selectedCustomer) return showFeedback('Selecione cliente!', 'warning');
    if (cart.length === 0) return showFeedback('Carrinho vazio!', 'warning');
    const paymentMethod = isPaid ? selectedPaymentMethod : 'fiado';
    const selectedCustomerObj = customers.find(c => c.id === parseInt(selectedCustomer));
    if (paymentMethod === 'fiado' && selectedCustomerObj?.name === 'Consumidor Final') {
      return showFeedback('Fiado exige cliente identificado. Selecione ou cadastre o cliente.', 'warning');
    }
    // Mesmo carrinho = mesmo id. Se a requisicao for enviada duas vezes, o
    // servidor reconhece e devolve a venda ja gravada em vez de duplicar.
    if (!saleRequestIdRef.current) saleRequestIdRef.current = newRequestId();
    setSavingSale(true);
    try {
      const items = cart.map((p) => ({ product_id: p.id, quantity: p.quantity }));
      const { data } = await api.post('/sales/', {
        customer_id: parseInt(selectedCustomer),
        items,
        is_paid: paymentMethod !== 'fiado',
        payment_method: paymentMethod,
        payment_provider: null,
        client_request_id: saleRequestIdRef.current
      });
      if (data?.duplicate) {
        showFeedback('Esta venda já tinha sido registrada — não foi lançada de novo.', 'info');
      } else {
        showFeedback(paymentMethod === 'fiado' ? "FIADO anotado!" : "Venda registrada!", paymentMethod === 'fiado' ? 'info' : 'success');
      }
      saleRequestIdRef.current = null;
      setCart([]);
      setCartOpen(false);
      fetchData();
    } catch (error) {
      showFeedback(error.response?.data?.detail || 'Erro na venda.', 'error');
    } finally {
      setSavingSale(false);
    }
  };

  // Fallback: gera o QR estático local (confirmação manual) quando o PagBank não está disponível
  const openPixStaticFallback = async (reason) => {
    if (!pixConfigured()) {
      setPixDialog(prev => ({ ...prev, open: false }));
      return showFeedback('PIX indisponível: configure o PagBank ou a chave estática.', 'error');
    }
    const payload = buildPixPayload({ ...PIX_CONFIG, valor: cartTotal });
    const qr = await QRCode.toDataURL(payload, { width: 300, margin: 1 });
    setPixDialog({ open: true, status: 'manual', valor: cartTotal, orderId: '', qrText: payload, qrImage: qr, expiresAt: 0, note: reason || '' });
  };

  // Inicia a cobrança PIX automática via PagBank (com fallback para o QR estático)
  const startPixCharge = async () => {
    if (!selectedCustomer) return showFeedback('Selecione cliente!', 'warning');
    if (cart.length === 0) return showFeedback('Carrinho vazio!', 'warning');
    // Enquanto o PagBank não liberar a whitelist de produção, usa direto o QR manual (sem chamada que falha)
    if (!PIX_AUTO_ENABLED) return openPixStaticFallback();
    setPixDialog({ open: true, status: 'loading', valor: cartTotal, orderId: '', qrText: '', qrImage: '', expiresAt: 0 });
    try {
      const custObj = customers.find(c => c.id === parseInt(selectedCustomer));
      const { data } = await api.post('/pix/charge', {
        amount: cartTotal,
        customer_name: custObj?.name,
        reference_id: `venda-${Date.now()}`
      });
      const qr = data.qr_text ? await QRCode.toDataURL(data.qr_text, { width: 300, margin: 1 }) : (data.qr_image || '');
      setPixDialog({
        open: true,
        status: 'waiting',
        valor: cartTotal,
        orderId: data.order_id || '',
        qrText: data.qr_text || '',
        qrImage: qr,
        expiresAt: data.expiration ? new Date(data.expiration).getTime() : (Date.now() + 15 * 60 * 1000)
      });
    } catch (err) {
      // PagBank indisponível/não configurado → cai no QR estático com confirmação manual
      await openPixStaticFallback(err.response?.data?.detail || 'Falha ao falar com o PagBank');
    }
  };

  // Registra a venda de PIX confirmada (automática ou manual)
  const finalizePixSale = async (orderId) => {
    // O PIX pode ser fechado pelo timer automático e pelo botão manual ao mesmo
    // tempo — sem essa trava a venda entrava duas vezes.
    if (savingSale || cart.length === 0) return;
    if (!saleRequestIdRef.current) saleRequestIdRef.current = newRequestId();
    setSavingSale(true);
    try {
      const items = cart.map((p) => ({ product_id: p.id, quantity: p.quantity }));
      const { data } = await api.post('/sales/', {
        customer_id: parseInt(selectedCustomer),
        items,
        is_paid: true,
        payment_method: 'pix',
        payment_provider: orderId ? 'pagbank' : null,
        payment_reference: orderId || null,
        client_request_id: saleRequestIdRef.current
      });
      showFeedback(data?.duplicate ? 'Esta venda já tinha sido registrada.' : 'Pagamento PIX confirmado!', data?.duplicate ? 'info' : 'success');
      saleRequestIdRef.current = null;
      setCart([]);
      setCartOpen(false);
      setPixDialog(prev => ({ ...prev, open: false }));
      fetchData();
    } catch (error) {
      showFeedback(error.response?.data?.detail || 'Pago, mas houve erro ao registrar a venda.', 'error');
    } finally {
      setSavingSale(false);
    }
  };

  const handleCopyPix = async () => {
    try {
      await navigator.clipboard.writeText(pixDialog.qrText);
      showFeedback('Código PIX copiado!', 'success');
    } catch {
      showFeedback('Não foi possível copiar. Copie manualmente.', 'warning');
    }
  };

  // ===== Pré-venda (vouchers) =====
  const handleCreateVoucher = async () => {
    const name = voucherForm.customer_name.trim();
    if (!name) return showFeedback('Informe o nome do comprador', 'warning');
    const qty = parseInt(voucherForm.quantity || 1);
    const price = parseFloat(voucherForm.unit_price || 0);
    if (!qty || qty < 1) return showFeedback('Quantidade inválida', 'warning');
    if (!price || price <= 0) return showFeedback('Preço inválido', 'warning');
    try {
      const { data } = await api.post('/vouchers', {
        customer_name: name,
        customer_phone: voucherForm.customer_phone.trim(),
        quantity: qty,
        unit_price: price,
        payment_method: voucherForm.payment_method,
        product: 'Combo'
      });
      const qrRaw = await QRCode.toDataURL(data.code, { width: 320, margin: 1 });
      const card = await composeVoucherImage(data, qrRaw);
      setOpenVoucherDialog(false);
      setVoucherForm({ customer_name: '', customer_phone: '', quantity: 1, unit_price: COMBO_PRESALE_PRICE, payment_method: 'dinheiro' });
      setVoucherResult({ open: true, voucher: data, qr: card });
      fetchVouchers();
    } catch (error) {
      showFeedback(error.response?.data?.detail || 'Erro ao gerar voucher', 'error');
    }
  };

  const openVoucherQr = async (voucher) => {
    const qrRaw = await QRCode.toDataURL(voucher.code, { width: 320, margin: 1 });
    const card = await composeVoucherImage(voucher, qrRaw);
    setVoucherResult({ open: true, voucher, qr: card });
  };

  const handleShareVoucher = async () => {
    const v = voucherResult.voucher;
    if (!v) return;
    const msg = `Voucher ${v.code} — ${v.quantity} ${v.product}. Apresente este QR Code na retirada. Mercadinho Caminhar.`;
    try {
      const blob = await (await fetch(voucherResult.qr)).blob();
      const file = new File([blob], `voucher-${v.code}.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: msg });
        return;
      }
      if (navigator.share) { await navigator.share({ text: msg }); return; }
      await navigator.clipboard.writeText(v.code);
      showFeedback('Compartilhamento não suportado neste aparelho. Código copiado.', 'info');
    } catch { /* usuário cancelou o compartilhamento */ }
  };

  const handleRedeemLookup = async (code) => {
    const c = String(code || '').trim().toUpperCase();
    if (!c) return;
    try {
      const { data } = await api.get(`/vouchers/code/${encodeURIComponent(c)}`);
      setRedeemDialog({ open: true, voucher: data });
      setVoucherCodeInput('');
    } catch {
      showFeedback(`Voucher não encontrado: ${c}`, 'warning');
    }
  };

  const handleRedeem = async () => {
    const v = redeemDialog.voucher;
    if (!v) return;
    try {
      const { data } = await api.post(`/vouchers/${v.id}/redeem`);
      setRedeemDialog({ open: true, voucher: data });
      showFeedback('Baixa registrada!', 'success');
      fetchVouchers();
    } catch (error) {
      showFeedback(error.response?.data?.detail || 'Erro ao dar baixa', 'error');
      try {
        const { data } = await api.get(`/vouchers/code/${encodeURIComponent(v.code)}`);
        setRedeemDialog({ open: true, voucher: data });
      } catch { /* mantém o estado atual */ }
    }
  };

  const handleCancelVoucher = async (id) => {
    if (!window.confirm('Cancelar este voucher? Esta ação não pode ser desfeita.')) return;
    try {
      await api.post(`/vouchers/${id}/cancel`);
      showFeedback('Voucher cancelado', 'info');
      fetchVouchers();
    } catch (error) {
      showFeedback(error.response?.data?.detail || 'Erro ao cancelar', 'error');
    }
  };

  // Abre o modal do cliente (editar + histórico de compras)
  const openCustomerDialog = async (row) => {
    setCustomerDialog({ open: true, id: row.id, name: row.name, phone: row.phone || '', group_name: row.group_name || '', debt: row.debt, sales: [], loadingSales: true });
    try {
      const { data } = await api.get(`/customers/${row.id}/sales`);
      setCustomerDialog(prev => (prev.id === row.id ? { ...prev, sales: data, loadingSales: false } : prev));
    } catch {
      setCustomerDialog(prev => (prev.id === row.id ? { ...prev, loadingSales: false } : prev));
    }
  };

  const handleSaveCustomer = async () => {
    const { id, name, phone, group_name } = customerDialog;
    if (!name.trim()) return showFeedback('Nome obrigatório', 'warning');
    try {
      await api.put(`/customers/${id}`, { name: name.trim(), phone: phone.trim() || null, group_name: group_name.trim() || null });
      showFeedback('Cliente atualizado!', 'success');
      setCustomerDialog(prev => ({ ...prev, open: false }));
      fetchData();
    } catch (error) {
      showFeedback(error.response?.data?.detail || 'Erro ao salvar cliente', 'error');
    }
  };

  const handleExportLogs = () => {
    if (!activityLogs.length) return showFeedback('Nenhuma atividade para exportar', 'info');
    const header = ['Quando', 'Usuário', 'Perfil', 'Ação', 'Detalhe', 'Status'];
    const rows = activityLogs.map((l) => [
      formatDateTimeBR(l.created_at), l.username || '', ROLE_LABELS[l.role] || l.role || '',
      l.action, l.detail || '', l.status
    ]);
    const csv = '﻿' + [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(';'))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'atividade-usuarios.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportVouchers = () => {
    if (!vouchers.length) return showFeedback('Nenhuma pré-venda para exportar', 'info');
    const header = ['Código', 'Comprador', 'Telefone', 'Qtd', 'Preço Unit', 'Total', 'Pagamento', 'Status', 'Criado em', 'Retirado em', 'Retirado por'];
    const statusLabel = (s) => s === 'retirado' ? 'Retirado' : s === 'cancelado' ? 'Cancelado' : 'A retirar';
    const rows = vouchers.map((v) => [
      v.code, v.customer_name, v.customer_phone || '', v.quantity,
      formatCurrency(v.unit_price), formatCurrency(v.total_value),
      v.payment_method_label || v.payment_method, statusLabel(v.status),
      formatDateTimeBR(v.created_at), formatDateTimeBR(v.redeemed_at), v.redeemed_by || ''
    ]);
    const csv = '﻿' + [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(';'))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pre-venda-combos.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handlePayDebt = async () => {
    if (savingPayment) return;
    const valor = parseFloat(payData.amount);
    if (!valor || valor <= 0) return;
    if (valor > payData.debt + 0.001) {
      return showFeedback(`Valor maior que a dívida. ${payData.customerName} deve R$ ${formatCurrency(payData.debt)}.`, 'warning');
    }
    if (!payRequestIdRef.current) payRequestIdRef.current = newRequestId();
    setSavingPayment(true);
    try {
      const { data } = await api.post(`/customers/${payData.customerId}/pay/`, {
        amount: valor,
        client_request_id: payRequestIdRef.current
      });
      showFeedback(data?.duplicate ? 'Esta baixa já tinha sido registrada.' : 'Pagamento registrado!', data?.duplicate ? 'info' : 'success');
      payRequestIdRef.current = null;
      setOpenPayDialog(false);
      fetchData();
      if (tabValue === 'baixas') fetchPaymentsPage();
    } catch (error) {
      showFeedback(error.response?.data?.detail || 'Erro ao pagar.', 'error');
    } finally {
      setSavingPayment(false);
    }
  };

  const handleCancelPayment = async (pagamento) => {
    const msg = `Estornar a baixa de R$ ${formatCurrency(pagamento.amount)} de ${pagamento.customer_name}?

O valor volta para a dívida do cliente.`;
    if (!window.confirm(msg)) return;
    if (cancellingPaymentId) return;
    setCancellingPaymentId(pagamento.id);
    try {
      await api.post(`/payments/${pagamento.id}/cancel`);
      setPayments(prev => prev.filter(x => x.id !== pagamento.id));
      showFeedback('Baixa estornada — o valor voltou para a dívida.', 'success');
      fetchData();
      fetchPaymentsPage();
    } catch (error) {
      showFeedback(error.response?.data?.detail || 'Erro ao estornar baixa', 'error');
    } finally {
      setCancellingPaymentId(null);
    }
  };

  const handleCancelSale = async (sale) => {
    const itens = (sale.items || []).map((it) => `${it.quantity}x ${it.product?.name || 'item'}`).join(', ');
    const confirmMsg = `Cancelar esta venda de R$ ${formatCurrency(sale.total_value)} (${sale.customer?.name || 'Consumidor Final'})?\n\nItens: ${itens || '—'}\n\nO estoque será devolvido${!sale.is_paid ? ' e a dívida do cliente será reduzida' : ''}. Esta ação não pode ser desfeita.`;
    if (!window.confirm(confirmMsg)) return;
    if (cancellingSaleId) return;
    setCancellingSaleId(sale.id);
    try {
      await api.post(`/sales/${sale.id}/cancel`);
      // Tira a linha da lista na hora, para nao dar chance de cancelar de novo
      // enquanto os dados nao voltam do servidor.
      setSalesHistory(prev => prev.filter(s => s.id !== sale.id));
      showFeedback('Venda cancelada e estoque restaurado!', 'success');
      fetchData();
      fetchSalesPage();
      fetchSummary(productFilter?.id);
    } catch (error) {
      const detail = error.response?.data?.detail || 'Erro ao cancelar venda';
      // Se ela ja tinha sido cancelada, some com a linha do mesmo jeito
      if (error.response?.status === 404) setSalesHistory(prev => prev.filter(s => s.id !== sale.id));
      showFeedback(detail, error.response?.status === 404 ? 'info' : 'error');
    } finally {
      setCancellingSaleId(null);
    }
  };

  const handleCreateCustomer = async () => {
    if (!newClientName) return;
    await api.post('/customers/', { name: newClientName, phone: newClientPhone || null, group_name: newClientGroup || null });
    setOpenNewClientDialog(false); setNewClientName(''); setNewClientPhone(''); setNewClientGroup('Caminhar Cristo Rei'); fetchData();
  };

  const handleCreateProduct = async () => {
    if (!newProduct.name || !newProduct.sell_price) return showFeedback('Dados incompletos', 'warning');
    const stock = parseInt(newProduct.stock || 0);
    if (stock < 0) return showFeedback('Quantidade não pode ser negativa', 'warning');
    try {
      await api.post('/products/', {
        ...newProduct,
        cost_price: parseFloat(newProduct.cost_price || 0),
        sell_price: parseFloat(newProduct.sell_price),
        stock,
        barcode: newProduct.barcode || null
      });
      showFeedback('Estoque atualizado!', 'success');
      setOpenProductDialog(false);
      setNewProduct({ name: '', category: 'Geral', cost_price: '', sell_price: '', stock: '', barcode: '', photo: '' });
      fetchData();
    } catch (error) {
      showFeedback(error.response?.data?.detail || 'Erro ao salvar produto', 'error');
    }
  };

  const handleSaveEdit = async () => {
    try {
      await api.put(`/products/${editProductData.id}`, editProductData);
      setOpenEditProductDialog(false); fetchData();
    } catch (error) {
      showFeedback(error.response?.data?.detail || 'Erro ao editar produto', 'error');
    }
  };

  // Recebe a foto do produto, comprime para 200x200 (JPEG) e guarda como data URL
  const handlePhotoSelect = async (file, target) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return showFeedback('Selecione um arquivo de imagem.', 'warning');
    setPhotoUploading(true);
    try {
      const dataUrl = await resizeImageToDataUrl(file, 200, 0.72);
      if (target === 'edit') setEditProductData(prev => ({ ...prev, photo: dataUrl }));
      else setNewProduct(prev => ({ ...prev, photo: dataUrl }));
    } catch {
      showFeedback('Não foi possível processar a imagem.', 'error');
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleCreateCategoryCost = async () => {
    const amount = parseFloat(categoryCostForm.amount || 0);
    if (!categoryCostForm.description || amount <= 0) return showFeedback('Informe descrição e valor do custo', 'warning');

    try {
      await api.post('/category-costs/', {
        ...categoryCostForm,
        amount,
        category: categoryCostForm.category || 'Geral',
        event_day: categoryCostForm.event_day || 'Dia 1'
      });
      showFeedback('Custo por setor registrado!', 'success');
      setOpenCategoryCostDialog(false);
      setCategoryCostForm({ description: '', category: 'Geral', amount: '', event_day: 'Dia 1' });
      fetchData();
    } catch (error) {
      showFeedback(error.response?.data?.detail || 'Erro ao registrar custo', 'error');
    }
  };

  const handleDeleteCategoryCost = async (id) => {
    if (!window.confirm('Remover este custo do fechamento?')) return;
    try {
      await api.delete(`/category-costs/${id}`);
      showFeedback('Custo removido', 'success');
      fetchData();
    } catch (error) {
      showFeedback(error.response?.data?.detail || 'Erro ao remover custo', 'error');
    }
  };

  const handleGenerateQRAll = async () => {
    try {
      const res = await api.post('/products/generate-qrcode-all');
      showFeedback(res.data.message, 'success');
      fetchData();
    } catch {
      showFeedback('Erro ao gerar códigos', 'error');
    }
  };

  const handlePrintQrLabels = async () => {
    const list = products
      .filter(p => p.barcode && (!qrPrintOnlyGenerated || p.barcode.startsWith('MC-')))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) return showFeedback('Nenhum produto com código para imprimir. Gere os códigos primeiro.', 'warning');

    const labels = await Promise.all(list.map(async (p) => ({
      name: p.name,
      barcode: p.barcode,
      price: formatCurrency(p.sell_price),
      qr: await QRCode.toDataURL(p.barcode, { width: 220, margin: 1 })
    })));

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Etiquetas QR - Mercadinho Caminhar</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; padding: 5mm; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; }
  .label { border: 1px dashed #999; padding: 3mm; text-align: center; page-break-inside: avoid; }
  .label .name { font-size: 11px; font-weight: bold; min-height: 26px; overflow: hidden; }
  .label .price { font-size: 13px; font-weight: bold; margin: 1mm 0; }
  .label img { width: 30mm; height: 30mm; }
  .label .code { font-size: 10px; letter-spacing: 1px; }
</style>
</head>
<body>
<div class="grid">
${labels.map(l => `  <div class="label"><div class="name">${l.name.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div><div class="price">R$ ${l.price}</div><img src="${l.qr}" alt="${l.barcode}"><div class="code">${l.barcode}</div></div>`).join('\n')}
</div>
</body>
</html>`;

    // Iframe oculto: imprime sem depender de pop-up (bloqueado por padrão em tablets)
    const oldFrame = document.getElementById('qr-print-frame');
    if (oldFrame) oldFrame.remove();
    const frame = document.createElement('iframe');
    frame.id = 'qr-print-frame';
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    document.body.appendChild(frame);
    frame.srcdoc = html;
    frame.onload = () => {
      setTimeout(() => {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      }, 300);
    };
    showFeedback(`Preparando ${labels.length} etiquetas para impressão...`, 'info');
    setQrPrintDialog(false);
  };

  const handleGenerateQR = async (productId) => {
    try {
      const res = await api.post(`/products/generate-qrcode/${productId}`);
      showFeedback(res.data.generated ? `QR gerado: ${res.data.barcode}` : `Já possui: ${res.data.barcode}`, 'success');
      fetchData();
    } catch {
      showFeedback('Erro ao gerar QR', 'error');
    }
  };

  const openCreateUserDialog = () => {
    setEditingUser(null);
    setUserForm({ username: '', password: '', role: 'vendedor' });
    setOpenUserDialog(true);
  };

  const openEditUserDialog = (user) => {
    setEditingUser(user);
    setUserForm({ username: user.username, password: '', role: user.role });
    setOpenUserDialog(true);
  };

  const handleSaveUser = async () => {
    if (!userForm.username || (!editingUser && !userForm.password)) {
      return showFeedback('Informe usuário e senha', 'warning');
    }
    try {
      if (editingUser) {
        const payload = { username: userForm.username, role: userForm.role };
        if (userForm.password) payload.password = userForm.password;
        await api.put(`/users/${editingUser.id}`, payload);
        showFeedback('Usuário atualizado!', 'success');
      } else {
        await api.post('/users/', userForm);
        showFeedback('Usuário criado!', 'success');
      }
      setOpenUserDialog(false);
      fetchData();
    } catch (error) {
      showFeedback(error.response?.data?.detail || 'Erro ao salvar usuário', 'error');
    }
  };

  const handleDeleteUser = async (user) => {
    if (user.id === currentUser?.id) return showFeedback('Você não pode excluir seu próprio usuário', 'warning');
    if (!window.confirm(`Excluir o usuário ${user.username}?`)) return;
    try {
      await api.delete(`/users/${user.id}`);
      showFeedback('Usuário excluído!', 'success');
      fetchData();
    } catch (error) {
      showFeedback(error.response?.data?.detail || 'Erro ao excluir usuário', 'error');
    }
  };

  // --- IMPORT CLIENTES CSV ---
  const handleImportClientsCsv = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImportLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post('/customers/import-csv', formData);
      setImportResult(res.data);
      showFeedback(res.data.message, 'success');
      fetchData();
    } catch (error) {
      showFeedback(error.response?.data?.detail || 'Erro ao importar', 'error');
    }
    setImportLoading(false);
  };

  // --- IMPORT NF-e XML ---
  const handleImportNfe = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImportLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post('/products/import-nfe', formData);
      setNfeImportResult(res.data);
      showFeedback(res.data.message, 'success');
      fetchData();
    } catch (error) {
      showFeedback(error.response?.data?.detail || 'Erro ao importar NF-e', 'error');
    }
    setImportLoading(false);
  };

  const handleExportReportCsv = () => {
    if (!reportSummary) return;
    const rows = [
      ['Métrica', 'Valor'],
      ['Total vendido', reportSummary.totals.gross_total],
      ['Recebido', reportSummary.totals.paid_total],
      ['Fiado', reportSummary.totals.debt_total],
      ['Custo produtos', reportSummary.totals.direct_cost_total],
      ['Custo setores', reportSummary.totals.indirect_cost_total],
      ['Custo total', reportSummary.totals.cost_total],
      ['Lucro estimado', reportSummary.totals.profit_total],
      [],
      ['Setor de custo', 'Lançamentos', 'Total'],
      ...(reportSummary.by_category_cost || []).map((row) => [row.category, row.count, row.total]),
      [],
      ['Forma de pagamento', 'Vendas', 'Total'],
      ...reportSummary.by_payment_method.map((row) => [row.label, row.count, row.total]),
      [],
      ['Vendedor', 'Vendas', 'Total'],
      ...(reportSummary.by_seller || []).map((row) => [row.seller, row.count, row.total]),
      [],
      ['Produto', 'Categoria', 'Quantidade', 'Total', 'Custo'],
      ...reportSummary.top_products.map((row) => [row.name, row.category, row.quantity, row.total, row.cost])
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'fechamento-mercadinho-caminhar.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleProductSelect = (event, value) => {
    if (value) {
      const existing = products.find(p => p.name === value);
      if (existing) {
        setNewProduct({ ...newProduct, name: existing.name, category: existing.category || 'Geral', sell_price: existing.sell_price, cost_price: '', stock: '', barcode: existing.barcode || '' });
      } else {
        setNewProduct({ ...newProduct, name: value });
      }
    }
  };

  const handleScanForProduct = () => openScanner('sale');

  // --- TELA DE LOGIN ---
  if (!token) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh" bgcolor="#f5f5f5">
        <Paper elevation={6} sx={{ p: 5, width: 380, maxWidth: '95vw', textAlign: 'center', borderRadius: 4 }}>
          <Box sx={{ mb: 2, display: 'flex', justifyContent: 'center' }}>
            <Box component="img" src={igrejaCristoRei} alt="Igreja de Cristo Rei" sx={{ width: 180, maxWidth: '100%', height: 'auto' }} />
          </Box>
          <Typography variant="h4" fontWeight="900" color="#1a237e">MERCADINHO CAMINHAR</Typography>
          <Typography variant="caption" color="text.secondary">Igreja de Cristo Rei</Typography>
          <Box component="form" sx={{ mt: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField label="Usuário" fullWidth onChange={(e) => setAuthForm({ ...authForm, username: e.target.value })} />
            <TextField label="Senha" type="password" fullWidth onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && handleLogin()} />
            {!securityConfigLoaded && <LinearProgress />}
            {turnstileMisconfigured && (
              <Alert severity="error" variant="outlined" sx={{ textAlign: 'left' }}>
                Turnstile precisa de chave publica e chave secreta.
              </Alert>
            )}
            {turnstileEnabled && (
              <TurnstileWidget
                siteKey={securityConfig.turnstile.site_key}
                resetKey={turnstileResetKey}
                onVerify={setTurnstileToken}
                onExpire={handleTurnstileExpire}
                onError={handleTurnstileError}
              />
            )}
            <Button variant="contained" size="large" onClick={handleLogin} disabled={loginBlocked} sx={{ bgcolor: '#1a237e', py: 1.5 }}>ENTRAR</Button>
          </Box>
        </Paper>
        <Dialog open={!!loginError} onClose={() => setLoginError('')} maxWidth="xs" fullWidth>
          <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: '#c62828' }}>
            <Close sx={{ bgcolor: '#c62828', color: '#fff', borderRadius: '50%', fontSize: 26, p: 0.3 }} />
            Não foi possível entrar
          </DialogTitle>
          <DialogContent>
            <Typography>{loginError}</Typography>
          </DialogContent>
          <DialogActions>
            <Button variant="contained" onClick={() => setLoginError('')} sx={{ bgcolor: '#1a237e' }}>Tentar novamente</Button>
          </DialogActions>
        </Dialog>
        <Snackbar open={feedback.open} autoHideDuration={4000} onClose={() => setFeedback({ ...feedback, open: false })}><Alert severity={feedback.severity}>{feedback.message}</Alert></Snackbar>
      </Box>
    );
  }

  if (!currentUser) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh" bgcolor="#f5f5f5">
        <Paper elevation={3} sx={{ p: 4, textAlign: 'center', borderRadius: 3 }}>
          <Storefront sx={{ fontSize: 44, color: '#1a237e', mb: 1 }} />
          <Typography fontWeight="bold" color="#1a237e">Carregando...</Typography>
          <LinearProgress sx={{ mt: 2 }} />
        </Paper>
      </Box>
    );
  }

  if (currentUser.must_change_password) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh" bgcolor="#f0f2f5" p={2}>
        <Paper elevation={3} sx={{ p: 4, width: '100%', maxWidth: 430, borderRadius: 3 }}>
          <Box textAlign="center" mb={3}>
            <Storefront sx={{ fontSize: 44, color: '#1a237e', mb: 1 }} />
            <Typography variant="h5" fontWeight="900" color="#1a237e">Nova senha obrigatória</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Olá, {currentUser.username}. Cadastre sua senha definitiva para continuar.
            </Typography>
          </Box>
          <Box display="flex" flexDirection="column" gap={2}>
            <TextField
              label="Nova senha"
              type="password"
              fullWidth
              value={passwordChangeForm.newPassword}
              onChange={(e) => setPasswordChangeForm({ ...passwordChangeForm, newPassword: e.target.value })}
              autoFocus
            />
            <TextField
              label="Confirmar nova senha"
              type="password"
              fullWidth
              value={passwordChangeForm.confirmPassword}
              onChange={(e) => setPasswordChangeForm({ ...passwordChangeForm, confirmPassword: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && handleRequiredPasswordChange()}
            />
            <Button variant="contained" size="large" onClick={handleRequiredPasswordChange} sx={{ bgcolor: '#1a237e', py: 1.3 }}>
              Salvar nova senha
            </Button>
            <Button color="inherit" onClick={handleLogout}>Sair</Button>
          </Box>
        </Paper>
        <Snackbar open={feedback.open} autoHideDuration={4000} onClose={() => setFeedback({ ...feedback, open: false })} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
          <Alert severity={feedback.severity} variant="filled">{feedback.message}</Alert>
        </Snackbar>
      </Box>
    );
  }

  // --- CARRINHO MOBILE (DRAWER) ---
  const renderCartContent = () => (
    <Box sx={{ p: 2, width: isMobile ? '100vw' : 'auto', maxWidth: 400 }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
        <Typography variant="h6"><ShoppingCart /> Carrinho ({cart.length})</Typography>
        {isMobile && (
          <IconButton color="primary" onClick={handleScanForProduct} sx={{ bgcolor: '#e8eaf6' }} title="Bipar mais um produto">
            <QrCodeScanner />
          </IconButton>
        )}
      </Box>
      <Autocomplete options={customers} getOptionLabel={(o) => o.name} value={customers.find(c => c.id === selectedCustomer) || null} isOptionEqualToValue={(o, v) => o.id === v.id} onChange={(e, v) => setSelectedCustomer(v ? v.id : '')} renderInput={(params) => <TextField {...params} label="Cliente" size="small" />} sx={{ mb: 2 }} />
      <FormControl size="small" fullWidth sx={{ mb: 2 }}>
        <InputLabel>Pagamento</InputLabel>
        <Select label="Pagamento" value={selectedPaymentMethod} onChange={(e) => setSelectedPaymentMethod(e.target.value)}>
          {paymentMethods.map((method) => <MenuItem key={method.value} value={method.value}>{method.label}</MenuItem>)}
        </Select>
      </FormControl>
      <List dense sx={{ maxHeight: isMobile ? '40vh' : 260, overflow: 'auto', bgcolor: '#fafafa', mb: 2, p: 0 }}>
        {cart.map((item) => (
          <ListItem key={item.id} disableGutters sx={{ display: 'block', px: 1, py: 1.25, borderBottom: '1px solid #e0e0e0', '&:last-child': { borderBottom: 0 } }}>
            <Box display="flex" alignItems="flex-start" justifyContent="space-between" gap={1}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" fontWeight="bold" noWrap>{item.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {item.quantity} x R$ {formatCurrency(item.sell_price)} = R$ {formatCurrency(item.quantity * item.sell_price)}
                </Typography>
              </Box>
              <IconButton size="small" onClick={() => removeFromCart(item.id)} color="error"><Delete fontSize="small" /></IconButton>
            </Box>
            <Box display="flex" alignItems="center" justifyContent="flex-end" gap={1} mt={1}>
              <IconButton size="small" onClick={() => updateCartQuantity(item.id, item.quantity - 1)}><Remove fontSize="small" /></IconButton>
              <Typography variant="body2" fontWeight="bold" align="center" sx={{ width: 32 }}>{item.quantity}</Typography>
              <IconButton size="small" onClick={() => updateCartQuantity(item.id, item.quantity + 1)}><Add fontSize="small" /></IconButton>
            </Box>
          </ListItem>
        ))}
        {cart.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>Carrinho vazio</Typography>}
      </List>
      <Typography variant="h5" align="right" sx={{ fontWeight: 'bold', mb: 2 }}>Total: R$ {formatCurrency(cartTotal)}</Typography>
      <Button
        fullWidth
        variant="contained"
        color={selectedPaymentMethod === 'fiado' ? 'warning' : 'success'}
        startIcon={savingSale ? <CircularProgress size={18} color="inherit" /> : (selectedPaymentMethod === 'pix' ? <QrCode2 /> : null)}
        onClick={() => selectedPaymentMethod === 'pix' ? startPixCharge() : handleFinishSale(selectedPaymentMethod !== 'fiado')}
        disabled={cart.length === 0 || savingSale}
      >
        {savingSale
          ? 'Registrando...'
          : selectedPaymentMethod === 'fiado' ? 'Anotar Fiado' : selectedPaymentMethod === 'pix' ? 'Cobrar via PIX' : 'Finalizar Venda'}
      </Button>
    </Box>
  );

  return (
    <Box sx={{ flexGrow: 1, bgcolor: '#f0f2f5', minHeight: '100vh', pb: isMobile ? 10 : 5 }}>
      <AppBar position="static" sx={{ bgcolor: '#1a237e' }}>
        <Toolbar>
          <Box component="img" src={caminharLogo} alt="Caminhar - Paróquia de Cristo Rei" sx={{ height: isMobile ? 32 : 40, width: 'auto', mr: 1.5 }} />
          <Typography variant={isMobile ? "body1" : "h6"} sx={{ flexGrow: 1, fontWeight: 'bold' }}>
            {isMobile ? 'CAMINHAR' : 'MERCADINHO CAMINHAR'}
          </Typography>
          <Chip label={ROLE_LABELS[currentUser.role]} size="small" sx={{ mr: 1, bgcolor: 'rgba(255,255,255,0.18)', color: '#fff' }} />
          <IconButton color="inherit" onClick={handleLogout}><Logout /></IconButton>
        </Toolbar>
        {!isMobile && (
          <Tabs value={tabValue} onChange={(e, v) => setTabValue(v)} textColor="inherit" indicatorColor="secondary" centered>
            {isAdmin && <Tab value="resumo" label="Resumo" icon={<Assessment />} />}
            <Tab value="vender" label="Vender" icon={<ShoppingCart />} />
            <Tab value="prevenda" label="Pré-venda" icon={<ConfirmationNumber />} />
            <Tab value="consulta" label="Consulta" icon={<ManageSearch />} />
            <Tab value="clientes" label="Clientes" icon={<People />} />
            <Tab value="estoque" label="Estoque" icon={<Inventory />} />
            {isAdmin && <Tab value="vendas" label="Vendas" icon={<ReceiptLong />} />}
            {isAdmin && <Tab value="baixas" label="Baixas" icon={<PriceCheck />} />}
            {isAdmin && <Tab value="usuarios" label="Usuários" icon={<AdminPanelSettings />} />}
            {isAdmin && <Tab value="atividade" label="Atividade" icon={<Storage />} />}
          </Tabs>
        )}
      </AppBar>

      <Container maxWidth="xl" sx={{ mt: isMobile ? 2 : 4 }}>

        {/* === ABA RESUMO === */}
        {isAdmin && tabValue === 'resumo' && (
          <Grid container spacing={isMobile ? 2 : 3}>
            <Grid size={{ xs: 6, md: 3 }}><Paper sx={{ p: 2, borderLeft: '5px solid #2196f3' }}><Typography variant="caption" color="text.secondary">Total Vendido</Typography><Typography variant={isMobile ? "h6" : "h5"} fontWeight="bold">R$ {formatCurrency(totalSold)}</Typography></Paper></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Paper sx={{ p: 2, borderLeft: '5px solid #4caf50' }}><Typography variant="caption" color="text.secondary">Recebido</Typography><Typography variant={isMobile ? "h6" : "h5"} fontWeight="bold" color="success.main">R$ {formatCurrency(totalCash)}</Typography></Paper></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Paper sx={{ p: 2, borderLeft: '5px solid #ff9800' }}><Typography variant="caption" color="text.secondary">Fiado</Typography><Typography variant={isMobile ? "h6" : "h5"} fontWeight="bold">R$ {formatCurrency(reportDebt)}</Typography></Paper></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Paper sx={{ p: 2, borderLeft: '5px solid #9c27b0' }}><Typography variant="caption" color="text.secondary">Lucro Estimado</Typography><Typography variant={isMobile ? "h6" : "h5"} fontWeight="bold" color="secondary">R$ {formatCurrency(reportProfit)}</Typography></Paper></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Paper sx={{ p: 2, borderLeft: '5px solid #607d8b' }}><Typography variant="caption" color="text.secondary">Custo Produtos</Typography><Typography variant={isMobile ? "h6" : "h5"} fontWeight="bold">R$ {formatCurrency(directCostTotal)}</Typography></Paper></Grid>
            <Grid size={{ xs: 6, md: 3 }}><Paper sx={{ p: 2, borderLeft: '5px solid #795548' }}><Typography variant="caption" color="text.secondary">Custo Setores</Typography><Typography variant={isMobile ? "h6" : "h5"} fontWeight="bold">R$ {formatCurrency(indirectCostTotal)}</Typography></Paper></Grid>

            <Grid size={12}>
              <Paper sx={{ p: isMobile ? 2 : 3, height: isMobile ? 300 : 400, display: 'flex', flexDirection: 'column' }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} flexWrap="wrap" gap={1}>
                  <Typography variant="h6">Vendas por Período</Typography>
                  <Box display="flex" gap={1} flexWrap="wrap">
                    {!isMobile && <Autocomplete options={products} getOptionLabel={(p) => p.name} value={productFilter} onChange={(e, v) => setProductFilter(v)} renderInput={(params) => <TextField {...params} label="Filtrar Produto" size="small" sx={{ width: 200 }} />} size="small" />}
                    <FormControl size="small">
                      <Select value={daysFilter} onChange={(e) => setDaysFilter(e.target.value)}>
                        <MenuItem value={7}>7d</MenuItem>
                        <MenuItem value={15}>15d</MenuItem>
                        <MenuItem value={30}>30d</MenuItem>
                      </Select>
                    </FormControl>
                  </Box>
                </Box>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis prefix="R$ " />
                    <RechartsTooltip formatter={(value) => `R$ ${formatCurrency(value)}`} />
                    <Legend />
                    <Bar dataKey="total" name={productFilter ? productFilter.name : "Vendas Totais"} fill="#1a237e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Paper>
            </Grid>

            <Grid size={{ xs: 12, md: 5 }}>
              <Paper sx={{ p: 2, height: '100%' }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                  <Typography variant="h6">Fechamento por Pagamento</Typography>
                  <Button size="small" variant="outlined" startIcon={<Download />} onClick={handleExportReportCsv}>CSV</Button>
                </Box>
                <Table size="small">
                  <TableHead><TableRow><TableCell>Forma</TableCell><TableCell align="center">Vendas</TableCell><TableCell align="right">Total</TableCell></TableRow></TableHead>
                  <TableBody>
                    {(reportSummary?.by_payment_method || []).map((row) => (
                      <TableRow key={row.payment_method}><TableCell>{row.label}</TableCell><TableCell align="center">{row.count}</TableCell><TableCell align="right">R$ {formatCurrency(row.total)}</TableCell></TableRow>
                    ))}
                    {!reportSummary?.by_payment_method?.length && <TableRow><TableCell colSpan={3} align="center">Sem vendas</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </Paper>
            </Grid>

            <Grid size={{ xs: 12, md: 7 }}>
              <Paper sx={{ p: 2, height: '100%' }}>
                <Typography variant="h6" gutterBottom>Produtos Vendidos</Typography>
                <TableContainer sx={{ maxHeight: 260 }}>
                  <Table stickyHeader size="small">
                    <TableHead><TableRow><TableCell>Produto</TableCell><TableCell>Cat.</TableCell><TableCell align="center">Qtd</TableCell><TableCell align="right">Total</TableCell></TableRow></TableHead>
                    <TableBody>
                      {(reportSummary?.top_products || []).map((row) => (
                        <TableRow key={row.product_id}><TableCell>{row.name}</TableCell><TableCell>{row.category}</TableCell><TableCell align="center">{row.quantity}</TableCell><TableCell align="right">R$ {formatCurrency(row.total)}</TableCell></TableRow>
                      ))}
                      {!reportSummary?.top_products?.length && <TableRow><TableCell colSpan={4} align="center">Sem vendas</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            </Grid>

            {reportSummary?.by_seller?.length > 0 && (
              <Grid size={{ xs: 12, md: 5 }}>
                <Paper sx={{ p: 2 }}>
                  <Typography variant="h6" gutterBottom>Vendas por Vendedor</Typography>
                  <Table size="small">
                    <TableHead><TableRow><TableCell>Vendedor</TableCell><TableCell align="center">Vendas</TableCell><TableCell align="right">Total</TableCell></TableRow></TableHead>
                    <TableBody>
                      {reportSummary.by_seller.map((row) => (
                        <TableRow key={row.seller}><TableCell>{row.seller}</TableCell><TableCell align="center">{row.count}</TableCell><TableCell align="right">R$ {formatCurrency(row.total)}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Paper>
              </Grid>
            )}

            {reportSummary?.by_category_cost?.length > 0 && (
              <Grid size={{ xs: 12, md: 5 }}>
                <Paper sx={{ p: 2 }}>
                  <Typography variant="h6" gutterBottom>Custos por Setor</Typography>
                  <Table size="small">
                    <TableHead><TableRow><TableCell>Setor</TableCell><TableCell align="center">Lanç.</TableCell><TableCell align="right">Total</TableCell></TableRow></TableHead>
                    <TableBody>
                      {reportSummary.by_category_cost.map((row) => (
                        <TableRow key={row.category}><TableCell>{row.category}</TableCell><TableCell align="center">{row.count}</TableCell><TableCell align="right">R$ {formatCurrency(row.total)}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Paper>
              </Grid>
            )}

          </Grid>
        )}

        {/* === ABA VENDAS (historico — somente admin) === */}
        {tabValue === 'vendas' && isAdmin && (
          <Container maxWidth="lg" sx={{ px: isMobile ? 0 : 2 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} gap={1} flexWrap="wrap">
              <Typography variant="h5">Histórico de Vendas</Typography>
              <Button size="small" startIcon={<Refresh />} onClick={() => fetchSalesPage()} disabled={loadingSales}>
                Atualizar
              </Button>
            </Box>

            <Paper sx={{ p: 2, mb: 2 }}>
              <Grid container spacing={2} alignItems="center">
                <Grid size={{ xs: 12, md: 5 }}>
                  <TextField
                    fullWidth size="small" label="Buscar cliente ou vendedor"
                    placeholder="Funciona com ou sem acento"
                    value={salesQuery}
                    onChange={(e) => { setSalesQuery(e.target.value); setSalesPage(0); }}
                    InputProps={{ startAdornment: <Search fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> }}
                  />
                </Grid>
                <Grid size={{ xs: 6, md: 3 }}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Status</InputLabel>
                    <Select label="Status" value={salesStatusFilter}
                      onChange={(e) => { setSalesStatusFilter(e.target.value); setSalesPage(0); }}>
                      <MenuItem value="">Todos</MenuItem>
                      <MenuItem value="pago">Pagos</MenuItem>
                      <MenuItem value="fiado">Fiado</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid size={{ xs: 6, md: 4 }}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Pagamento</InputLabel>
                    <Select label="Pagamento" value={salesMethodFilter}
                      onChange={(e) => { setSalesMethodFilter(e.target.value); setSalesPage(0); }}>
                      <MenuItem value="">Todas as formas</MenuItem>
                      {paymentMethods.map((m) => (
                        <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
            </Paper>

            <Paper>
              {loadingSales && <LinearProgress />}
              <TableContainer sx={{ maxHeight: isMobile ? 420 : 560 }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Data</TableCell>
                      <TableCell>Cliente</TableCell>
                      {!isMobile && <TableCell>Vendedor</TableCell>}
                      {!isMobile && <TableCell>Itens</TableCell>}
                      <TableCell align="right">Valor</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="center">Ação</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {salesHistory.map((sale) => {
                      const itens = (sale.items || []).map((it) => `${it.quantity}x ${it.product?.name || 'item'}`).join(', ');
                      return (
                        <TableRow key={sale.id} hover>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTimeBR(sale.created_at)}</TableCell>
                          <TableCell>{sale.customer?.name || '---'}</TableCell>
                          {!isMobile && <TableCell>{sale.seller_username || '---'}</TableCell>}
                          {!isMobile && (
                            <TableCell sx={{ maxWidth: 260 }}>
                              <Tooltip title={itens || ''}>
                                <Typography variant="body2" noWrap>{itens || '—'}</Typography>
                              </Tooltip>
                            </TableCell>
                          )}
                          <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>R$ {formatCurrency(sale.total_value)}</TableCell>
                          <TableCell>
                            <Chip
                              label={sale.payment_method_label || (sale.is_paid ? 'PAGO' : 'FIADO')}
                              color={sale.is_paid ? 'success' : 'warning'}
                              size="small" variant="outlined"
                            />
                          </TableCell>
                          <TableCell align="center">
                            <IconButton size="small" color="error" title="Cancelar venda (devolve o estoque)"
                              disabled={cancellingSaleId === sale.id}
                              onClick={() => handleCancelSale(sale)}>
                              <Delete fontSize="small" />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!loadingSales && salesHistory.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={isMobile ? 5 : 7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                          Nenhuma venda encontrada com esses filtros.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              <TablePagination
                component="div"
                count={salesTotal}
                page={salesPage}
                onPageChange={(e, novaPagina) => setSalesPage(novaPagina)}
                rowsPerPage={salesPerPage}
                onRowsPerPageChange={(e) => { setSalesPerPage(parseInt(e.target.value, 10)); setSalesPage(0); }}
                rowsPerPageOptions={[25, 50, 100]}
                labelRowsPerPage="Por página"
                labelDisplayedRows={({ from, to, count }) => `${from}-${to} de ${count}`}
              />
            </Paper>
          </Container>
        )}

        {/* === ABA BAIXAS (pagamentos de fiado — somente admin) === */}
        {tabValue === 'baixas' && isAdmin && (
          <Container maxWidth="lg" sx={{ px: isMobile ? 0 : 2 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} gap={1} flexWrap="wrap">
              <Typography variant="h5">Baixas de Fiado</Typography>
              <Button size="small" startIcon={<Refresh />} onClick={() => fetchPaymentsPage()} disabled={loadingPayments}>
                Atualizar
              </Button>
            </Box>

            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid size={{ xs: 6, md: 3 }}>
                <Paper sx={{ p: 2, borderLeft: '5px solid #4caf50' }}>
                  <Typography variant="caption" color="text.secondary">Total recebido</Typography>
                  <Typography variant={isMobile ? 'h6' : 'h5'} fontWeight="bold" color="success.main">
                    R$ {formatCurrency(paymentsSum)}
                  </Typography>
                </Paper>
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <Paper sx={{ p: 2, borderLeft: '5px solid #2196f3' }}>
                  <Typography variant="caption" color="text.secondary">Baixas registradas</Typography>
                  <Typography variant={isMobile ? 'h6' : 'h5'} fontWeight="bold">{paymentsTotal}</Typography>
                </Paper>
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <TextField
                  fullWidth size="small" label="Buscar cliente ou quem recebeu"
                  placeholder="Funciona com ou sem acento"
                  value={paymentsQuery}
                  onChange={(e) => { setPaymentsQuery(e.target.value); setPaymentsPage(0); }}
                  InputProps={{ startAdornment: <Search fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> }}
                  sx={{ mt: { xs: 0, md: 1 } }}
                />
              </Grid>
            </Grid>

            <Paper>
              {loadingPayments && <LinearProgress />}
              <TableContainer sx={{ maxHeight: isMobile ? 420 : 560 }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Data</TableCell>
                      <TableCell>Cliente</TableCell>
                      <TableCell align="right">Valor pago</TableCell>
                      {!isMobile && <TableCell align="right">Ainda deve</TableCell>}
                      {!isMobile && <TableCell>Recebido por</TableCell>}
                      <TableCell align="center">Ação</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {payments.map((pg) => (
                      <TableRow key={pg.id} hover>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTimeBR(pg.created_at)}</TableCell>
                        <TableCell>{pg.customer_name || '---'}</TableCell>
                        <TableCell align="right" sx={{ whiteSpace: 'nowrap', color: 'success.main', fontWeight: 600 }}>
                          R$ {formatCurrency(pg.amount)}
                        </TableCell>
                        {!isMobile && (
                          <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                            {pg.customer_debt > 0
                              ? <Typography variant="body2" color="warning.main">R$ {formatCurrency(pg.customer_debt)}</Typography>
                              : <Chip label="Quitado" color="success" size="small" variant="outlined" />}
                          </TableCell>
                        )}
                        {!isMobile && <TableCell>{pg.username || '---'}</TableCell>}
                        <TableCell align="center">
                          <IconButton size="small" color="error" title="Estornar baixa (devolve o valor para a dívida)"
                            disabled={cancellingPaymentId === pg.id}
                            onClick={() => handleCancelPayment(pg)}>
                            <Delete fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!loadingPayments && payments.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={isMobile ? 4 : 6} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                          Nenhuma baixa registrada ainda.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              <TablePagination
                component="div"
                count={paymentsTotal}
                page={paymentsPage}
                onPageChange={(e, novaPagina) => setPaymentsPage(novaPagina)}
                rowsPerPage={paymentsPerPage}
                onRowsPerPageChange={(e) => { setPaymentsPerPage(parseInt(e.target.value, 10)); setPaymentsPage(0); }}
                rowsPerPageOptions={[25, 50, 100]}
                labelRowsPerPage="Por página"
                labelDisplayedRows={({ from, to, count }) => `${from}-${to} de ${count}`}
              />
            </Paper>
          </Container>
        )}

        {/* === ABA ATIVIDADE (auditoria — somente admin) === */}
        {tabValue === 'atividade' && isAdmin && (
          <Container maxWidth="lg" sx={{ px: isMobile ? 0 : 2 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} gap={1} flexWrap="wrap">
              <Typography variant="h5">Atividade dos Usuários</Typography>
              <Box display="flex" gap={1} flexWrap="wrap">
                <Button variant="outlined" size={isMobile ? 'small' : 'medium'} startIcon={<Download />} onClick={handleExportLogs}>Exportar</Button>
                <Button variant="contained" size={isMobile ? 'small' : 'medium'} startIcon={<Storage />} onClick={fetchActivityLogs}>Atualizar</Button>
              </Box>
            </Box>

            {(() => {
              const usuarios = Array.from(new Set(activityLogs.map(l => l.username).filter(Boolean))).sort();
              const lista = logUserFilter ? activityLogs.filter(l => l.username === logUserFilter) : activityLogs;
              return (
                <>
                  <Box display="flex" alignItems="center" gap={0.75} flexWrap="wrap" mb={2}>
                    <Typography variant="caption" color="text.secondary">Usuário:</Typography>
                    <Chip label="Todos" size="small" clickable color={!logUserFilter ? 'primary' : 'default'} onClick={() => setLogUserFilter('')} />
                    {usuarios.map(u => (
                      <Chip key={u} label={u} size="small" clickable color={logUserFilter === u ? 'primary' : 'default'} onClick={() => setLogUserFilter(u)} />
                    ))}
                  </Box>

                  {logsLoading && <LinearProgress sx={{ mb: 1 }} />}
                  <Typography variant="caption" color="text.secondary">{lista.length} registros (mais recentes primeiro)</Typography>

                  <TableContainer component={Paper} sx={{ mt: 0.5, maxHeight: '65vh' }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>Quando</TableCell>
                          <TableCell>Usuário</TableCell>
                          <TableCell>Ação</TableCell>
                          {!isMobile && <TableCell>Detalhe</TableCell>}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {lista.map((l) => {
                          const falhou = l.status >= 400;
                          return (
                            <TableRow key={l.id} sx={falhou ? { bgcolor: '#ffebee' } : undefined}>
                              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                <Typography variant="caption">{formatDateTimeBR(l.created_at)}</Typography>
                              </TableCell>
                              <TableCell>
                                <Typography variant="body2" fontWeight="bold">{l.username || '—'}</Typography>
                                {l.role && <Typography variant="caption" color="text.secondary">{ROLE_LABELS[l.role] || l.role}</Typography>}
                              </TableCell>
                              <TableCell>
                                <Typography variant="body2" color={falhou ? 'error' : 'inherit'}>{l.action}</Typography>
                                {isMobile && l.detail && <Typography variant="caption" color="text.secondary" display="block">{l.detail}</Typography>}
                              </TableCell>
                              {!isMobile && <TableCell><Typography variant="caption" color="text.secondary">{l.detail || '—'}</Typography></TableCell>}
                            </TableRow>
                          );
                        })}
                        {!lista.length && !logsLoading && (
                          <TableRow><TableCell colSpan={isMobile ? 3 : 4} align="center" sx={{ py: 4 }}>Nenhuma atividade registrada ainda.</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </>
              );
            })()}
          </Container>
        )}

        {/* === ABA PRÉ-VENDA (vouchers de combo com QR) === */}
        {tabValue === 'prevenda' && (
          <Container maxWidth="lg" sx={{ px: isMobile ? 0 : 2 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} gap={1} flexWrap="wrap">
              <Typography variant="h5">Pré-venda de Combos</Typography>
              <Box display="flex" gap={1} flexWrap="wrap">
                <Button variant="outlined" startIcon={<Download />} onClick={handleExportVouchers} size={isMobile ? 'small' : 'medium'}>
                  Exportar Excel
                </Button>
                <Button variant="contained" color="success" startIcon={<QrCodeScanner />} onClick={() => openScanner('voucher')} size={isMobile ? 'small' : 'medium'}>
                  Retirar (escanear)
                </Button>
                <Button variant="contained" startIcon={<Add />} onClick={() => { setVoucherForm({ customer_name: '', customer_phone: '', quantity: 1, unit_price: COMBO_PRESALE_PRICE, payment_method: 'dinheiro' }); setOpenVoucherDialog(true); }} size={isMobile ? 'small' : 'medium'}>
                  Nova pré-venda
                </Button>
              </Box>
            </Box>

            {voucherSummaryData && (
              <Grid container spacing={1} sx={{ mb: 2 }}>
                <Grid size={{ xs: 6, sm: 3 }}><Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center' }}><Typography variant="h5" fontWeight="900" color="#1a237e">{voucherSummaryData.combos_vendidos}</Typography><Typography variant="caption" color="text.secondary">combos vendidos</Typography></Paper></Grid>
                <Grid size={{ xs: 6, sm: 3 }}><Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center' }}><Typography variant="h5" fontWeight="900" color="#ef6c00">{voucherSummaryData.combos_pendentes}</Typography><Typography variant="caption" color="text.secondary">a retirar</Typography></Paper></Grid>
                <Grid size={{ xs: 6, sm: 3 }}><Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center' }}><Typography variant="h5" fontWeight="900" color="#2e7d32">{voucherSummaryData.combos_retirados}</Typography><Typography variant="caption" color="text.secondary">retirados</Typography></Paper></Grid>
                <Grid size={{ xs: 6, sm: 3 }}><Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center' }}><Typography variant="h6" fontWeight="900" color="#2e7d32">R$ {formatCurrency(voucherSummaryData.valor_arrecadado)}</Typography><Typography variant="caption" color="text.secondary">arrecadado</Typography></Paper></Grid>
              </Grid>
            )}

            <Paper sx={{ p: 1.5, mb: 2 }}>
              <Box display="flex" gap={1} alignItems="center">
                <TextField fullWidth size="small" placeholder="Digitar código do voucher (ex: CB-XXXX)" value={voucherCodeInput} onChange={(e) => setVoucherCodeInput(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && handleRedeemLookup(voucherCodeInput)} />
                <Button variant="outlined" onClick={() => handleRedeemLookup(voucherCodeInput)} disabled={!voucherCodeInput.trim()}>Buscar</Button>
              </Box>
            </Paper>

            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead sx={{ bgcolor: '#eee' }}>
                  <TableRow>
                    <TableCell>Código</TableCell>
                    <TableCell>Comprador</TableCell>
                    <TableCell align="center">Qtd</TableCell>
                    {!isMobile && <TableCell align="right">Total</TableCell>}
                    <TableCell align="center">Status</TableCell>
                    <TableCell align="center">Ações</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {vouchers.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell><Typography variant="body2" fontWeight="bold">{v.code}</Typography></TableCell>
                      <TableCell>
                        {v.customer_name}
                        {isMobile && <Typography variant="caption" display="block" color="text.secondary">{v.quantity}x · R$ {formatCurrency(v.total_value)}</Typography>}
                      </TableCell>
                      <TableCell align="center">{v.quantity}</TableCell>
                      {!isMobile && <TableCell align="right">R$ {formatCurrency(v.total_value)}</TableCell>}
                      <TableCell align="center">
                        <Chip
                          size="small"
                          label={v.status === 'retirado' ? 'Retirado' : v.status === 'cancelado' ? 'Cancelado' : 'A retirar'}
                          color={v.status === 'retirado' ? 'success' : v.status === 'cancelado' ? 'default' : 'warning'}
                          variant={v.status === 'pago' ? 'outlined' : 'filled'}
                        />
                      </TableCell>
                      <TableCell align="center">
                        <IconButton size="small" color="primary" onClick={() => openVoucherQr(v)} title="Ver/enviar QR"><QrCode2 /></IconButton>
                        {isAdmin && v.status !== 'retirado' && v.status !== 'cancelado' && (
                          <IconButton size="small" color="error" onClick={() => handleCancelVoucher(v.id)} title="Cancelar"><Delete /></IconButton>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!vouchers.length && <TableRow><TableCell colSpan={isMobile ? 5 : 6} align="center" sx={{ py: 3 }}>Nenhuma pré-venda registrada ainda.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </TableContainer>
          </Container>
        )}

        {/* === ABA CONSULTA (estoque em tempo real, todos os perfis) === */}
        {tabValue === 'consulta' && (
          <Container maxWidth="lg" sx={{ px: isMobile ? 0 : 2 }}>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2} gap={1} flexWrap="wrap">
              <Typography variant="h5">Consulta de Estoque</Typography>
              <Button variant="outlined" size="small" startIcon={<ManageSearch />} onClick={fetchData}>Atualizar</Button>
            </Box>
            <TextField
              fullWidth
              placeholder="Buscar produto..."
              value={stockQuery}
              onChange={(e) => setStockQuery(e.target.value)}
              sx={{ mb: 2 }}
              InputProps={{ startAdornment: <Search sx={{ mr: 1, color: 'action.active' }} /> }}
            />
            {(() => {
              const term = normalizeText(stockQuery);
              const categorias = Array.from(new Set(products.map((p) => p.category || 'Geral'))).sort((a, b) => a.localeCompare(b));
              const list = [...products]
                .filter((p) => !stockCategoryFilter || (p.category || 'Geral') === stockCategoryFilter)
                .filter((p) => !term || normalizeText(p.name).includes(term) || normalizeText(p.category).includes(term) || normalizeText(p.barcode).includes(term))
                .sort((a, b) => a.name.localeCompare(b.name));
              const totalUnidades = list.reduce((s, p) => s + (p.stock || 0), 0);
              return (
                <>
                  <Box display="flex" alignItems="center" gap={0.75} flexWrap="wrap" mb={1.5}>
                    <Typography variant="caption" color="text.secondary">Categoria:</Typography>
                    <Chip label="Todas" size="small" clickable color={!stockCategoryFilter ? 'primary' : 'default'} onClick={() => setStockCategoryFilter('')} />
                    {categorias.map((c) => (
                      <Chip key={c} label={c} size="small" clickable color={stockCategoryFilter === c ? 'primary' : 'default'} onClick={() => setStockCategoryFilter(c)} />
                    ))}
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {list.length} {list.length === 1 ? 'produto' : 'produtos'} · {totalUnidades} unidades no total
                  </Typography>
                  <Grid container spacing={1} sx={{ mt: 0.5 }}>
                    {list.map((p) => {
                      const out = p.stock <= 0;
                      const low = !out && p.stock < 5;
                      const color = out ? '#c62828' : low ? '#ef6c00' : '#2e7d32';
                      return (
                        <Grid size={{ xs: 12, sm: 6, md: 4 }} key={p.id}>
                          <Paper variant="outlined" sx={{ p: 1.25, display: 'flex', alignItems: 'center', gap: 1.5, borderLeft: `5px solid ${color}` }}>
                            {p.photo
                              ? <Box component="img" src={p.photo} alt={p.name} sx={{ width: 48, height: 48, borderRadius: 1, objectFit: 'cover', flexShrink: 0 }} />
                              : <Box sx={{ width: 48, height: 48, borderRadius: 1, bgcolor: '#eceff1', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Storefront sx={{ color: '#b0bec5' }} /></Box>}
                            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                              <Typography variant="body2" fontWeight="bold" noWrap>{p.name}</Typography>
                              <Typography variant="caption" color="text.secondary" noWrap display="block">{p.category || 'Geral'}</Typography>
                            </Box>
                            <Box sx={{ textAlign: 'center', flexShrink: 0, minWidth: 56 }}>
                              <Typography variant="h5" fontWeight="900" sx={{ color, lineHeight: 1 }}>{p.stock}</Typography>
                              <Typography variant="caption" sx={{ color }}>{out ? 'esgotado' : 'em estoque'}</Typography>
                            </Box>
                          </Paper>
                        </Grid>
                      );
                    })}
                    {!list.length && <Grid size={12}><Typography align="center" color="text.secondary" sx={{ py: 4 }}>Nenhum produto encontrado.</Typography></Grid>}
                  </Grid>
                </>
              );
            })()}
          </Container>
        )}

        {/* === ABA VENDAS === */}
        {tabValue === 'vender' && (
          <Grid container spacing={isMobile ? 2 : 3}>
            <Grid size={{ xs: 12, md: 8 }}>
              <Paper sx={{ p: 2, mb: 2 }}>
                <Box display="flex" gap={1} alignItems="center">
                  <TextField fullWidth variant="standard" placeholder="Buscar produto ou bipar código..." value={searchTermProduct} onChange={(e) => setSearchTermProduct(e.target.value)} onKeyDown={handleSearchEnter} InputProps={{ startAdornment: <Search sx={{ mr: 1, color: 'action.active' }} /> }} />
                  <IconButton color="primary" onClick={handleScanForProduct} sx={{ bgcolor: '#e8eaf6', '&:hover': { bgcolor: '#c5cae9' } }}>
                    <QrCodeScanner />
                  </IconButton>
                </Box>
              </Paper>
              <Grid container spacing={isMobile ? 1 : 2}>
                {filteredProducts.map((p) => (
                  <Grid size={{ xs: 6, sm: 4, md: 3 }} key={p.id}>
                    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', opacity: p.stock > 0 ? 1 : 0.5 }}>
                      {p.photo && <Box component="img" src={p.photo} alt={p.name} sx={{ width: '100%', height: isMobile ? 90 : 120, objectFit: 'cover' }} />}
                      <CardContent sx={{ flexGrow: 1, p: isMobile ? 1 : 1.5 }}>
                        <Typography fontWeight="bold" noWrap variant={isMobile ? "body2" : "body1"}>{p.name}</Typography>
                        <Typography variant="caption" color="text.secondary">{p.category} | Est: {p.stock}</Typography>
                        <Typography variant={isMobile ? "body1" : "h6"} color="primary" fontWeight="bold">R$ {formatCurrency(p.sell_price)}</Typography>
                      </CardContent>
                      <CardActions sx={{ p: isMobile ? 0.5 : 1 }}>
                        <Button fullWidth variant="contained" disabled={p.stock <= 0} onClick={() => addToCart(p)} size="small">
                          {isMobile ? <Add /> : 'Vender'}
                        </Button>
                      </CardActions>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </Grid>

            {/* Desktop: carrinho fixo na lateral */}
            {!isMobile && (
              <Grid size={{ xs: 12, md: 4 }}>
                <Paper sx={{ p: 2, position: 'sticky', top: 16, maxHeight: 'calc(100vh - 32px)', overflowY: 'auto' }}>
                  {renderCartContent()}
                </Paper>
              </Grid>
            )}
          </Grid>
        )}

        {/* === ABA CLIENTES === */}
        {tabValue === 'clientes' && (
          <Container maxWidth="md">
            <Box display="flex" justifyContent="space-between" mb={3} flexWrap="wrap" gap={1}>
              <Typography variant="h5">Clientes</Typography>
              <Box display="flex" gap={1}>
                {isAdmin && (
                  <Button variant="outlined" onClick={() => setImportClientsDialog(true)} startIcon={<CloudUpload />} size={isMobile ? "small" : "medium"}>
                    Importar
                  </Button>
                )}
                <Button variant="contained" onClick={() => setOpenNewClientDialog(true)} startIcon={<PersonAdd />} size={isMobile ? "small" : "medium"}>
                  Novo
                </Button>
              </Box>
            </Box>
            <Paper sx={{ p: 2, mb: 2 }}>
              <TextField fullWidth variant="standard" placeholder="Pesquisar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} InputProps={{ startAdornment: <Search sx={{ mr: 1, color: 'action.active' }} /> }} />

              <Grid container spacing={2} sx={{ mt: 0.5 }}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Grupo</InputLabel>
                    <Select label="Grupo" value={clientGroupFilter} onChange={(e) => setClientGroupFilter(e.target.value)}>
                      <MenuItem value="">Todos os grupos</MenuItem>
                      {customerGroups.map((g) => {
                        const resumo = groupDebtSummary[g];
                        return (
                          <MenuItem key={g} value={g}>
                            {g}{resumo?.comFiado ? ` — ${resumo.comFiado} com fiado (R$ ${formatCurrency(resumo.total)})` : ''}
                          </MenuItem>
                        );
                      })}
                      <MenuItem value="__sem__">Sem grupo</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Box display="flex" alignItems="center" gap={1} flexWrap="wrap" sx={{ height: '100%' }}>
                    <Typography variant="caption" color="text.secondary">Mostrar:</Typography>
                    <Chip label="Todos" size="small" color={clientDebtFilter === 'todos' ? 'primary' : 'default'} onClick={() => setClientDebtFilter('todos')} />
                    <Chip label="Só com fiado" size="small" color={clientDebtFilter === 'fiado' ? 'warning' : 'default'} onClick={() => setClientDebtFilter('fiado')} />
                    <Chip label="Quitados" size="small" color={clientDebtFilter === 'quitados' ? 'success' : 'default'} onClick={() => setClientDebtFilter('quitados')} />
                  </Box>
                </Grid>
              </Grid>

              <Box display="flex" alignItems="center" gap={1} mt={1.5} flexWrap="wrap">
                <Typography variant="caption" color="text.secondary">Ordenar por:</Typography>
                <Chip label="Nome" size="small" color={clientSort === 'nome' ? 'primary' : 'default'} onClick={() => setClientSort('nome')} />
                <Chip label="Grupo" size="small" color={clientSort === 'grupo' ? 'primary' : 'default'} onClick={() => setClientSort('grupo')} />
                <Chip label="Maior dívida" size="small" color={clientSort === 'divida' ? 'primary' : 'default'} onClick={() => setClientSort('divida')} />
                {(clientGroupFilter || clientDebtFilter !== 'todos' || searchTerm) && (
                  <Button size="small" onClick={() => { setClientGroupFilter(''); setClientDebtFilter('todos'); setSearchTerm(''); }}>
                    Limpar filtros
                  </Button>
                )}
              </Box>
            </Paper>

            {filteredDebtCount > 0 && (
              <Paper sx={{ p: 2, mb: 2, borderLeft: '5px solid #ff9800' }}>
                <Typography variant="caption" color="text.secondary">
                  A receber{clientGroupFilter && clientGroupFilter !== '__sem__' ? ` — ${clientGroupFilter}` : ''}
                </Typography>
                <Typography variant={isMobile ? 'h6' : 'h5'} fontWeight="bold" color="warning.main">
                  R$ {formatCurrency(filteredDebtTotal)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {filteredDebtCount} {filteredDebtCount === 1 ? 'pessoa com fiado' : 'pessoas com fiado'}
                </Typography>
              </Paper>
            )}
            <TableContainer component={Paper}>
              <Table size={isMobile ? "small" : "medium"}>
                <TableHead sx={{ bgcolor: '#eee' }}>
                  <TableRow>
                    <TableCell>Nome</TableCell>
                    {!isMobile && <TableCell>Grupo</TableCell>}
                    <TableCell align="right">Dívida</TableCell>
                    <TableCell align="center">Ação</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredCustomers.map((row) => (
                    <TableRow key={row.id} hover>
                      <TableCell onClick={() => openCustomerDialog(row)} sx={{ cursor: 'pointer' }}>
                        <Typography variant="body2" color="primary" fontWeight="bold" component="span">{row.name}</Typography>
                        {isMobile && row.group_name && <Typography variant="caption" display="block" color="text.secondary">{row.group_name}</Typography>}
                      </TableCell>
                      {!isMobile && <TableCell>{row.group_name || '—'}</TableCell>}
                      <TableCell align="right" sx={{ fontWeight: 'bold', color: row.debt > 0 ? 'red' : 'green' }}>R$ {formatCurrency(row.debt)}</TableCell>
                      <TableCell align="center">
                        {row.debt > 0 ? (
                          <Button size="small" variant="outlined" color="success" onClick={() => { payRequestIdRef.current = newRequestId(); setPayData({ customerId: row.id, customerName: row.name, amount: '', debt: row.debt }); setOpenPayDialog(true); }}>Pagar</Button>
                        ) : (
                          <Chip label="OK" color="success" size="small" />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              {filteredCustomers.length} {filteredCustomers.length === 1 ? 'cliente' : 'clientes'}
              {filteredCustomers.length !== customers.length && ` (de ${customers.length})`}
            </Typography>
          </Container>
        )}

        {/* === ABA ESTOQUE === */}
        {tabValue === 'estoque' && (
          <Container maxWidth="lg">
            <Box display="flex" justifyContent="space-between" mb={3} flexWrap="wrap" gap={1}>
              <Typography variant="h5">Estoque</Typography>
              <Box display="flex" gap={1} flexWrap="wrap">
                {isAdmin && (
                  <Button variant="outlined" color="warning" onClick={() => setOpenCategoryCostDialog(true)} startIcon={<Storage />} size={isMobile ? "small" : "medium"}>
                    Custos
                  </Button>
                )}
                {isAdmin && (
                  <Button variant="outlined" color="secondary" onClick={() => setQrPrintDialog(true)} startIcon={<QrCodeScanner />} size={isMobile ? "small" : "medium"}>
                    Etiquetas QR
                  </Button>
                )}
                {isAdmin && (
                  <Button variant="outlined" onClick={() => setImportNfeDialog(true)} startIcon={<UploadFile />} size={isMobile ? "small" : "medium"}>
                    Importar NF-e
                  </Button>
                )}
                <Button variant="contained" onClick={() => setOpenProductDialog(true)} startIcon={<Add />} size={isMobile ? "small" : "medium"}>
                  Adicionar
                </Button>
              </Box>
            </Box>
            {isAdmin && (
              <Paper sx={{ p: 2, mb: 2 }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1} gap={1} flexWrap="wrap">
                  <Typography variant="h6">Custos por Setor</Typography>
                  <Chip label={`Total: R$ ${formatCurrency(categoryCostTotal)}`} color="warning" variant="outlined" />
                </Box>
                <TableContainer sx={{ maxHeight: 220 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>Descrição</TableCell>
                        <TableCell>Setor</TableCell>
                        <TableCell align="right">Valor</TableCell>
                        {!isMobile && <TableCell>Data</TableCell>}
                        <TableCell align="center">Ação</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {categoryCosts.map((cost) => (
                        <TableRow key={cost.id}>
                          <TableCell>{cost.description}</TableCell>
                          <TableCell><Chip label={cost.category || 'Geral'} size="small" /></TableCell>
                          <TableCell align="right">R$ {formatCurrency(cost.amount)}</TableCell>
                          {!isMobile && <TableCell>{formatDateTimeBR(cost.created_at, true)}</TableCell>}
                          <TableCell align="center">
                            <IconButton size="small" color="error" onClick={() => handleDeleteCategoryCost(cost.id)}><Delete /></IconButton>
                          </TableCell>
                        </TableRow>
                      ))}
                      {!categoryCosts.length && <TableRow><TableCell colSpan={isMobile ? 4 : 5} align="center">Sem custos lançados</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            )}
            <Paper sx={{ p: 2, mb: 2 }}>
              <TextField
                fullWidth
                variant="standard"
                placeholder="Buscar produto, categoria ou código..."
                value={estoqueQuery}
                onChange={(e) => setEstoqueQuery(e.target.value)}
                InputProps={{ startAdornment: <Search sx={{ mr: 1, color: 'action.active' }} /> }}
              />
              {(() => {
                const categorias = Array.from(new Set(products.map((p) => p.category || 'Geral'))).sort((a, b) => a.localeCompare(b));
                return (
                  <Box display="flex" alignItems="center" gap={0.75} flexWrap="wrap" sx={{ mt: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">Categoria:</Typography>
                    <Chip label="Todas" size="small" clickable color={!estoqueCategoryFilter ? 'primary' : 'default'} onClick={() => setEstoqueCategoryFilter('')} />
                    {categorias.map((c) => (
                      <Chip key={c} label={c} size="small" clickable color={estoqueCategoryFilter === c ? 'primary' : 'default'} onClick={() => setEstoqueCategoryFilter(c)} />
                    ))}
                  </Box>
                );
              })()}
            </Paper>
            {(() => {
              const term = normalizeText(estoqueQuery);
              const filteredEstoque = products
                .filter((p) => !estoqueCategoryFilter || (p.category || 'Geral') === estoqueCategoryFilter)
                .filter((p) => !term || normalizeText(p.name).includes(term) || normalizeText(p.category).includes(term) || normalizeText(p.barcode).includes(term));
              return (
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead sx={{ bgcolor: '#eee' }}>
                  <TableRow>
                    <TableCell>Produto</TableCell>
                    {!isMobile && <TableCell>Categoria</TableCell>}
                    {!isMobile && <TableCell>Código</TableCell>}
                    <TableCell align="right">Custo</TableCell>
                    <TableCell align="right">Venda</TableCell>
                    <TableCell align="center">Qtd</TableCell>
                    {isAdmin && <TableCell align="center">Ações</TableCell>}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredEstoque.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        {p.name}
                        {isMobile && <Typography variant="caption" display="block" color="text.secondary">{p.category} {p.barcode ? `| ${p.barcode}` : ''}</Typography>}
                      </TableCell>
                      {!isMobile && <TableCell>{p.category || 'Geral'}</TableCell>}
                      {!isMobile && <TableCell><Typography variant="caption">{p.barcode || '—'}</Typography></TableCell>}
                      <TableCell align="right">{formatCurrency(p.cost_price)}</TableCell>
                      <TableCell align="right">{formatCurrency(p.sell_price)}</TableCell>
                      <TableCell align="center"><Badge color={p.stock < 5 ? "error" : "primary"} badgeContent={p.stock} showZero><Inventory color="action" /></Badge></TableCell>
                      {isAdmin && (
                        <TableCell align="center">
                          <IconButton size="small" onClick={() => { setEditProductData({ ...p, category: p.category || 'Geral', barcode: p.barcode || '' }); setOpenEditProductDialog(true); }}><Edit /></IconButton>
                          {!p.barcode && <IconButton size="small" color="secondary" onClick={() => handleGenerateQR(p.id)} title="Gerar QR Code"><QrCodeScanner /></IconButton>}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  {!filteredEstoque.length && (
                    <TableRow><TableCell colSpan={isMobile ? (isAdmin ? 4 : 3) : (isAdmin ? 7 : 6)} align="center" sx={{ py: 3 }}>Nenhum produto encontrado.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
              );
            })()}
          </Container>
        )}

        {/* === ABA USUARIOS === */}
        {isAdmin && tabValue === 'usuarios' && (
          <Container maxWidth="md">
            <Box display="flex" justifyContent="space-between" mb={3}>
              <Typography variant="h5">Usuários do Sistema</Typography>
              <Button variant="contained" onClick={openCreateUserDialog} startIcon={<AdminPanelSettings />}>Novo</Button>
            </Box>
            <TableContainer component={Paper}>
              <Table>
                <TableHead sx={{ bgcolor: '#eee' }}><TableRow><TableCell>Usuário</TableCell><TableCell>Perfil</TableCell><TableCell align="center">Ações</TableCell></TableRow></TableHead>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <Box display="flex" alignItems="center" gap={1}>
                          {user.username}
                          {user.id === currentUser.id && <Chip label="Você" size="small" />}
                          {user.must_change_password && <Chip label="Trocar senha" size="small" color="warning" />}
                        </Box>
                      </TableCell>
                      <TableCell><Chip label={ROLE_LABELS[user.role] || user.role} color={user.role === 'admin' ? 'primary' : 'default'} size="small" /></TableCell>
                      <TableCell align="center">
                        <IconButton size="small" onClick={() => openEditUserDialog(user)}><Edit /></IconButton>
                        <IconButton size="small" color="error" disabled={user.id === currentUser.id} onClick={() => handleDeleteUser(user)}><Delete /></IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Container>
        )}
      </Container>

      {/* --- MOBILE: Bottom Nav + FABs --- */}
      {isMobile && (
        <>
          <BottomNavigation
            value={tabValue}
            onChange={(e, v) => setTabValue(v)}
            showLabels
            sx={{
              position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1200, borderTop: '1px solid #ddd',
              overflowX: 'auto', justifyContent: 'flex-start',
              '&::-webkit-scrollbar': { display: 'none' }, scrollbarWidth: 'none',
              '& .MuiBottomNavigationAction-root': { minWidth: 68, flexShrink: 0, px: 0.5 },
              '& .MuiBottomNavigationAction-label': { fontSize: '0.68rem', whiteSpace: 'nowrap' }
            }}
          >
            {isAdmin && <BottomNavigationAction label="Resumo" value="resumo" icon={<Assessment />} />}
            <BottomNavigationAction label="Vender" value="vender" icon={<ShoppingCart />} />
            <BottomNavigationAction label="Pré-venda" value="prevenda" icon={<ConfirmationNumber />} />
            <BottomNavigationAction label="Consulta" value="consulta" icon={<ManageSearch />} />
            <BottomNavigationAction label="Clientes" value="clientes" icon={<People />} />
            <BottomNavigationAction label="Estoque" value="estoque" icon={<Inventory />} />
            {isAdmin && <BottomNavigationAction label="Vendas" value="vendas" icon={<ReceiptLong />} />}
            {isAdmin && <BottomNavigationAction label="Baixas" value="baixas" icon={<PriceCheck />} />}
            {isAdmin && <BottomNavigationAction label="Usuários" value="usuarios" icon={<AdminPanelSettings />} />}
            {isAdmin && <BottomNavigationAction label="Atividade" value="atividade" icon={<Storage />} />}
          </BottomNavigation>

          {tabValue === 'vender' && !cartOpen && (
            <>
              <Fab color="primary" sx={{ position: 'fixed', bottom: 70, right: 16, zIndex: 1300 }} onClick={() => setCartOpen(true)}>
                <Badge badgeContent={cart.length} color="error"><ShoppingCart /></Badge>
              </Fab>
              <Fab color="secondary" sx={{ position: 'fixed', bottom: 70, left: 16, zIndex: 1300 }} onClick={handleScanForProduct}>
                <QrCodeScanner />
              </Fab>
            </>
          )}

          <Drawer anchor="bottom" open={cartOpen} onClose={() => setCartOpen(false)} PaperProps={{ sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '90vh' } }}>
            {renderCartContent()}
          </Drawer>
        </>
      )}

      {/* --- SCANNER --- */}
      <BarcodeScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onScan={handleBarcodeScan} />

      {/* --- MODAIS --- */}

      {/* Novo Cliente */}
      <Dialog open={openNewClientDialog} onClose={() => setOpenNewClientDialog(false)} fullWidth maxWidth="sm">
        <DialogTitle>Novo Cliente</DialogTitle>
        <DialogContent sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField autoFocus label="Nome" fullWidth value={newClientName} onChange={(e) => setNewClientName(e.target.value)} />
          <TextField label="Telefone" fullWidth value={newClientPhone} onChange={(e) => setNewClientPhone(e.target.value)} />
          <GroupPicker value={newClientGroup} onChange={setNewClientGroup} groups={customerGroups} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenNewClientDialog(false)}>Cancelar</Button>
          <Button onClick={handleCreateCustomer} variant="contained">Salvar</Button>
        </DialogActions>
      </Dialog>

      {/* Editar Cliente + histórico de compras */}
      <Dialog open={customerDialog.open} onClose={() => setCustomerDialog(prev => ({ ...prev, open: false }))} fullWidth maxWidth="sm">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          Cliente
          {customerDialog.debt > 0
            ? <Chip label={`Deve R$ ${formatCurrency(customerDialog.debt)}`} color="error" size="small" />
            : <Chip label="Sem dívida" color="success" size="small" variant="outlined" />}
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <TextField margin="dense" label="Nome" fullWidth value={customerDialog.name} onChange={(e) => setCustomerDialog(prev => ({ ...prev, name: e.target.value }))} />
          <TextField margin="dense" label="Telefone" fullWidth value={customerDialog.phone} onChange={(e) => setCustomerDialog(prev => ({ ...prev, phone: e.target.value }))} sx={{ mt: 1 }} />
          <Box sx={{ mt: 1.5 }}>
            <GroupPicker value={customerDialog.group_name} onChange={(g) => setCustomerDialog(prev => ({ ...prev, group_name: g }))} groups={customerGroups} />
          </Box>

          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" gutterBottom>Compras {customerDialog.loadingSales ? '(carregando...)' : `(${customerDialog.sales.length})`}</Typography>
          {customerDialog.loadingSales && <LinearProgress />}
          {!customerDialog.loadingSales && customerDialog.sales.length === 0 && (
            <Typography variant="body2" color="text.secondary">Nenhuma compra registrada.</Typography>
          )}
          {!customerDialog.loadingSales && customerDialog.sales.length > 0 && (
            <List dense sx={{ maxHeight: 240, overflowY: 'auto', bgcolor: '#fafafa', borderRadius: 1, p: 0 }}>
              {customerDialog.sales.map((s) => (
                <ListItem key={s.id} sx={{ display: 'block', borderBottom: '1px solid #eee', py: 1 }}>
                  <Box display="flex" justifyContent="space-between" alignItems="center" gap={1}>
                    <Typography variant="body2" fontWeight="bold">R$ {formatCurrency(s.total_value)}</Typography>
                    <Chip size="small" label={s.payment_method_label || (s.is_paid ? 'Pago' : 'Fiado')} color={s.is_paid ? 'success' : 'warning'} variant="outlined" />
                  </Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    {formatDateTimeBR(s.created_at)}{s.seller_username ? ` · ${s.seller_username}` : ''}
                  </Typography>
                  {(s.items || []).length > 0 && (
                    <Typography variant="caption" display="block" sx={{ mt: 0.25 }}>
                      {(s.items || []).map((it) => `${it.quantity}x ${it.product?.name || 'item'}`).join(' · ')}
                    </Typography>
                  )}
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCustomerDialog(prev => ({ ...prev, open: false }))}>Fechar</Button>
          <Button onClick={handleSaveCustomer} variant="contained">Salvar alterações</Button>
        </DialogActions>
      </Dialog>

      {/* Importar Clientes CSV */}
      <Dialog open={importClientsDialog} onClose={() => { setImportClientsDialog(false); setImportResult(null); }} fullWidth maxWidth="sm">
        <DialogTitle>Importar Lista de Participantes</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Envie um arquivo CSV com colunas: <strong>nome</strong>, <strong>telefone</strong> (opcional), <strong>grupo</strong> (opcional).
            Separador: ponto e vírgula (;).
          </Typography>
          <Button variant="outlined" component="label" startIcon={<CloudUpload />} fullWidth disabled={importLoading}>
            {importLoading ? 'Importando...' : 'Selecionar arquivo CSV'}
            <input type="file" accept=".csv,.txt" hidden onChange={handleImportClientsCsv} />
          </Button>
          {importLoading && <LinearProgress sx={{ mt: 2 }} />}
          {importResult && (
            <Alert severity="success" sx={{ mt: 2 }}>
              {importResult.message}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setImportClientsDialog(false); setImportResult(null); }}>Fechar</Button>
        </DialogActions>
      </Dialog>

      {/* Importar NF-e */}
      <Dialog open={importNfeDialog} onClose={() => { setImportNfeDialog(false); setNfeImportResult(null); }} fullWidth maxWidth="md">
        <DialogTitle>Importar Nota Fiscal (NF-e XML)</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Envie o arquivo XML da NF-e. Os produtos serão importados automaticamente com código de barras (EAN), nome, custo e quantidade.
            <br />Produtos novos terão preço de venda = custo x 1.5 (ajuste depois).
          </Typography>
          <Button variant="outlined" component="label" startIcon={<UploadFile />} fullWidth disabled={importLoading}>
            {importLoading ? 'Importando...' : 'Selecionar arquivo XML'}
            <input type="file" accept=".xml" hidden onChange={handleImportNfe} />
          </Button>
          {importLoading && <LinearProgress sx={{ mt: 2 }} />}
          {nfeImportResult && (
            <Box sx={{ mt: 2 }}>
              <Alert severity="success" sx={{ mb: 2 }}>{nfeImportResult.message}</Alert>
              {nfeImportResult.items?.length > 0 && (
                <TableContainer component={Paper} sx={{ maxHeight: 300 }}>
                  <Table size="small" stickyHeader>
                    <TableHead><TableRow><TableCell>Produto</TableCell><TableCell align="center">Qtd</TableCell><TableCell>Ação</TableCell></TableRow></TableHead>
                    <TableBody>
                      {nfeImportResult.items.map((item, i) => (
                        <TableRow key={i}>
                          <TableCell>{item.name}</TableCell>
                          <TableCell align="center">{item.qty}</TableCell>
                          <TableCell><Chip label={item.action} size="small" color={item.action === 'criado' ? 'success' : 'info'} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setImportNfeDialog(false); setNfeImportResult(null); }}>Fechar</Button>
        </DialogActions>
      </Dialog>

      {/* Etiquetas QR */}
      <Dialog open={qrPrintDialog} onClose={() => setQrPrintDialog(false)} fullWidth maxWidth="sm">
        <DialogTitle>Etiquetas QR Code</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            1. Gere códigos únicos (MC-xxxxx) para os produtos que ainda não têm código de barras.<br />
            2. Imprima a folha de etiquetas e cole nos produtos.<br />
            No caixa, o scanner (câmera ou leitor USB) lê tanto o QR quanto o código de barras original.
          </Typography>
          <Button fullWidth variant="outlined" sx={{ mb: 2 }} onClick={handleGenerateQRAll} startIcon={<QrCodeScanner />}>
            Gerar códigos para produtos sem código ({products.filter(p => !p.barcode).length} pendentes)
          </Button>
          <FormControlLabel
            control={<Switch checked={qrPrintOnlyGenerated} onChange={(e) => setQrPrintOnlyGenerated(e.target.checked)} />}
            label="Imprimir somente códigos gerados (MC-). Desligue para incluir produtos com código de barras próprio."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setQrPrintDialog(false)}>Fechar</Button>
          <Button onClick={handlePrintQrLabels} variant="contained" startIcon={<Download />}>Gerar folha de impressão</Button>
        </DialogActions>
      </Dialog>

      {/* Novo Custo por Setor */}
      {isAdmin && (
        <Dialog open={openCategoryCostDialog} onClose={() => setOpenCategoryCostDialog(false)} fullWidth maxWidth="sm">
          <DialogTitle>Novo Custo por Setor</DialogTitle>
          <DialogContent sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              autoFocus
              label="Descrição"
              fullWidth
              value={categoryCostForm.description}
              onChange={(e) => setCategoryCostForm({ ...categoryCostForm, description: e.target.value })}
              placeholder="Cebola, gelo, embalagem..."
            />
            <Autocomplete
              freeSolo
              options={categoryOptions}
              value={categoryCostForm.category}
              onInputChange={(event, value) => setCategoryCostForm(prev => ({ ...prev, category: value || 'Geral' }))}
              renderInput={(params) => (<TextField {...params} label="Setor vinculado" fullWidth />)}
            />
            <Box display="flex" gap={2}>
              <TextField
                label="Valor"
                type="number"
                fullWidth
                value={categoryCostForm.amount}
                onChange={(e) => setCategoryCostForm({ ...categoryCostForm, amount: e.target.value })}
                inputProps={{ min: 0, step: 0.01 }}
              />
              <TextField
                label="Dia/Evento"
                fullWidth
                value={categoryCostForm.event_day}
                onChange={(e) => setCategoryCostForm({ ...categoryCostForm, event_day: e.target.value })}
              />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpenCategoryCostDialog(false)}>Cancelar</Button>
            <Button onClick={handleCreateCategoryCost} variant="contained">Salvar</Button>
          </DialogActions>
        </Dialog>
      )}

      {/* Novo/Abastecer Produto */}
      <Dialog open={openProductDialog} onClose={() => setOpenProductDialog(false)} fullWidth maxWidth="sm">
        <DialogTitle>{isAdmin ? 'Novo Produto ou Abastecimento' : 'Abastecer Estoque'}</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Box mb={2}>
            <Autocomplete freeSolo options={products.map((option) => option.name)} value={newProduct.name} onInputChange={(event, newInputValue) => setNewProduct(prev => ({ ...prev, name: newInputValue }))} onChange={(event, newValue) => handleProductSelect(event, newValue)} renderInput={(params) => (<TextField {...params} label="Nome do Produto" placeholder="Selecione ou digite um novo..." helperText="Se selecionar existente, será abastecimento." fullWidth />)} />
          </Box>
          <Box display="flex" gap={1} mb={2}>
            <TextField label="Código de Barras" fullWidth value={newProduct.barcode} onChange={(e) => setNewProduct({ ...newProduct, barcode: e.target.value })} InputProps={{ endAdornment: <IconButton size="small" onClick={() => openScanner('newProduct')}><QrCodeScanner /></IconButton> }} />
          </Box>
          <Autocomplete freeSolo options={categoryOptions} value={newProduct.category} onInputChange={(event, value) => setNewProduct(prev => ({ ...prev, category: value || 'Geral' }))} renderInput={(params) => (<TextField {...params} label="Categoria" fullWidth />)} sx={{ mb: 2 }} />
          <Box display="flex" gap={2} mt={1}>
            <TextField label="Custo (Lote)" type="number" fullWidth value={newProduct.cost_price} onChange={(e) => setNewProduct({ ...newProduct, cost_price: e.target.value })} helperText="Custo unitário desta compra" />
            <TextField label="Venda" type="number" fullWidth value={newProduct.sell_price} onChange={(e) => setNewProduct({ ...newProduct, sell_price: e.target.value })} />
          </Box>
          <TextField margin="dense" label="Quantidade" type="number" fullWidth sx={{ mt: 2 }} value={newProduct.stock} onChange={(e) => setNewProduct({ ...newProduct, stock: e.target.value })} inputProps={{ min: 0 }} />
          <Box display="flex" alignItems="center" gap={2} mt={2}>
            <Box sx={{ width: 72, height: 72, borderRadius: 1, border: '1px dashed #bbb', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, bgcolor: '#fafafa' }}>
              {newProduct.photo ? <Box component="img" src={newProduct.photo} alt="Foto" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <PhotoCamera sx={{ color: '#bbb' }} />}
            </Box>
            <Box>
              <Button component="label" variant="outlined" size="small" startIcon={<PhotoCamera />} disabled={photoUploading}>
                {photoUploading ? 'Processando...' : (newProduct.photo ? 'Trocar foto' : 'Adicionar foto')}
                <input type="file" accept="image/*" hidden onChange={(e) => { handlePhotoSelect(e.target.files?.[0], 'new'); e.target.value = ''; }} />
              </Button>
              {newProduct.photo && <Button size="small" color="error" onClick={() => setNewProduct(prev => ({ ...prev, photo: '' }))} sx={{ ml: 1 }}>Remover</Button>}
              <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5 }}>Ajustada para 200x200 automaticamente.</Typography>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenProductDialog(false)}>Cancelar</Button>
          <Button onClick={handleCreateProduct} variant="contained" disabled={photoUploading}>Salvar</Button>
        </DialogActions>
      </Dialog>

      {/* Editar Produto */}
      {isAdmin && (
        <Dialog open={openEditProductDialog} onClose={() => setOpenEditProductDialog(false)} fullWidth maxWidth="sm">
          <DialogTitle>Editar Produto</DialogTitle>
          <DialogContent sx={{ pt: 2 }}>
            <TextField margin="dense" label="Nome" fullWidth value={editProductData.name} onChange={(e) => setEditProductData({ ...editProductData, name: e.target.value })} />
            <TextField margin="dense" label="Código de Barras" fullWidth value={editProductData.barcode} onChange={(e) => setEditProductData({ ...editProductData, barcode: e.target.value })} sx={{ mt: 1 }} InputProps={{ endAdornment: <IconButton size="small" onClick={() => openScanner('editProduct')}><QrCodeScanner /></IconButton> }} />
            <Autocomplete freeSolo options={categoryOptions} value={editProductData.category || 'Geral'} onInputChange={(event, value) => setEditProductData(prev => ({ ...prev, category: value || 'Geral' }))} renderInput={(params) => (<TextField {...params} label="Categoria" fullWidth />)} sx={{ mt: 1 }} />
            <Box display="flex" gap={2} mt={2}>
              <TextField label="Custo Médio" type="number" fullWidth value={editProductData.cost_price} onChange={(e) => setEditProductData({ ...editProductData, cost_price: e.target.value })} />
              <TextField label="Venda" type="number" fullWidth value={editProductData.sell_price} onChange={(e) => setEditProductData({ ...editProductData, sell_price: e.target.value })} />
            </Box>
            <TextField margin="dense" label="Estoque (Correção)" type="number" fullWidth sx={{ mt: 2 }} value={editProductData.stock} onChange={(e) => setEditProductData({ ...editProductData, stock: e.target.value })} helperText="Isso altera diretamente a quantidade." />
            <Box display="flex" alignItems="center" gap={2} mt={2}>
              <Box sx={{ width: 72, height: 72, borderRadius: 1, border: '1px dashed #bbb', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, bgcolor: '#fafafa' }}>
                {editProductData.photo ? <Box component="img" src={editProductData.photo} alt="Foto" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <PhotoCamera sx={{ color: '#bbb' }} />}
              </Box>
              <Box>
                <Button component="label" variant="outlined" size="small" startIcon={<PhotoCamera />} disabled={photoUploading}>
                  {photoUploading ? 'Processando...' : (editProductData.photo ? 'Trocar foto' : 'Adicionar foto')}
                  <input type="file" accept="image/*" hidden onChange={(e) => { handlePhotoSelect(e.target.files?.[0], 'edit'); e.target.value = ''; }} />
                </Button>
                {editProductData.photo && <Button size="small" color="error" onClick={() => setEditProductData(prev => ({ ...prev, photo: '' }))} sx={{ ml: 1 }}>Remover</Button>}
                <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5 }}>Ajustada para 200x200 automaticamente.</Typography>
              </Box>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpenEditProductDialog(false)}>Cancelar</Button>
            <Button onClick={handleSaveEdit} variant="contained" disabled={photoUploading}>Salvar</Button>
          </DialogActions>
        </Dialog>
      )}

      {/* Cobrança PIX */}
      <Dialog open={pixDialog.open} onClose={() => pixDialog.status !== 'paid' && setPixDialog(prev => ({ ...prev, open: false }))} fullWidth maxWidth="xs">
        <DialogTitle sx={{ textAlign: 'center' }}>Pagamento via PIX</DialogTitle>
        <DialogContent sx={{ textAlign: 'center' }}>
          {pixDialog.status === 'loading' && (
            <Box sx={{ py: 5 }}>
              <CircularProgress />
              <Typography sx={{ mt: 2 }} color="text.secondary">Gerando cobrança PIX...</Typography>
            </Box>
          )}

          {pixDialog.status === 'paid' && (
            <Box sx={{ py: 5 }}>
              <CheckCircle sx={{ fontSize: 90, color: '#2e7d32' }} />
              <Typography variant="h6" fontWeight="bold" color="#2e7d32" sx={{ mt: 1 }}>Pagamento confirmado!</Typography>
              <Typography color="text.secondary">R$ {formatCurrency(pixDialog.valor)} recebido via PIX.</Typography>
            </Box>
          )}

          {pixDialog.status === 'expired' && (
            <Box sx={{ py: 4 }}>
              <AccessTime sx={{ fontSize: 70, color: '#c62828' }} />
              <Typography variant="h6" fontWeight="bold" sx={{ mt: 1 }}>Tempo esgotado</Typography>
              <Typography color="text.secondary">O QR expirou. Gere um novo para o cliente pagar.</Typography>
            </Box>
          )}

          {(pixDialog.status === 'waiting' || pixDialog.status === 'manual') && (
            <>
              <Typography variant="h5" fontWeight="900" color="#2e7d32" gutterBottom>R$ {formatCurrency(pixDialog.valor)}</Typography>
              {pixDialog.qrImage && <Box component="img" src={pixDialog.qrImage} alt="QR Code PIX" sx={{ width: 230, maxWidth: '100%', mx: 'auto', display: 'block' }} />}
              {pixDialog.status === 'waiting' && (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mt: 1, color: '#ef6c00' }}>
                  <CircularProgress size={16} color="inherit" />
                  <Typography variant="body2">
                    Aguardando pagamento · expira em {(() => {
                      const s = Math.max(0, Math.ceil((pixDialog.expiresAt - (pixNow || Date.now())) / 1000));
                      return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
                    })()}
                  </Typography>
                </Box>
              )}
              {pixDialog.status === 'manual' && (
                <Alert severity="info" sx={{ mt: 1, textAlign: 'left' }}>
                  Confira o recebimento no app do banco e toque em "Recebido".
                  {pixDialog.note && <Typography variant="caption" display="block" sx={{ mt: 0.5, opacity: 0.8 }}>Motivo: {pixDialog.note}</Typography>}
                </Alert>
              )}
              <TextField
                value={pixDialog.qrText}
                fullWidth multiline maxRows={3} size="small"
                InputProps={{ readOnly: true }}
                sx={{ mt: 2 }}
                onFocus={(e) => e.target.select()}
              />
              <Button fullWidth variant="outlined" startIcon={<ContentCopy />} onClick={handleCopyPix} sx={{ mt: 1 }}>
                Copiar código PIX
              </Button>
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, flexDirection: 'column', gap: 1 }}>
          {pixDialog.status === 'manual' && (
            <Button fullWidth variant="contained" color="success" onClick={() => finalizePixSale('')}>
              Recebido — Finalizar venda
            </Button>
          )}
          {pixDialog.status === 'waiting' && (
            <Button fullWidth variant="text" color="success" onClick={() => finalizePixSale(pixDialog.orderId)}>
              Já recebi — confirmar manualmente
            </Button>
          )}
          {pixDialog.status === 'expired' && (
            <Button fullWidth variant="contained" onClick={startPixCharge}>Gerar novo QR</Button>
          )}
          {pixDialog.status !== 'paid' && (
            <Button fullWidth onClick={() => setPixDialog(prev => ({ ...prev, open: false }))}>Cancelar</Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Nova pré-venda */}
      <Dialog open={openVoucherDialog} onClose={() => setOpenVoucherDialog(false)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><Fastfood /> Nova pré-venda de combo</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Autocomplete
            freeSolo
            autoHighlight
            options={customers}
            getOptionLabel={(o) => (typeof o === 'string' ? o : o.name)}
            isOptionEqualToValue={(o, v) => (o?.name || o) === (v?.name || v)}
            value={voucherForm.customer_name}
            onChange={(e, v) => {
              if (v && typeof v === 'object') setVoucherForm(prev => ({ ...prev, customer_name: v.name, customer_phone: v.phone || '' }));
              else setVoucherForm(prev => ({ ...prev, customer_name: v || '' }));
            }}
            onInputChange={(e, val, reason) => { if (reason === 'input') setVoucherForm(prev => ({ ...prev, customer_name: val })); }}
            renderOption={(props, o) => (<li {...props} key={o.id}>{o.name}{o.phone ? ` — ${o.phone}` : ''}</li>)}
            renderInput={(params) => (<TextField {...params} autoFocus margin="dense" label="Cliente (comprador)" placeholder="Selecione da lista ou digite um novo..." helperText="Escolha um cliente cadastrado — nome e telefone vêm da lista." />)}
          />
          <TextField margin="dense" label="Telefone" fullWidth value={voucherForm.customer_phone} onChange={(e) => setVoucherForm({ ...voucherForm, customer_phone: e.target.value })} sx={{ mt: 1 }} />
          <Box display="flex" gap={2} mt={2}>
            <TextField label="Qtd de combos" type="number" fullWidth value={voucherForm.quantity} onChange={(e) => setVoucherForm({ ...voucherForm, quantity: e.target.value })} inputProps={{ min: 1 }} />
            <TextField label="Preço unitário" type="number" fullWidth value={voucherForm.unit_price} onChange={(e) => setVoucherForm({ ...voucherForm, unit_price: e.target.value })} helperText="Padrão R$ 30" />
          </Box>
          <FormControl fullWidth margin="dense" sx={{ mt: 2 }}>
            <InputLabel>Pagamento</InputLabel>
            <Select label="Pagamento" value={voucherForm.payment_method} onChange={(e) => setVoucherForm({ ...voucherForm, payment_method: e.target.value })}>
              {paymentMethods.filter(m => m.value !== 'fiado').map((m) => <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>)}
            </Select>
          </FormControl>
          <Typography variant="h6" align="right" sx={{ mt: 2 }} color="#2e7d32" fontWeight="bold">
            Total: R$ {formatCurrency((parseFloat(voucherForm.unit_price || 0)) * (parseInt(voucherForm.quantity || 0) || 0))}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenVoucherDialog(false)}>Cancelar</Button>
          <Button onClick={handleCreateVoucher} variant="contained">Gerar voucher</Button>
        </DialogActions>
      </Dialog>

      {/* QR do voucher (mostrar/enviar) */}
      <Dialog open={voucherResult.open} onClose={() => setVoucherResult({ open: false, voucher: null, qr: '' })} fullWidth maxWidth="xs">
        <DialogTitle sx={{ textAlign: 'center' }}>Voucher gerado</DialogTitle>
        <DialogContent sx={{ textAlign: 'center' }}>
          {voucherResult.voucher && (
            <>
              <Typography variant="h5" fontWeight="900" color="#1a237e">{voucherResult.voucher.code}</Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                {voucherResult.voucher.customer_name} · {voucherResult.voucher.quantity}x {voucherResult.voucher.product} · R$ {formatCurrency(voucherResult.voucher.total_value)}
              </Typography>
              {voucherResult.qr && <Box component="img" src={voucherResult.qr} alt="QR do voucher" sx={{ width: 240, maxWidth: '100%', mx: 'auto', display: 'block' }} />}
              <Alert severity="info" sx={{ mt: 1, textAlign: 'left' }}>
                Envie este QR ao comprador. Ele apresenta na retirada, e o vendedor escaneia para dar baixa.
              </Alert>
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, flexDirection: 'column', gap: 1 }}>
          <Button fullWidth variant="contained" startIcon={<Share />} onClick={handleShareVoucher}>Enviar QR ao comprador</Button>
          <Button fullWidth onClick={() => setVoucherResult({ open: false, voucher: null, qr: '' })}>Fechar</Button>
        </DialogActions>
      </Dialog>

      {/* Retirada / baixa do voucher */}
      <Dialog open={redeemDialog.open} onClose={() => setRedeemDialog({ open: false, voucher: null })} fullWidth maxWidth="xs">
        <DialogTitle sx={{ textAlign: 'center' }}>Retirada do combo</DialogTitle>
        <DialogContent sx={{ textAlign: 'center' }}>
          {redeemDialog.voucher && (
            <>
              <Typography variant="h5" fontWeight="900" color="#1a237e">{redeemDialog.voucher.code}</Typography>
              <Typography variant="h6" sx={{ mt: 1 }}>{redeemDialog.voucher.customer_name}</Typography>
              <Typography variant="h4" fontWeight="900" sx={{ my: 1 }}>{redeemDialog.voucher.quantity} <Typography component="span" variant="body1">{redeemDialog.voucher.product}(s)</Typography></Typography>
              {redeemDialog.voucher.status === 'pago' && (
                <Alert severity="success" icon={<CheckCircle />} sx={{ justifyContent: 'center', mb: 1 }}>PAGO · pronto para entregar</Alert>
              )}
              {redeemDialog.voucher.status === 'retirado' && (
                <Alert severity="error" sx={{ textAlign: 'left', mb: 1 }}>
                  ⚠️ Já retirado em {formatDateTimeBR(redeemDialog.voucher.redeemed_at)}{redeemDialog.voucher.redeemed_by ? ` por ${redeemDialog.voucher.redeemed_by}` : ''}.
                </Alert>
              )}
              {redeemDialog.voucher.status === 'cancelado' && (
                <Alert severity="warning" sx={{ mb: 1 }}>Este voucher foi cancelado.</Alert>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, flexDirection: 'column', gap: 1 }}>
          {redeemDialog.voucher && redeemDialog.voucher.status === 'pago' && (
            <Button fullWidth variant="contained" color="success" size="large" startIcon={<CheckCircle />} onClick={handleRedeem}>
              Entregar — dar baixa
            </Button>
          )}
          <Button fullWidth onClick={() => setRedeemDialog({ open: false, voucher: null })}>Fechar</Button>
        </DialogActions>
      </Dialog>

      {/* Usuario */}
      <Dialog open={openUserDialog} onClose={() => setOpenUserDialog(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editingUser ? 'Editar Usuário' : 'Novo Usuário'}</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <TextField margin="dense" label="Usuário" fullWidth value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} />
          <TextField margin="dense" label="Senha" type="password" fullWidth value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} helperText={editingUser ? 'Se preencher, o usuário trocará a senha no próximo login.' : 'O usuário trocará esta senha no primeiro login.'} />
          <FormControl fullWidth margin="dense">
            <InputLabel>Perfil</InputLabel>
            <Select label="Perfil" value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}>
              <MenuItem value="vendedor">Vendedor</MenuItem>
              <MenuItem value="admin">Administrador</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenUserDialog(false)}>Cancelar</Button>
          <Button onClick={handleSaveUser} variant="contained">Salvar</Button>
        </DialogActions>
      </Dialog>

      {/* Pagar Divida */}
      <Dialog open={openPayDialog} onClose={() => setOpenPayDialog(false)}>
        <DialogTitle>Pagar dívida - {payData.customerName}</DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mt: 1, mb: 2 }}>
            Dívida atual: <strong>R$ {formatCurrency(payData.debt)}</strong>
          </Alert>
          <TextField label="Valor (R$)" type="number" fullWidth value={payData.amount} onChange={(e) => setPayData({ ...payData, amount: e.target.value })} autoFocus />
          <Button size="small" sx={{ mt: 1 }} onClick={() => setPayData({ ...payData, amount: String(payData.debt) })}>
            Pagar tudo (R$ {formatCurrency(payData.debt)})
          </Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenPayDialog(false)} disabled={savingPayment}>Cancelar</Button>
          <Button onClick={handlePayDebt} variant="contained" color="success" disabled={savingPayment}
            startIcon={savingPayment ? <CircularProgress size={18} color="inherit" /> : null}>
            {savingPayment ? 'Registrando...' : 'Pagar'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={feedback.open} autoHideDuration={4000} onClose={() => setFeedback({ ...feedback, open: false })} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Alert severity={feedback.severity} variant="filled">{feedback.message}</Alert>
      </Snackbar>
    </Box>
  );
}
export default App;
