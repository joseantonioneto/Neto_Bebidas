# backend/main.py
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy import create_engine, Column, Integer, String, Float, Boolean, ForeignKey, DateTime
from sqlalchemy.orm import sessionmaker, Session, relationship, joinedload, declarative_base
from pydantic import BaseModel
from datetime import datetime, timedelta
from typing import List, Optional
from passlib.context import CryptContext
from jose import JWTError, jwt

# --- CONFIGURAÇÕES GERAIS ---
SECRET_KEY = "netobebidas-chave-secreta-mude-isso-em-producao"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 600 # Login dura 10 horas

DATABASE_URL = "sqlite:///./netobebidas.db"

# --- BANCO DE DADOS ---
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# --- SEGURANÇA ---
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

app = FastAPI(title="Neto Bebidas API")

# --- CORS (Permitir acesso do Frontend) ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- MODELOS (TABELAS DO BANCO) ---
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    hashed_password = Column(String)

class Product(Base):
    __tablename__ = "products"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    cost_price = Column(Float)
    sell_price = Column(Float)
    stock = Column(Integer)

class Customer(Base):
    __tablename__ = "customers"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    debt = Column(Float, default=0.0)

class Sale(Base):
    __tablename__ = "sales"
    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"))
    total_value = Column(Float)
    is_paid = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    customer = relationship("Customer")

# --- SCHEMAS (DADOS QUE O FRONTEND ENVIA) ---
class UserCreate(BaseModel):
    username: str
    password: str

class ProductCreate(BaseModel):
    name: str
    cost_price: float
    sell_price: float
    stock: int

# Schema para Atualização (Edição)
class ProductUpdate(BaseModel):
    name: Optional[str] = None
    cost_price: Optional[float] = None
    sell_price: Optional[float] = None
    stock: Optional[int] = None

class CustomerCreate(BaseModel):
    name: str

class DebtPayment(BaseModel):
    amount: float

class SaleCreate(BaseModel):
    customer_id: int
    product_ids: List[int]
    is_paid: bool

# --- FUNÇÕES AUXILIARES ---
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenciais inválidas",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise credentials_exception
    return user

# Cria tabelas se não existirem
Base.metadata.create_all(bind=engine)


# --- ROTAS DA API ---

# 1. Login (Gerar Token)
@app.post("/token")
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not pwd_context.verify(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Usuário ou senha incorretos")
    
    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer"}

# 2. Criar Usuário (Rode uma vez para criar seu login)
@app.post("/users/")
def create_user(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Usuário já existe")
    
    hashed_password = pwd_context.hash(user.password)
    new_user = User(username=user.username, hashed_password=hashed_password)
    db.add(new_user)
    db.commit()
    return {"message": "Usuário criado com sucesso"}


# --- ROTAS PROTEGIDAS (Exigem Login) ---

# Produtos
@app.get("/products/")
def read_products(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Product).all()

@app.post("/products/")
def create_product(product: ProductCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    product_name = product.name.strip()
    existing_product = db.query(Product).filter(Product.name == product_name).first()

    if existing_product:
        # --- MODO ABASTECIMENTO (UPDATE INTELIGENTE) ---
        current_stock = max(existing_product.stock, 0)
        current_cost = existing_product.cost_price
        
        new_stock_added = product.stock
        new_cost = product.cost_price
        
        total_new_stock = current_stock + new_stock_added
        
        if total_new_stock > 0:
            total_value = (current_stock * current_cost) + (new_stock_added * new_cost)
            average_cost = total_value / total_new_stock
            existing_product.cost_price = round(average_cost, 2)
        else:
            existing_product.cost_price = new_cost

        existing_product.stock += new_stock_added
        existing_product.sell_price = product.sell_price
        
        db.commit()
        db.refresh(existing_product)
        return existing_product
    else:
        # --- MODO CRIAÇÃO ---
        db_product = Product(
            name=product_name, 
            cost_price=product.cost_price, 
            sell_price=product.sell_price, 
            stock=product.stock
        )
        db.add(db_product)
        db.commit()
        db.refresh(db_product)
        return db_product

# ROTA NOVA: Editar Produto (Para correções manuais)
@app.put("/products/{product_id}")
def update_product(product_id: int, product: ProductUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_product = db.query(Product).filter(Product.id == product_id).first()
    if not db_product:
        raise HTTPException(status_code=404, detail="Produto não encontrado")
    
    if product.name is not None:
        db_product.name = product.name
    if product.cost_price is not None:
        db_product.cost_price = product.cost_price
    if product.sell_price is not None:
        db_product.sell_price = product.sell_price
    if product.stock is not None:
        db_product.stock = product.stock
        
    db.commit()
    db.refresh(db_product)
    return db_product

# Clientes
@app.get("/customers/")
def list_customers(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Customer).all()

@app.post("/customers/")
def create_customer(customer: CustomerCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_customer = Customer(name=customer.name)
    db.add(db_customer)
    db.commit()
    return db_customer

@app.post("/customers/{customer_id}/pay/")
def pay_customer_debt(customer_id: int, payment: DebtPayment, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    customer = db.query(Customer).filter(Customer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    
    if payment.amount <= 0:
         raise HTTPException(status_code=400, detail="Valor deve ser positivo")

    customer.debt -= payment.amount
    db.commit()
    db.refresh(customer)
    return {"message": "Pagamento registrado", "new_debt": customer.debt, "customer": customer.name}

# Vendas
@app.get("/sales/")
def list_sales(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Sale).options(joinedload(Sale.customer)).order_by(Sale.created_at.desc()).all()

@app.post("/sales/")
def create_sale(sale: SaleCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    total = 0.0
    
    for p_id in sale.product_ids:
        product = db.query(Product).filter(Product.id == p_id).first()
        if not product:
            raise HTTPException(status_code=404, detail=f"Produto {p_id} não encontrado")
        if product.stock < 1:
            raise HTTPException(status_code=400, detail=f"Produto {product.name} sem estoque")
        
        total += product.sell_price
        product.stock -= 1
    
    db_sale = Sale(customer_id=sale.customer_id, total_value=total, is_paid=sale.is_paid)
    db.add(db_sale)
    
    if not sale.is_paid:
        cust = db.query(Customer).filter(Customer.id == sale.customer_id).first()
        cust.debt += total
    
    db.commit()
    return {"message": "Venda realizada"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)