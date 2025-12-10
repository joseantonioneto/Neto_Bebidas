import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  AppBar, Toolbar, Typography, Button, Container, Grid, Paper, 
  Card, CardContent, CardActions, List, ListItem, ListItemText, 
  IconButton, Select, MenuItem, FormControl, InputLabel, 
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Box, Snackbar, Alert, Tab, Tabs, TextField, Dialog, DialogTitle, 
  DialogContent, DialogActions, Badge, Chip, InputAdornment
} from '@mui/material';

import { 
  ShoppingCart, AddCircle, Delete, PersonAdd, 
  Inventory, Add, Assessment, AttachMoney, MoneyOff, 
  Logout, Paid, LocalBar // <--- Ícone de Bebida importado aqui
} from '@mui/icons-material';

// --- Configuração da API ---
const api = axios.create({
  baseURL: 'http://ip:8000',
});

// Interceptor para adicionar o Token em toda requisição
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
}, (error) => Promise.reject(error));


function App() {
  // --- Estados de Autenticação ---
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [isLoginView, setIsLoginView] = useState(true); 
  const [authForm, setAuthForm] = useState({ username: '', password: '' });

  // --- Estados do Sistema ---
  const [tabValue, setTabValue] = useState(0); 
  const [cart, setCart] = useState([]);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [salesHistory, setSalesHistory] = useState([]); 
  const [selectedCustomer, setSelectedCustomer] = useState('');
  
  // --- Estados de Feedback e Dialogs ---
  const [feedback, setFeedback] = useState({ open: false, message: '', severity: 'success' });
  const [openNewClientDialog, setOpenNewClientDialog] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [openProductDialog, setOpenProductDialog] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: '', cost_price: '', sell_price: '', stock: '' });
  
  // Estado para Pagamento de Dívida
  const [openPayDialog, setOpenPayDialog] = useState(false);
  const [payData, setPayData] = useState({ customerId: null, customerName: '', amount: '' });

  // --- Efeito Inicial ---
  useEffect(() => {
    if (token) fetchData();
  }, [token]);

  const fetchData = async () => {
    try {
      const [prodRes, custRes, salesRes] = await Promise.all([
        api.get('/products/'),
        api.get('/customers/'),
        api.get('/sales/') 
      ]);
      setProducts(prodRes.data);
      setCustomers(custRes.data);
      setSalesHistory(salesRes.data);
    } catch (error) {
      if (error.response && error.response.status === 401) {
          handleLogout(); 
      }
    }
  };

  const showFeedback = (message, severity) => {
    setFeedback({ open: true, message, severity });
  };

  // --- AUTENTICAÇÃO ---
  const handleLogin = async () => {
      try {
          const formData = new FormData();
          formData.append('username', authForm.username);
          formData.append('password', authForm.password);
          
          const response = await api.post('/token', formData);
          const newToken = response.data.access_token;
          
          localStorage.setItem('token', newToken);
          setToken(newToken);
          showFeedback('Bem-vindo!', 'success');
      } catch (error) {
          showFeedback('Usuário ou senha incorretos', 'error');
      }
  };

  const handleRegister = async () => {
      try {
          await api.post('/users/', authForm);
          showFeedback('Conta criada! Faça login.', 'success');
          setIsLoginView(true); 
      } catch (error) {
          showFeedback('Erro ao criar usuário.', 'error');
      }
  };

  const handleLogout = () => {
      localStorage.removeItem('token');
      setToken(null);
      setCart([]);
  };

  // --- CÁLCULOS DO DASHBOARD ---
  const totalSold = salesHistory.reduce((acc, sale) => acc + sale.total_value, 0);
  const totalDebtCurrent = customers.reduce((acc, customer) => acc + customer.debt, 0);
  const totalCash = totalSold - totalDebtCurrent;

  // --- Funcionalidades do Sistema ---
  const addToCart = (product) => {
    if (product.stock <= 0) return showFeedback('Produto sem estoque!', 'warning');
    const countInCart = cart.filter(p => p.id === product.id).length;
    if (countInCart >= product.stock) return showFeedback('Estoque insuficiente!', 'warning');
    setCart([...cart, { ...product, cartId: Date.now() }]);
  };

  const removeFromCart = (cartId) => setCart(cart.filter(item => item.cartId !== cartId));

  const handleFinishSale = async (isPaid) => {
    if (!selectedCustomer) return showFeedback('Selecione um cliente!', 'warning');
    if (cart.length === 0) return showFeedback('Carrinho vazio!', 'warning');

    try {
      await api.post('/sales/', {
        customer_id: parseInt(selectedCustomer),
        product_ids: cart.map(p => p.id),
        is_paid: isPaid
      });
      showFeedback(isPaid ? "Venda recebida!" : "Marcado como FIADO!", isPaid ? 'success' : 'info');
      setCart([]); 
      fetchData();
    } catch (error) { showFeedback('Erro ao processar venda.', 'error'); }
  };

  const openPaymentModal = (customer) => {
      setPayData({ customerId: customer.id, customerName: customer.name, amount: '' });
      setOpenPayDialog(true);
  };

  const handlePayDebt = async () => {
      if (!payData.amount || parseFloat(payData.amount) <= 0) return showFeedback('Valor inválido', 'warning');
      try {
          await api.post(`/customers/${payData.customerId}/pay/`, { amount: parseFloat(payData.amount) });
          showFeedback(`Pagamento registrado!`, 'success');
          setOpenPayDialog(false);
          fetchData();
      } catch (error) {
          showFeedback('Erro ao registrar pagamento', 'error');
      }
  };

  const handleCreateCustomer = async () => {
    if(!newClientName) return;
    await api.post('/customers/', { name: newClientName });
    setOpenNewClientDialog(false); setNewClientName(''); fetchData();
  };

  const handleCreateProduct = async () => {
    if (!newProduct.name || !newProduct.sell_price) return showFeedback('Preencha os dados!', 'warning');
    await api.post('/products/', {
        name: newProduct.name, cost_price: parseFloat(newProduct.cost_price || 0),
        sell_price: parseFloat(newProduct.sell_price), stock: parseInt(newProduct.stock || 0)
    });
    setOpenProductDialog(false); setNewProduct({ name: '', cost_price: '', sell_price: '', stock: '' }); fetchData();
  };

  // --- TELA DE LOGIN ---
  if (!token) {
      return (
          <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh" bgcolor="#f5f5f5">
              <Paper elevation={6} sx={{ p: 5, width: 380, textAlign: 'center', borderRadius: 4 }}>
                  {/* ÍCONE E TÍTULO PERSONALIZADO */}
                  <Box sx={{ mb: 2, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 1 }}>
                    <LocalBar sx={{ fontSize: 50, color: '#1a237e' }} />
                  </Box>
                  <Typography variant="h4" fontWeight="900" color="#1a237e" sx={{ letterSpacing: -1 }}>
                    NETO BEBIDAS
                  </Typography>
                  <Typography variant="body2" color="text.secondary" gutterBottom sx={{ mb: 4 }}>
                    Sistema de Controle de Estoque
                  </Typography>
                  
                  <Box component="form" sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <TextField 
                        label="Usuário" variant="outlined" fullWidth 
                        value={authForm.username} onChange={(e) => setAuthForm({...authForm, username: e.target.value})}
                      />
                      <TextField 
                        label="Senha" type="password" variant="outlined" fullWidth 
                        value={authForm.password} onChange={(e) => setAuthForm({...authForm, password: e.target.value})}
                      />
                      
                      {isLoginView ? (
                          <Button variant="contained" size="large" onClick={handleLogin} sx={{ bgcolor: '#1a237e', py: 1.5, fontWeight: 'bold' }}>
                            ENTRAR NO SISTEMA
                          </Button>
                      ) : (
                          <Button variant="contained" color="secondary" size="large" onClick={handleRegister} sx={{ py: 1.5 }}>
                            CRIAR CONTA
                          </Button>
                      )}
                      
                      <Button size="small" onClick={() => setIsLoginView(!isLoginView)} sx={{ mt: 1 }}>
                          {isLoginView ? 'Primeiro acesso? Cadastre-se' : 'Já tenho conta. Fazer Login'}
                      </Button>
                  </Box>
              </Paper>
              <Snackbar open={feedback.open} autoHideDuration={4000} onClose={() => setFeedback({...feedback, open: false})}>
                <Alert severity={feedback.severity}>{feedback.message}</Alert>
              </Snackbar>
          </Box>
      );
  }

  // --- TELA PRINCIPAL (DASHBOARD) ---
  return (
    <Box sx={{ flexGrow: 1, bgcolor: '#f0f2f5', minHeight: '100vh', pb: 5 }}>
      <AppBar position="static" sx={{ bgcolor: '#1a237e' }}>
        <Toolbar>
          <LocalBar sx={{ mr: 2 }} />
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 'bold', letterSpacing: 1 }}>
            NETO BEBIDAS
          </Typography>
          <IconButton color="inherit" onClick={handleLogout} title="Sair">
              <Logout />
          </IconButton>
        </Toolbar>
        <Tabs value={tabValue} onChange={(e, v) => setTabValue(v)} textColor="inherit" indicatorColor="secondary" centered>
            <Tab label="Resumo" icon={<Assessment/>} />
            <Tab label="Vender" icon={<ShoppingCart/>} />
            <Tab label="Clientes" icon={<PersonAdd/>} />
            <Tab label="Estoque" icon={<Inventory/>} />
        </Tabs>
      </AppBar>

      <Container maxWidth="xl" sx={{ mt: 4 }}>
        
        {/* === RESUMO === */}
        {tabValue === 0 && (
          <Grid container spacing={3}>
            <Grid item xs={12} md={4}>
                <Paper sx={{ p: 3, borderLeft: '6px solid #2196f3' }}>
                    <Typography color="text.secondary">Vendas Totais</Typography>
                    <Typography variant="h4" fontWeight="bold">R$ {totalSold.toFixed(2)}</Typography>
                </Paper>
            </Grid>
            <Grid item xs={12} md={4}>
                <Paper sx={{ p: 3, borderLeft: '6px solid #4caf50' }}>
                    <Typography color="text.secondary">Dinheiro no Caixa (Real)</Typography>
                    <Typography variant="h4" fontWeight="bold" color="success.main">R$ {totalCash.toFixed(2)}</Typography>
                    <AttachMoney sx={{ float: 'right', mt: -4, color: '#4caf50', opacity: 0.5 }}/>
                </Paper>
            </Grid>
            <Grid item xs={12} md={4}>
                <Paper sx={{ p: 3, borderLeft: '6px solid #f44336' }}>
                    <Typography color="text.secondary">A Receber (Na Rua)</Typography>
                    <Typography variant="h4" fontWeight="bold" color="error.main">R$ {totalDebtCurrent.toFixed(2)}</Typography>
                    <MoneyOff sx={{ float: 'right', mt: -4, color: '#f44336', opacity: 0.5 }}/>
                </Paper>
            </Grid>
            <Grid item xs={12}>
                <Paper sx={{ p: 2 }}>
                    <Typography variant="h6" gutterBottom>Histórico de Vendas</Typography>
                    <TableContainer sx={{ maxHeight: 400 }}>
                        <Table stickyHeader size="small">
                            <TableHead><TableRow><TableCell>Data</TableCell><TableCell>Cliente</TableCell><TableCell>Valor</TableCell><TableCell>Status Original</TableCell></TableRow></TableHead>
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

        {/* === VENDAS === */}
        {tabValue === 1 && (
          <Grid container spacing={3}>
            <Grid item xs={12} md={8}>
              <Grid container spacing={2}>
                {products.map((product) => (
                  <Grid item xs={6} sm={4} md={3} key={product.id}>
                    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', opacity: product.stock > 0 ? 1 : 0.6 }}>
                      <CardContent sx={{ flexGrow: 1, p: 1 }}>
                        <Typography fontWeight="bold" noWrap>{product.name}</Typography>
                        <Typography variant="caption">Estoque: {product.stock}</Typography>
                        <Typography variant="h6" color="primary">R$ {product.sell_price.toFixed(2)}</Typography>
                      </CardContent>
                      <CardActions><Button fullWidth variant="contained" disabled={product.stock <= 0} onClick={() => addToCart(product)} size="small">Vender</Button></CardActions>
                    </Card>
                  </Grid>
                ))}
              </Grid>
            </Grid>
            <Grid item xs={12} md={4}>
              <Paper sx={{ p: 2, position: 'sticky', top: 20 }}>
                <Typography variant="h6" gutterBottom><ShoppingCart/> Carrinho</Typography>
                <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                  <InputLabel>Cliente</InputLabel>
                  <Select value={selectedCustomer} label="Cliente" onChange={(e) => setSelectedCustomer(e.target.value)}>
                    {customers.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
                  </Select>
                </FormControl>
                <List dense sx={{ maxHeight: 200, overflow: 'auto', bgcolor: '#fafafa', mb: 2 }}>
                    {cart.map((item) => (
                        <ListItem key={item.cartId} secondaryAction={<IconButton size="small" onClick={() => removeFromCart(item.cartId)} color="error"><Delete/></IconButton>}>
                            <ListItemText primary={item.name} secondary={`R$ ${item.sell_price.toFixed(2)}`} />
                        </ListItem>
                    ))}
                </List>
                <Typography variant="h5" align="right" sx={{ fontWeight:'bold', mb: 2 }}>
                    Total: R$ {cart.reduce((a, b) => a + b.sell_price, 0).toFixed(2)}
                </Typography>
                <Box display="flex" gap={1}>
                    <Button fullWidth variant="contained" color="error" onClick={() => handleFinishSale(false)}>FIADO</Button>
                    <Button fullWidth variant="contained" color="success" onClick={() => handleFinishSale(true)}>RECEBER</Button>
                </Box>
              </Paper>
            </Grid>
          </Grid>
        )}

        {/* === CLIENTES === */}
        {tabValue === 2 && (
          <Container maxWidth="md">
            <Box display="flex" justifyContent="space-between" mb={3}>
                <Typography variant="h5">Gerenciar Clientes</Typography>
                <Button variant="contained" onClick={() => setOpenNewClientDialog(true)} startIcon={<PersonAdd/>}>Novo</Button>
            </Box>
            <TableContainer component={Paper}>
              <Table>
                <TableHead sx={{ bgcolor: '#eee' }}><TableRow><TableCell>Nome</TableCell><TableCell align="right">Dívida Atual (R$)</TableCell><TableCell align="center">Ação</TableCell></TableRow></TableHead>
                <TableBody>
                  {customers.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.name}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold', color: row.debt > 0 ? 'red' : 'green' }}>R$ {row.debt.toFixed(2)}</TableCell>
                      <TableCell align="center">
                          {row.debt > 0 ? (
                              <Button size="small" variant="outlined" color="success" startIcon={<Paid/>} onClick={() => openPaymentModal(row)}>
                                  Pagar
                              </Button>
                          ) : <Chip label="Quitado" color="success" size="small" variant="outlined"/>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Container>
        )}

        {/* === ESTOQUE === */}
        {tabValue === 3 && (
            <Container maxWidth="lg">
                <Box display="flex" justifyContent="space-between" mb={3}>
                    <Typography variant="h5">Estoque</Typography>
                    <Button variant="contained" onClick={() => setOpenProductDialog(true)} startIcon={<Add/>}>Adicionar</Button>
                </Box>
                <TableContainer component={Paper}>
                    <Table size="small">
                        <TableHead sx={{ bgcolor: '#eee' }}>
                            <TableRow><TableCell>Produto</TableCell><TableCell align="right">Custo</TableCell><TableCell align="right">Venda</TableCell><TableCell align="center">Qtd</TableCell></TableRow>
                        </TableHead>
                        <TableBody>
                            {products.map((p) => (
                                <TableRow key={p.id}>
                                    <TableCell>{p.name}</TableCell><TableCell align="right">{p.cost_price.toFixed(2)}</TableCell><TableCell align="right">{p.sell_price.toFixed(2)}</TableCell>
                                    <TableCell align="center"><Badge color={p.stock < 5 ? "error" : "primary"} badgeContent={p.stock} showZero><Inventory color="action"/></Badge></TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            </Container>
        )}
      </Container>

      {/* --- MODAIS --- */}
      
      {/* 1. Novo Cliente */}
      <Dialog open={openNewClientDialog} onClose={() => setOpenNewClientDialog(false)}>
        <DialogTitle>Novo Cliente</DialogTitle>
        <DialogContent><TextField autoFocus margin="dense" label="Nome" fullWidth value={newClientName} onChange={(e) => setNewClientName(e.target.value)} /></DialogContent>
        <DialogActions><Button onClick={() => setOpenNewClientDialog(false)}>Cancelar</Button><Button onClick={handleCreateCustomer}>Salvar</Button></DialogActions>
      </Dialog>

      {/* 2. Novo Produto */}
      <Dialog open={openProductDialog} onClose={() => setOpenProductDialog(false)}>
        <DialogTitle>Novo Produto</DialogTitle>
        <DialogContent>
            <TextField margin="dense" label="Nome" fullWidth value={newProduct.name} onChange={(e) => setNewProduct({...newProduct, name: e.target.value})} />
            <Box display="flex" gap={2} mt={1}>
                <TextField label="Custo" type="number" fullWidth value={newProduct.cost_price} onChange={(e) => setNewProduct({...newProduct, cost_price: e.target.value})} />
                <TextField label="Venda" type="number" fullWidth value={newProduct.sell_price} onChange={(e) => setNewProduct({...newProduct, sell_price: e.target.value})} />
            </Box>
            <TextField margin="dense" label="Estoque" type="number" fullWidth sx={{mt:2}} value={newProduct.stock} onChange={(e) => setNewProduct({...newProduct, stock: e.target.value})} />
        </DialogContent>
        <DialogActions><Button onClick={() => setOpenProductDialog(false)}>Cancelar</Button><Button onClick={handleCreateProduct}>Salvar</Button></DialogActions>
      </Dialog>

      {/* 3. Pagar Dívida */}
      <Dialog open={openPayDialog} onClose={() => setOpenPayDialog(false)}>
          <DialogTitle>Quitar Dívida - {payData.customerName}</DialogTitle>
          <DialogContent>
              <Typography variant="body2" gutterBottom>Informe o valor que o cliente está pagando agora.</Typography>
              <TextField 
                autoFocus margin="dense" label="Valor Pago (R$)" type="number" fullWidth 
                InputProps={{ startAdornment: <InputAdornment position="start">R$</InputAdornment> }}
                value={payData.amount} onChange={(e) => setPayData({...payData, amount: e.target.value})}
              />
          </DialogContent>
          <DialogActions>
              <Button onClick={() => setOpenPayDialog(false)}>Cancelar</Button>
              <Button onClick={handlePayDebt} variant="contained" color="success">Confirmar Pagamento</Button>
          </DialogActions>
      </Dialog>

      {/* Feedback */}
      <Snackbar open={feedback.open} autoHideDuration={4000} onClose={() => setFeedback({...feedback, open: false})} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={feedback.severity} variant="filled">{feedback.message}</Alert>
      </Snackbar>

    </Box>
  );
}

export default App;