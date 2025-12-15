import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { 
  AppBar, Toolbar, Typography, Button, Container, Grid, Paper, 
  Card, CardContent, CardActions, List, ListItem, ListItemText, 
  IconButton, Select, MenuItem, FormControl, InputLabel, 
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Box, Snackbar, Alert, Tab, Tabs, TextField, Dialog, DialogTitle, 
  DialogContent, DialogActions, Badge, Chip, InputAdornment,
  Autocomplete
} from '@mui/material';

import { 
  ShoppingCart, PersonAdd, Inventory, Add, Assessment, 
  AttachMoney, MoneyOff, Logout, Paid, LocalBar, Edit, 
  Delete, Search, TrendingUp, Storage
} from '@mui/icons-material';

// --- BIBLIOTECAS DE GRÁFICOS E DATA ---
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from 'recharts';
import { format, subDays, parseISO, isAfter } from 'date-fns';

const api = axios.create({ baseURL: 'http://localhost:8001' });

api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
}, (error) => Promise.reject(error));

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [authForm, setAuthForm] = useState({ username: '', password: '' });

  const [tabValue, setTabValue] = useState(0); 
  const [cart, setCart] = useState([]);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [salesHistory, setSalesHistory] = useState([]); 
  const [selectedCustomer, setSelectedCustomer] = useState('');
  
  // --- FILTROS DO DASHBOARD ---
  const [daysFilter, setDaysFilter] = useState(7);
  const [productFilter, setProductFilter] = useState(null);

  // States de Busca e Formulários
  const [searchTerm, setSearchTerm] = useState(''); 
  const [searchTermProduct, setSearchTermProduct] = useState('');
  const [feedback, setFeedback] = useState({ open: false, message: '', severity: 'success' });
  const [openNewClientDialog, setOpenNewClientDialog] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  
  const [openProductDialog, setOpenProductDialog] = useState(false);
  const [openEditProductDialog, setOpenEditProductDialog] = useState(false);
  
  const [newProduct, setNewProduct] = useState({ name: '', cost_price: '', sell_price: '', stock: '' });
  const [editProductData, setEditProductData] = useState({ id: null, name: '', cost_price: '', sell_price: '', stock: '' });
  const [openPayDialog, setOpenPayDialog] = useState(false);
  const [payData, setPayData] = useState({ customerId: null, customerName: '', amount: '' });

  useEffect(() => { if (token) fetchData(); }, [token]);

  const fetchData = async () => {
    try {
      const [prodRes, custRes, salesRes] = await Promise.all([
        api.get('/products/'), api.get('/customers/'), api.get('/sales/') 
      ]);
      setProducts(prodRes.data);
      setCustomers(custRes.data);
      setSalesHistory(salesRes.data);
    } catch (error) {
      if (error.response && error.response.status === 401) {
          localStorage.removeItem('token'); setToken(null);
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
          setToken(response.data.access_token);
      } catch (error) { showFeedback('Erro no login', 'error'); }
  };

  const handleLogout = () => {
      localStorage.removeItem('token'); setToken(null); setCart([]);
  };

  // --- CÁLCULOS DO DASHBOARD ---
  
  // 1. Métricas de Estoque e Lucro
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

  // 2. Ranking de Clientes (Top 5)
  const topCustomers = useMemo(() => {
      const ranking = {};
      salesHistory.forEach(sale => {
          if (!sale.customer) return;
          const name = sale.customer.name;
          ranking[name] = (ranking[name] || 0) + sale.total_value;
      });
      return Object.entries(ranking)
          .map(([name, total]) => ({ name, total }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 5);
  }, [salesHistory]);

  // 3. Dados do Gráfico (CORRIGIDO: ORDEM CRESCENTE)
  const chartData = useMemo(() => {
      const cutoffDate = subDays(new Date(), daysFilter);
      const dailyData = {};

      salesHistory.forEach(sale => {
          const saleDate = parseISO(sale.created_at);
          if (!isAfter(saleDate, cutoffDate)) return;

          // Usamos formato YYYY-MM-DD para garantir a ordenação correta depois
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

      // Transforma em array, ordena pela data (chave) e depois formata para exibir (dd/MM)
      return Object.entries(dailyData)
          .sort((a, b) => a[0].localeCompare(b[0])) // Ordenação Crescente (10 -> 15)
          .map(([date, total]) => ({ 
              day: format(parseISO(date), 'dd/MM'), 
              total 
          }));
  }, [salesHistory, daysFilter, productFilter]);

  // Totais Gerais
  const totalSold = salesHistory.reduce((acc, sale) => acc + sale.total_value, 0);
  const totalDebtCurrent = customers.reduce((acc, customer) => acc + customer.debt, 0);
  const totalCash = totalSold - totalDebtCurrent;

  // Filtros de Listas
  const filteredCustomers = customers.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  const filteredProducts = products.filter(p => p.name.toLowerCase().includes(searchTermProduct.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));

  // --- FUNÇÕES DE AÇÃO ---
  const addToCart = (p) => {
    if (p.stock <= 0) return showFeedback('Sem estoque!', 'warning');
    setCart([...cart, { ...p, cartId: Date.now() }]);
  };
  const removeFromCart = (id) => setCart(cart.filter(i => i.cartId !== id));
  
  const handleFinishSale = async (isPaid) => {
      if (!selectedCustomer) return showFeedback('Selecione cliente!', 'warning');
      if (cart.length === 0) return showFeedback('Carrinho vazio!', 'warning');
      try {
        await api.post('/sales/', { customer_id: parseInt(selectedCustomer), product_ids: cart.map(p => p.id), is_paid: isPaid });
        showFeedback(isPaid ? "Venda recebida!" : "FIADO anotado!", isPaid ? 'success' : 'info');
        setCart([]); fetchData();
      } catch { showFeedback('Erro na venda.', 'error'); }
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
    if(!newClientName) return;
    await api.post('/customers/', { name: newClientName });
    setOpenNewClientDialog(false); setNewClientName(''); fetchData();
  };

  const handleCreateProduct = async () => {
    if (!newProduct.name || !newProduct.sell_price) return showFeedback('Dados incompletos', 'warning');
    await api.post('/products/', { ...newProduct, cost_price: parseFloat(newProduct.cost_price||0), sell_price: parseFloat(newProduct.sell_price), stock: parseInt(newProduct.stock||0) });
    setOpenProductDialog(false); setNewProduct({ name: '', cost_price: '', sell_price: '', stock: '' }); fetchData();
  };

  const handleSaveEdit = async () => {
      await api.put(`/products/${editProductData.id}`, editProductData);
      setOpenEditProductDialog(false); fetchData();
  };

  const handleProductSelect = (event, value) => {
    if (value) {
        const existing = products.find(p => p.name === value);
        if (existing) {
            setNewProduct({ ...newProduct, name: existing.name, sell_price: existing.sell_price, cost_price: '', stock: '' });
        } else {
            setNewProduct({ ...newProduct, name: value });
        }
    }
  };

  // --- TELA DE LOGIN ---
  if (!token) {
      return (
          <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh" bgcolor="#f5f5f5">
              <Paper elevation={6} sx={{ p: 5, width: 380, textAlign: 'center', borderRadius: 4 }}>
                  <Box sx={{ mb: 2, display: 'flex', justifyContent: 'center' }}><LocalBar sx={{ fontSize: 50, color: '#1a237e' }} /></Box>
                  <Typography variant="h4" fontWeight="900" color="#1a237e">NETO BEBIDAS</Typography>
                  <Box component="form" sx={{ mt: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <TextField label="Usuário" fullWidth onChange={(e) => setAuthForm({...authForm, username: e.target.value})}/>
                      <TextField label="Senha" type="password" fullWidth onChange={(e) => setAuthForm({...authForm, password: e.target.value})} onKeyDown={(e) => e.key === 'Enter' && handleLogin()}/>
                      <Button variant="contained" size="large" onClick={handleLogin} sx={{ bgcolor: '#1a237e', py: 1.5 }}>ENTRAR</Button>
                  </Box>
              </Paper>
              <Snackbar open={feedback.open} autoHideDuration={4000} onClose={() => setFeedback({...feedback, open: false})}><Alert severity={feedback.severity}>{feedback.message}</Alert></Snackbar>
          </Box>
      );
  }

  return (
    <Box sx={{ flexGrow: 1, bgcolor: '#f0f2f5', minHeight: '100vh', pb: 5 }}>
      <AppBar position="static" sx={{ bgcolor: '#1a237e' }}>
        <Toolbar>
          <LocalBar sx={{ mr: 2 }} />
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 'bold' }}>NETO BEBIDAS</Typography>
          <IconButton color="inherit" onClick={handleLogout}><Logout /></IconButton>
        </Toolbar>
        <Tabs value={tabValue} onChange={(e, v) => setTabValue(v)} textColor="inherit" indicatorColor="secondary" centered>
            <Tab label="Resumo" icon={<Assessment/>} />
            <Tab label="Vender" icon={<ShoppingCart/>} />
            <Tab label="Clientes" icon={<PersonAdd/>} />
            <Tab label="Estoque" icon={<Inventory/>} />
        </Tabs>
      </AppBar>

      <Container maxWidth="xl" sx={{ mt: 4 }}>
        
        {/* === ABA RESUMO === */}
        {tabValue === 0 && (
          <Grid container spacing={3}>
            {/* 1. KPI CARDS (FINANCEIRO) */}
            <Grid item xs={12} md={3}><Paper sx={{ p: 2, borderLeft: '5px solid #2196f3' }}><Typography variant="caption" color="text.secondary">Total Vendido</Typography><Typography variant="h5" fontWeight="bold">R$ {totalSold.toFixed(2)}</Typography></Paper></Grid>
            <Grid item xs={12} md={3}><Paper sx={{ p: 2, borderLeft: '5px solid #4caf50' }}><Typography variant="caption" color="text.secondary">Dinheiro em Caixa</Typography><Typography variant="h5" fontWeight="bold" color="success.main">R$ {totalCash.toFixed(2)}</Typography></Paper></Grid>
            <Grid item xs={12} md={3}><Paper sx={{ p: 2, borderLeft: '5px solid #ff9800' }}><Typography variant="caption" color="text.secondary">Custo Estoque</Typography><Typography variant="h5" fontWeight="bold">R$ {stockMetrics.totalCost.toFixed(2)}</Typography><Storage sx={{ float: 'right', mt: -3, opacity: 0.3 }}/></Paper></Grid>
            <Grid item xs={12} md={3}><Paper sx={{ p: 2, borderLeft: '5px solid #9c27b0' }}><Typography variant="caption" color="text.secondary">Lucro Potencial</Typography><Typography variant="h5" fontWeight="bold" color="secondary">R$ {stockMetrics.potentialProfit.toFixed(2)}</Typography><TrendingUp sx={{ float: 'right', mt: -3, opacity: 0.3 }}/></Paper></Grid>

            {/* 2. GRÁFICO E RANKING */}
            <Grid item xs={12} md={8}>
                <Paper sx={{ p: 3, height: 400, display: 'flex', flexDirection: 'column' }}>
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                        <Typography variant="h6">Vendas por Período</Typography>
                        <Box display="flex" gap={2}>
                            <Autocomplete options={products} getOptionLabel={(p) => p.name} value={productFilter} onChange={(e, v) => setProductFilter(v)} renderInput={(params) => <TextField {...params} label="Filtrar Produto" size="small" sx={{ width: 200 }} />} size="small" />
                            <FormControl size="small">
                                <Select value={daysFilter} onChange={(e) => setDaysFilter(e.target.value)}>
                                    <MenuItem value={7}>7 Dias</MenuItem>
                                    <MenuItem value={15}>15 Dias</MenuItem>
                                    <MenuItem value={30}>30 Dias</MenuItem>
                                </Select>
                            </FormControl>
                        </Box>
                    </Box>
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="day" />
                            <YAxis prefix="R$ " />
                            <RechartsTooltip formatter={(value) => `R$ ${value.toFixed(2)}`} />
                            <Legend />
                            <Bar dataKey="total" name={productFilter ? productFilter.name : "Vendas Totais"} fill="#1a237e" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </Paper>
            </Grid>

            <Grid item xs={12} md={4}>
                <Paper sx={{ p: 2, height: 400, overflow: 'auto' }}>
                    <Typography variant="h6" gutterBottom>🏆 Top Clientes</Typography>
                    <Table size="small">
                        <TableHead><TableRow><TableCell>Cliente</TableCell><TableCell align="right">Comprou</TableCell></TableRow></TableHead>
                        <TableBody>
                            {topCustomers.map((c, i) => (
                                <TableRow key={i}>
                                    <TableCell>{i === 0 && '🥇'} {i === 1 && '🥈'} {i === 2 && '🥉'} {c.name}</TableCell>
                                    <TableCell align="right" sx={{ fontWeight: 'bold' }}>R$ {c.total.toFixed(2)}</TableCell>
                                </TableRow>
                            ))}
                            {topCustomers.length === 0 && <TableRow><TableCell colSpan={2} align="center">Sem dados</TableCell></TableRow>}
                        </TableBody>
                    </Table>
                </Paper>
            </Grid>

            {/* 3. HISTÓRICO DE VENDAS (MANTIDO DO ANTIGO) */}
            <Grid item xs={12}>
                <Paper sx={{ p: 2 }}>
                    <Typography variant="h6" gutterBottom>Histórico Completo de Vendas</Typography>
                    <TableContainer sx={{ maxHeight: 300 }}>
                        <Table stickyHeader size="small">
                            <TableHead><TableRow><TableCell>Data</TableCell><TableCell>Cliente</TableCell><TableCell>Valor</TableCell><TableCell>Status</TableCell></TableRow></TableHead>
                            <TableBody>
                                {salesHistory.map((sale) => (
                                    <TableRow key={sale.id}>
                                        <TableCell>{new Date(sale.created_at).toLocaleString()}</TableCell>
                                        <TableCell>{sale.customer?.name || '---'}</TableCell>
                                        <TableCell>R$ {sale.total_value.toFixed(2)}</TableCell>
                                        <TableCell><Chip label={sale.is_paid ? "PAGO NA HORA" : "FIADO"} color={sale.is_paid ? "success" : "warning"} size="small" variant="outlined"/></TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Paper>
            </Grid>
          </Grid>
        )}

        {/* ABA VENDAS */}
        {tabValue === 1 && (
          <Grid container spacing={3}>
            <Grid item xs={12} md={8}>
              <Paper sx={{ p: 2, mb: 2 }}>
                  <TextField fullWidth variant="standard" placeholder="Buscar produto..." value={searchTermProduct} onChange={(e) => setSearchTermProduct(e.target.value)} InputProps={{ startAdornment: <Search sx={{ mr: 1, color:'action.active' }} /> }} />
              </Paper>
              <Grid container spacing={2}>
                {filteredProducts.map((p) => (
                  <Grid item xs={6} sm={4} md={3} key={p.id}>
                    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', opacity: p.stock > 0 ? 1 : 0.6 }}>
                      <CardContent sx={{ flexGrow: 1, p: 1 }}><Typography fontWeight="bold" noWrap>{p.name}</Typography><Typography variant="caption">Estoque: {p.stock}</Typography><Typography variant="h6" color="primary">R$ {p.sell_price.toFixed(2)}</Typography></CardContent>
                      <CardActions><Button fullWidth variant="contained" disabled={p.stock <= 0} onClick={() => addToCart(p)} size="small">Vender</Button></CardActions>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </Grid>
            <Grid item xs={12} md={4}>
              <Paper sx={{ p: 2, position: 'sticky', top: 20 }}>
                <Typography variant="h6" gutterBottom><ShoppingCart/> Carrinho</Typography>
                <Autocomplete options={customers} getOptionLabel={(o) => o.name} onChange={(e, v) => setSelectedCustomer(v ? v.id : '')} renderInput={(params) => <TextField {...params} label="Cliente" size="small" />} sx={{ mb: 2 }}/>
                <List dense sx={{ maxHeight: 200, overflow: 'auto', bgcolor: '#fafafa', mb: 2 }}>
                    {cart.map((item) => (<ListItem key={item.cartId} secondaryAction={<IconButton size="small" onClick={() => removeFromCart(item.cartId)} color="error"><Delete/></IconButton>}><ListItemText primary={item.name} secondary={`R$ ${item.sell_price.toFixed(2)}`} /></ListItem>))}
                </List>
                <Typography variant="h5" align="right" sx={{ fontWeight:'bold', mb: 2 }}>Total: R$ {cart.reduce((a, b) => a + b.sell_price, 0).toFixed(2)}</Typography>
                <Box display="flex" gap={1}><Button fullWidth variant="contained" color="error" onClick={() => handleFinishSale(false)}>FIADO</Button><Button fullWidth variant="contained" color="success" onClick={() => handleFinishSale(true)}>RECEBER</Button></Box>
              </Paper>
            </Grid>
          </Grid>
        )}

        {/* ABA CLIENTES */}
        {tabValue === 2 && (
          <Container maxWidth="md">
            <Box display="flex" justifyContent="space-between" mb={3}><Typography variant="h5">Clientes</Typography><Button variant="contained" onClick={() => setOpenNewClientDialog(true)} startIcon={<PersonAdd/>}>Novo</Button></Box>
            <Paper sx={{ p: 2, mb: 2 }}><TextField fullWidth variant="standard" placeholder="Pesquisar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} InputProps={{ startAdornment: <Search sx={{ mr: 1, color:'action.active' }} /> }}/></Paper>
            <TableContainer component={Paper}><Table><TableHead sx={{ bgcolor: '#eee' }}><TableRow><TableCell>Nome</TableCell><TableCell align="right">Dívida</TableCell><TableCell align="center">Ação</TableCell></TableRow></TableHead>
                <TableBody>{filteredCustomers.map((row) => (<TableRow key={row.id}><TableCell>{row.name}</TableCell><TableCell align="right" sx={{ fontWeight: 'bold', color: row.debt > 0 ? 'red' : 'green' }}>R$ {row.debt.toFixed(2)}</TableCell><TableCell align="center">{row.debt > 0 ? <Button size="small" variant="outlined" color="success" onClick={() => { setPayData({ customerId: row.id, customerName: row.name, amount: '' }); setOpenPayDialog(true); }}>Pagar</Button> : <Chip label="OK" color="success" size="small"/>}</TableCell></TableRow>))}</TableBody>
            </Table></TableContainer>
          </Container>
        )}

        {/* ABA ESTOQUE */}
        {tabValue === 3 && (
            <Container maxWidth="lg">
                <Box display="flex" justifyContent="space-between" mb={3}><Typography variant="h5">Estoque</Typography><Button variant="contained" onClick={() => setOpenProductDialog(true)} startIcon={<Add/>}>Adicionar</Button></Box>
                <TableContainer component={Paper}><Table size="small"><TableHead sx={{ bgcolor: '#eee' }}><TableRow><TableCell>Produto</TableCell><TableCell align="right">Custo</TableCell><TableCell align="right">Venda</TableCell><TableCell align="center">Qtd</TableCell><TableCell align="center">Editar</TableCell></TableRow></TableHead>
                        <TableBody>{products.map((p) => (<TableRow key={p.id}><TableCell>{p.name}</TableCell><TableCell align="right">{p.cost_price.toFixed(2)}</TableCell><TableCell align="right">{p.sell_price.toFixed(2)}</TableCell><TableCell align="center"><Badge color={p.stock < 5 ? "error" : "primary"} badgeContent={p.stock} showZero><Inventory color="action"/></Badge></TableCell><TableCell align="center"><IconButton size="small" onClick={() => { setEditProductData(p); setOpenEditProductDialog(true); }}><Edit/></IconButton></TableCell></TableRow>))}</TableBody>
                </Table></TableContainer>
            </Container>
        )}
      </Container>

      {/* MODAIS */}
      <Dialog open={openNewClientDialog} onClose={() => setOpenNewClientDialog(false)}><DialogContent><TextField autoFocus margin="dense" label="Nome" fullWidth value={newClientName} onChange={(e) => setNewClientName(e.target.value)} /></DialogContent><DialogActions><Button onClick={handleCreateCustomer}>Salvar</Button></DialogActions></Dialog>
      
      <Dialog open={openProductDialog} onClose={() => setOpenProductDialog(false)} fullWidth maxWidth="sm">
        <DialogTitle>Novo Produto ou Abastecimento</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
            <Box mb={2}>
              <Autocomplete freeSolo options={products.map((option) => option.name)} value={newProduct.name} onInputChange={(event, newInputValue) => setNewProduct(prev => ({ ...prev, name: newInputValue }))} onChange={(event, newValue) => handleProductSelect(event, newValue)} renderInput={(params) => (<TextField {...params} label="Nome do Produto" placeholder="Selecione ou digite um novo..." helperText="Se selecionar um existente, será considerado um abastecimento." fullWidth />)} />
            </Box>
            <Box display="flex" gap={2} mt={1}><TextField label="Custo (Deste Lote)" type="number" fullWidth value={newProduct.cost_price} onChange={(e) => setNewProduct({...newProduct, cost_price: e.target.value})} helperText="Informe o custo unitário desta nova compra." /><TextField label="Venda (Atualizar)" type="number" fullWidth value={newProduct.sell_price} onChange={(e) => setNewProduct({...newProduct, sell_price: e.target.value})} /></Box>
            <TextField margin="dense" label="Quantidade (Adicionar)" type="number" fullWidth sx={{mt:2}} value={newProduct.stock} onChange={(e) => setNewProduct({...newProduct, stock: e.target.value})} />
        </DialogContent>
        <DialogActions><Button onClick={() => setOpenProductDialog(false)}>Cancelar</Button><Button onClick={handleCreateProduct} variant="contained">Salvar</Button></DialogActions>
      </Dialog>

      <Dialog open={openEditProductDialog} onClose={() => setOpenEditProductDialog(false)} fullWidth maxWidth="sm"><DialogTitle>Editar Produto</DialogTitle><DialogContent sx={{ pt: 2 }}><TextField margin="dense" label="Nome" fullWidth value={editProductData.name} onChange={(e) => setEditProductData({...editProductData, name: e.target.value})} /><Box display="flex" gap={2} mt={1}><TextField label="Custo Médio" type="number" fullWidth value={editProductData.cost_price} onChange={(e) => setEditProductData({...editProductData, cost_price: e.target.value})} /><TextField label="Venda" type="number" fullWidth value={editProductData.sell_price} onChange={(e) => setEditProductData({...editProductData, sell_price: e.target.value})} /></Box><TextField margin="dense" label="Estoque Atual (Correção)" type="number" fullWidth sx={{mt:2}} value={editProductData.stock} onChange={(e) => setEditProductData({...editProductData, stock: e.target.value})} helperText="Cuidado: isso altera diretamente a quantidade." /></DialogContent><DialogActions><Button onClick={() => setOpenEditProductDialog(false)}>Cancelar</Button><Button onClick={handleSaveEdit} variant="contained" color="primary">Salvar Alterações</Button></DialogActions></Dialog>
      
      <Dialog open={openPayDialog} onClose={() => setOpenPayDialog(false)}><DialogContent><TextField label="Valor (R$)" type="number" fullWidth value={payData.amount} onChange={(e) => setPayData({...payData, amount: e.target.value})}/></DialogContent><DialogActions><Button onClick={handlePayDebt}>Pagar</Button></DialogActions></Dialog>
      <Snackbar open={feedback.open} autoHideDuration={4000} onClose={() => setFeedback({...feedback, open: false})}><Alert severity={feedback.severity}>{feedback.message}</Alert></Snackbar>
    </Box>
  );
}
export default App;