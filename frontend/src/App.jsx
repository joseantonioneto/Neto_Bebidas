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
  FormControlLabel
} from '@mui/material';

import {
  ShoppingCart, PersonAdd, Inventory, Add, Assessment,
  Logout, Storefront, Edit, Delete, Search, TrendingUp, Storage,
  AdminPanelSettings, Remove, Download, PointOfSale, QrCodeScanner,
  CameraAlt, UploadFile, Close, People, CloudUpload
} from '@mui/icons-material';

import QRCode from 'qrcode';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import { format, subDays, parseISO, isAfter } from 'date-fns';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const api = axios.create({ baseURL: API_BASE });

const ROLE_LABELS = { admin: 'Administrador', vendedor: 'Vendedor' };
const FALLBACK_PAYMENT_METHODS = [
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'pix', label: 'Pix' },
  { value: 'cartao_debito', label: 'Cartão de débito' },
  { value: 'cartao_credito', label: 'Cartão de crédito' },
  { value: 'pagbank', label: 'PagBank' },
  { value: 'fiado', label: 'Fiado' }
];
const formatCurrency = (value) => Number(value || 0).toFixed(2);

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
}, (error) => Promise.reject(error));

// --- SCANNER COMPONENT ---
function BarcodeScanner({ open, onClose, onScan }) {
  const scannerRef = useRef(null);
  const html5QrCodeRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    let scanner = null;

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
            scanner.stop().catch(() => {});
            onClose();
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
      if (html5QrCodeRef.current) {
        html5QrCodeRef.current.stop().catch(() => {});
        html5QrCodeRef.current = null;
      }
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

  const [tabValue, setTabValue] = useState('resumo');
  const [cart, setCart] = useState([]);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [salesHistory, setSalesHistory] = useState([]);
  const [users, setUsers] = useState([]);
  const [reportSummary, setReportSummary] = useState(null);
  const [paymentMethods, setPaymentMethods] = useState(FALLBACK_PAYMENT_METHODS);
  const [pagBankStatus, setPagBankStatus] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('dinheiro');

  const [daysFilter, setDaysFilter] = useState(7);
  const [productFilter, setProductFilter] = useState(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [searchTermProduct, setSearchTermProduct] = useState('');
  const [feedback, setFeedback] = useState({ open: false, message: '', severity: 'success' });

  const [openNewClientDialog, setOpenNewClientDialog] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientGroup, setNewClientGroup] = useState('Caminhar Cristo Rei');

  const [openProductDialog, setOpenProductDialog] = useState(false);
  const [openEditProductDialog, setOpenEditProductDialog] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: '', category: 'Geral', cost_price: '', sell_price: '', stock: '', barcode: '' });
  const [editProductData, setEditProductData] = useState({ id: null, name: '', category: 'Geral', cost_price: '', sell_price: '', stock: '', barcode: '' });

  const [openPayDialog, setOpenPayDialog] = useState(false);
  const [payData, setPayData] = useState({ customerId: null, customerName: '', amount: '' });

  const [openUserDialog, setOpenUserDialog] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userForm, setUserForm] = useState({ username: '', password: '', role: 'vendedor' });

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

  useEffect(() => { if (token) fetchData(); }, [token]);

  useEffect(() => {
    if (currentUser?.role === 'vendedor' && tabValue === 'resumo') {
      setTabValue('vender');
    }
  }, [currentUser, tabValue]);

  const fetchData = async () => {
    try {
      const meRes = await api.get('/me');
      const userIsAdmin = meRes.data.role === 'admin';
      setCurrentUser(meRes.data);

      const [prodRes, custRes, methodsRes, pagBankRes] = await Promise.all([
        api.get('/products/'),
        api.get('/customers/'),
        api.get('/payment-methods'),
        api.get('/integrations/pagbank/status')
      ]);
      setProducts(prodRes.data);
      setCustomers(custRes.data);
      setSelectedCustomer(prev => {
        if (prev) return prev;
        const defaultCustomer = custRes.data.find(c => c.name === 'Consumidor Final');
        return defaultCustomer ? defaultCustomer.id : prev;
      });
      setPaymentMethods(methodsRes.data);
      setPagBankStatus(pagBankRes.data);

      if (userIsAdmin) {
        const [salesRes, usersRes, summaryRes] = await Promise.all([
          api.get('/sales/'), api.get('/users/'), api.get('/reports/summary')
        ]);
        setSalesHistory(salesRes.data);
        setUsers(usersRes.data);
        setReportSummary(summaryRes.data);
      } else {
        setSalesHistory([]);
        setUsers([]);
        setReportSummary(null);
      }
    } catch (error) {
      if (error.response && error.response.status === 401) {
        localStorage.removeItem('token'); setToken(null); setCurrentUser(null);
      }
    }
  };

  const showFeedback = (message, severity) => setFeedback({ open: true, message, severity });

  const handleLogin = async () => {
    try {
      const formData = new FormData();
      formData.append('username', authForm.username);
      formData.append('password', authForm.password);
      const response = await api.post('/token', formData);
      localStorage.setItem('token', response.data.access_token);
      setCurrentUser(response.data.user);
      setTabValue(response.data.user?.role === 'admin' ? 'resumo' : 'vender');
      setToken(response.data.access_token);
    } catch (error) { showFeedback('Erro no login', 'error'); }
  };

  const handleLogout = () => {
    localStorage.removeItem('token'); setToken(null); setCurrentUser(null); setCart([]);
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
    try {
      const res = await api.get(`/products/barcode/${encodeURIComponent(code)}`);
      const product = res.data;
      addToCart(product);
      showFeedback(`${product.name} adicionado!`, 'success');
    } catch {
      showFeedback(`Produto não encontrado: ${code}`, 'warning');
    }
  }, [scanTarget]);

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

  const chartData = useMemo(() => {
    const cutoffDate = subDays(new Date(), daysFilter);
    const dailyData = {};
    salesHistory.forEach(sale => {
      const saleDate = parseISO(sale.created_at);
      if (!isAfter(saleDate, cutoffDate)) return;
      const sortableDate = format(saleDate, 'yyyy-MM-dd');
      if (productFilter) {
        const hasProduct = sale.items && sale.items.some(item => item.product_id === productFilter.id);
        if (!hasProduct) return;
        const itemTotal = sale.items
          .filter(item => item.product_id === productFilter.id)
          .reduce((acc, item) => acc + (item.quantity * item.unit_sell_price), 0);
        dailyData[sortableDate] = (dailyData[sortableDate] || 0) + itemTotal;
      } else {
        dailyData[sortableDate] = (dailyData[sortableDate] || 0) + sale.total_value;
      }
    });
    return Object.entries(dailyData)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, total]) => ({ day: format(parseISO(date), 'dd/MM'), total }));
  }, [salesHistory, daysFilter, productFilter]);

  const totalSold = reportSummary?.totals?.gross_total ?? salesHistory.reduce((acc, sale) => acc + sale.total_value, 0);
  const totalDebtCurrent = customers.reduce((acc, customer) => acc + customer.debt, 0);
  const totalCash = reportSummary?.totals?.paid_total ?? (totalSold - totalDebtCurrent);
  const reportDebt = reportSummary?.totals?.debt_total ?? totalDebtCurrent;
  const reportProfit = reportSummary?.totals?.profit_total ?? stockMetrics.potentialProfit;
  const cartTotal = cart.reduce((sum, item) => sum + (item.sell_price * item.quantity), 0);
  const categoryOptions = [...new Set(products.map((p) => p.category || 'Geral'))].sort();

  const filteredCustomers = customers.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  const filteredProducts = products.filter(p => {
    const term = searchTermProduct.trim().toLowerCase();
    if (!term) return true;
    return p.name.toLowerCase().includes(term) || (p.barcode || '').toLowerCase() === term;
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
  const addToCart = (p) => {
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
  };

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
    if (!selectedCustomer) return showFeedback('Selecione cliente!', 'warning');
    if (cart.length === 0) return showFeedback('Carrinho vazio!', 'warning');
    const paymentMethod = isPaid ? selectedPaymentMethod : 'fiado';
    const selectedCustomerObj = customers.find(c => c.id === parseInt(selectedCustomer));
    if (paymentMethod === 'fiado' && selectedCustomerObj?.name === 'Consumidor Final') {
      return showFeedback('Fiado exige cliente identificado. Selecione ou cadastre o cliente.', 'warning');
    }
    try {
      const items = cart.map((p) => ({ product_id: p.id, quantity: p.quantity }));
      if (paymentMethod === 'pagbank') {
        await api.post('/integrations/pagbank/payment-intents', {
          amount: cartTotal,
          payment_method: 'pagbank',
          sale_code: `mercadinho-${Date.now()}`
        });
      }
      await api.post('/sales/', {
        customer_id: parseInt(selectedCustomer),
        items,
        is_paid: paymentMethod !== 'fiado',
        payment_method: paymentMethod,
        payment_provider: paymentMethod === 'pagbank' ? 'pagbank' : null
      });
      showFeedback(paymentMethod === 'fiado' ? "FIADO anotado!" : "Venda registrada!", paymentMethod === 'fiado' ? 'info' : 'success');
      setCart([]);
      setCartOpen(false);
      fetchData();
    } catch (error) {
      showFeedback(error.response?.data?.detail || 'Erro na venda.', 'error');
    }
  };

  const handlePayDebt = async () => {
    if (!payData.amount || payData.amount <= 0) return;
    try {
      await api.post(`/customers/${payData.customerId}/pay/`, { amount: parseFloat(payData.amount) });
      showFeedback('Pagamento registrado!', 'success');
      setOpenPayDialog(false); fetchData();
    } catch { showFeedback('Erro ao pagar.', 'error'); }
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
      setNewProduct({ name: '', category: 'Geral', cost_price: '', sell_price: '', stock: '', barcode: '' });
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
    } catch (error) {
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
      ['Custo estimado', reportSummary.totals.cost_total],
      ['Lucro estimado', reportSummary.totals.profit_total],
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
          <Box sx={{ mb: 2, display: 'flex', justifyContent: 'center' }}><Storefront sx={{ fontSize: 50, color: '#1a237e' }} /></Box>
          <Typography variant="h4" fontWeight="900" color="#1a237e">MERCADINHO CAMINHAR</Typography>
          <Typography variant="caption" color="text.secondary">Igreja de Cristo Rei</Typography>
          <Box component="form" sx={{ mt: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField label="Usuário" fullWidth onChange={(e) => setAuthForm({ ...authForm, username: e.target.value })} />
            <TextField label="Senha" type="password" fullWidth onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && handleLogin()} />
            <Button variant="contained" size="large" onClick={handleLogin} sx={{ bgcolor: '#1a237e', py: 1.5 }}>ENTRAR</Button>
          </Box>
        </Paper>
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

  // --- CARRINHO MOBILE (DRAWER) ---
  const CartContent = () => (
    <Box sx={{ p: 2, width: isMobile ? '100vw' : 'auto', maxWidth: 400 }}>
      <Typography variant="h6" gutterBottom><ShoppingCart /> Carrinho ({cart.length})</Typography>
      <Autocomplete options={customers} getOptionLabel={(o) => o.name} value={customers.find(c => c.id === selectedCustomer) || null} isOptionEqualToValue={(o, v) => o.id === v.id} onChange={(e, v) => setSelectedCustomer(v ? v.id : '')} renderInput={(params) => <TextField {...params} label="Cliente" size="small" />} sx={{ mb: 2 }} />
      <FormControl size="small" fullWidth sx={{ mb: 2 }}>
        <InputLabel>Pagamento</InputLabel>
        <Select label="Pagamento" value={selectedPaymentMethod} onChange={(e) => setSelectedPaymentMethod(e.target.value)}>
          {paymentMethods.map((method) => <MenuItem key={method.value} value={method.value}>{method.label}</MenuItem>)}
        </Select>
      </FormControl>
      {selectedPaymentMethod === 'pagbank' && (
        <Alert severity={pagBankStatus?.ready ? 'success' : 'info'} sx={{ mb: 2 }}>
          {pagBankStatus?.ready ? 'PagBank pronto' : 'PagBank preparado para bridge PlugPag'}
        </Alert>
      )}
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
      <Button fullWidth variant="contained" color={selectedPaymentMethod === 'fiado' ? 'warning' : 'success'} onClick={() => handleFinishSale(selectedPaymentMethod !== 'fiado')} disabled={cart.length === 0}>
        {selectedPaymentMethod === 'fiado' ? 'Anotar Fiado' : 'Finalizar Venda'}
      </Button>
    </Box>
  );

  return (
    <Box sx={{ flexGrow: 1, bgcolor: '#f0f2f5', minHeight: '100vh', pb: isMobile ? 10 : 5 }}>
      <AppBar position="static" sx={{ bgcolor: '#1a237e' }}>
        <Toolbar>
          <Storefront sx={{ mr: 1 }} />
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
            <Tab value="clientes" label="Clientes" icon={<People />} />
            <Tab value="estoque" label="Estoque" icon={<Inventory />} />
            {isAdmin && <Tab value="usuarios" label="Usuários" icon={<AdminPanelSettings />} />}
          </Tabs>
        )}
      </AppBar>

      <Container maxWidth="xl" sx={{ mt: isMobile ? 2 : 4 }}>

        {/* === ABA RESUMO === */}
        {isAdmin && tabValue === 'resumo' && (
          <Grid container spacing={isMobile ? 2 : 3}>
            <Grid item xs={6} md={3}><Paper sx={{ p: 2, borderLeft: '5px solid #2196f3' }}><Typography variant="caption" color="text.secondary">Total Vendido</Typography><Typography variant={isMobile ? "h6" : "h5"} fontWeight="bold">R$ {formatCurrency(totalSold)}</Typography></Paper></Grid>
            <Grid item xs={6} md={3}><Paper sx={{ p: 2, borderLeft: '5px solid #4caf50' }}><Typography variant="caption" color="text.secondary">Recebido</Typography><Typography variant={isMobile ? "h6" : "h5"} fontWeight="bold" color="success.main">R$ {formatCurrency(totalCash)}</Typography></Paper></Grid>
            <Grid item xs={6} md={3}><Paper sx={{ p: 2, borderLeft: '5px solid #ff9800' }}><Typography variant="caption" color="text.secondary">Fiado</Typography><Typography variant={isMobile ? "h6" : "h5"} fontWeight="bold">R$ {formatCurrency(reportDebt)}</Typography></Paper></Grid>
            <Grid item xs={6} md={3}><Paper sx={{ p: 2, borderLeft: '5px solid #9c27b0' }}><Typography variant="caption" color="text.secondary">Lucro Estimado</Typography><Typography variant={isMobile ? "h6" : "h5"} fontWeight="bold" color="secondary">R$ {formatCurrency(reportProfit)}</Typography></Paper></Grid>

            <Grid item xs={12}>
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

            <Grid item xs={12} md={5}>
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

            <Grid item xs={12} md={7}>
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
              <Grid item xs={12} md={5}>
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

            <Grid item xs={12}>
              <Paper sx={{ p: 2 }}>
                <Typography variant="h6" gutterBottom>Histórico de Vendas</Typography>
                <TableContainer sx={{ maxHeight: 300 }}>
                  <Table stickyHeader size="small">
                    <TableHead><TableRow><TableCell>Data</TableCell><TableCell>Cliente</TableCell><TableCell>Vendedor</TableCell><TableCell>Valor</TableCell><TableCell>Status</TableCell></TableRow></TableHead>
                    <TableBody>
                      {salesHistory.map((sale) => (
                        <TableRow key={sale.id}>
                          <TableCell>{new Date(sale.created_at).toLocaleString()}</TableCell>
                          <TableCell>{sale.customer?.name || '---'}</TableCell>
                          <TableCell>{sale.seller_username || '---'}</TableCell>
                          <TableCell>R$ {formatCurrency(sale.total_value)}</TableCell>
                          <TableCell><Chip label={sale.payment_method_label || (sale.is_paid ? "PAGO" : "FIADO")} color={sale.is_paid ? "success" : "warning"} size="small" variant="outlined" /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Paper>
            </Grid>
          </Grid>
        )}

        {/* === ABA VENDAS === */}
        {tabValue === 'vender' && (
          <Grid container spacing={isMobile ? 2 : 3}>
            <Grid item xs={12} md={8}>
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
                  <Grid item xs={6} sm={4} md={3} key={p.id}>
                    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', opacity: p.stock > 0 ? 1 : 0.5 }}>
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
              <Grid item xs={12} md={4}>
                <Paper sx={{ p: 2, position: 'sticky', top: 20 }}>
                  <CartContent />
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
            </Paper>
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
                    <TableRow key={row.id}>
                      <TableCell>
                        {row.name}
                        {isMobile && row.group_name && <Typography variant="caption" display="block" color="text.secondary">{row.group_name}</Typography>}
                      </TableCell>
                      {!isMobile && <TableCell>{row.group_name || '—'}</TableCell>}
                      <TableCell align="right" sx={{ fontWeight: 'bold', color: row.debt > 0 ? 'red' : 'green' }}>R$ {formatCurrency(row.debt)}</TableCell>
                      <TableCell align="center">
                        {row.debt > 0 ? (
                          <Button size="small" variant="outlined" color="success" onClick={() => { setPayData({ customerId: row.id, customerName: row.name, amount: '' }); setOpenPayDialog(true); }}>Pagar</Button>
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
              {filteredCustomers.length} clientes
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
                  {products.map((p) => (
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
                </TableBody>
              </Table>
            </TableContainer>
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
            sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1200, borderTop: '1px solid #ddd' }}
          >
            {isAdmin && <BottomNavigationAction label="Resumo" value="resumo" icon={<Assessment />} />}
            <BottomNavigationAction label="Vender" value="vender" icon={<ShoppingCart />} />
            <BottomNavigationAction label="Clientes" value="clientes" icon={<People />} />
            <BottomNavigationAction label="Estoque" value="estoque" icon={<Inventory />} />
            {isAdmin && <BottomNavigationAction label="Users" value="usuarios" icon={<AdminPanelSettings />} />}
          </BottomNavigation>

          {tabValue === 'vender' && (
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
            <CartContent />
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
          <TextField label="Grupo" fullWidth value={newClientGroup} onChange={(e) => setNewClientGroup(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenNewClientDialog(false)}>Cancelar</Button>
          <Button onClick={handleCreateCustomer} variant="contained">Salvar</Button>
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
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenProductDialog(false)}>Cancelar</Button>
          <Button onClick={handleCreateProduct} variant="contained">Salvar</Button>
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
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpenEditProductDialog(false)}>Cancelar</Button>
            <Button onClick={handleSaveEdit} variant="contained">Salvar</Button>
          </DialogActions>
        </Dialog>
      )}

      {/* Usuario */}
      <Dialog open={openUserDialog} onClose={() => setOpenUserDialog(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editingUser ? 'Editar Usuário' : 'Novo Usuário'}</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <TextField margin="dense" label="Usuário" fullWidth value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value })} />
          <TextField margin="dense" label="Senha" type="password" fullWidth value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} helperText={editingUser ? 'Deixe em branco para manter a senha atual.' : ''} />
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
          <TextField label="Valor (R$)" type="number" fullWidth value={payData.amount} onChange={(e) => setPayData({ ...payData, amount: e.target.value })} autoFocus sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenPayDialog(false)}>Cancelar</Button>
          <Button onClick={handlePayDebt} variant="contained" color="success">Pagar</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={feedback.open} autoHideDuration={4000} onClose={() => setFeedback({ ...feedback, open: false })} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Alert severity={feedback.severity} variant="filled">{feedback.message}</Alert>
      </Snackbar>
    </Box>
  );
}
export default App;
