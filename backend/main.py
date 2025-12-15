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
from collections import Counter

# --- CONFIGURAÇÕES ---
SECRET_KEY = "netobebidas-chave-secreta-mude-isso-em-producao"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 600

DATABASE_URL = "sqlite:///./netobebidas.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

app = FastAPI(title="Neto Bebidas API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- MODELOS DO BANCO ---
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
    items = relationship("SaleItem", back_populates="sale")

class SaleItem(Base):
    __tablename__ = "sale_items"
    id = Column(Integer, primary_key=True, index=True)
    sale_id = Column(Integer, ForeignKey("sales.id"))
    product_id = Column(Integer, ForeignKey("products.id"))
    quantity = Column(Integer)
    unit_sell_price = Column(Float) # Preço no momento da venda
    unit_cost_price = Column(Float) # Custo no momento da venda

    sale = relationship("Sale", back_populates="items")
    product = relationship("Product")

# --- SCHEMAS ---
class UserCreate(BaseModel):
    username: str
    password: str

class ProductCreate(BaseModel):
    name: str
    cost_price: float
    sell_price: float
    stock: int

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

# --- DEPENDÊNCIAS ---
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
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=401)
    except JWTError:
        raise HTTPException(status_code=401)
    
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=401)
    return user

Base.metadata.create_all(bind=engine)

# --- ROTAS ---

@app.post("/token")
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not pwd_context.verify(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Login incorreto")
    return {"access_token": create_access_token(data={"sub": user.username}), "token_type": "bearer"}

@app.post("/users/")
def create_user(user: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == user.username).first():
        raise HTTPException(status_code=400, detail="Usuário já existe")
    
    hashed_pwd = pwd_context.hash(user.password)
    db.add(User(username=user.username, hashed_password=hashed_pwd))
    db.commit()
    return {"message": "Criado"}

# Produtos
@app.get("/products/")
def read_products(db: Session = Depends(get_db), u: User = Depends(get_current_user)):
    return db.query(Product).all()

@app.post("/products/")
def create_product(p: ProductCreate, db: Session = Depends(get_db), u: User = Depends(get_current_user)):
    name = p.name.strip()
    existing = db.query(Product).filter(Product.name == name).first()
    
    if existing:
        # Custo Médio
        total_curr = max(existing.stock, 0) * existing.cost_price
        total_new = p.stock * p.cost_price
        new_qty = max(existing.stock, 0) + p.stock
        
        if new_qty > 0:
            existing.cost_price = (total_curr + total_new) / new_qty
        else:
            existing.cost_price = p.cost_price
            
        existing.stock += p.stock
        existing.sell_price = p.sell_price
        
        db.commit()
        db.refresh(existing)
        return existing
    
    new_p = Product(name=name, cost_price=p.cost_price, sell_price=p.sell_price, stock=p.stock)
    db.add(new_p)
    db.commit()
    db.refresh(new_p)
    return new_p

@app.put("/products/{id}")
def update_product(id: int, p: ProductUpdate, db: Session = Depends(get_db), u: User = Depends(get_current_user)):
    db_p = db.query(Product).filter(Product.id == id).first()
    if not db_p:
        raise HTTPException(status_code=404, detail="Produto não encontrado")
    
    if p.name:
        db_p.name = p.name
    if p.cost_price is not None:
        db_p.cost_price = p.cost_price
    if p.sell_price is not None:
        db_p.sell_price = p.sell_price
    if p.stock is not None:
        db_p.stock = p.stock
        
    db.commit()
    db.refresh(db_p)
    return db_p

# Clientes
@app.get("/customers/")
def list_customers(db: Session = Depends(get_db), u: User = Depends(get_current_user)):
    return db.query(Customer).all()

@app.post("/customers/")
def create_customer(c: CustomerCreate, db: Session = Depends(get_db), u: User = Depends(get_current_user)):
    db_c = Customer(name=c.name)
    db.add(db_c)
    db.commit()
    return {"message": "Cliente criado"}

@app.post("/customers/{id}/pay/")
def pay_debt(id: int, pay: DebtPayment, db: Session = Depends(get_db), u: User = Depends(get_current_user)):
    c = db.query(Customer).filter(Customer.id == id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    if pay.amount <= 0:
        raise HTTPException(status_code=400, detail="Valor inválido")
    
    c.debt -= pay.amount
    db.commit()
    return {"message": "Pago"}

# Vendas (Agora com Itens!)
@app.get("/sales/")
def list_sales(db: Session = Depends(get_db), u: User = Depends(get_current_user)):
    return db.query(Sale).options(
        joinedload(Sale.customer),
        joinedload(Sale.items).joinedload(SaleItem.product)
    ).order_by(Sale.created_at.desc()).all()

@app.post("/sales/")
def create_sale(sale: SaleCreate, db: Session = Depends(get_db), u: User = Depends(get_current_user)):
    total = 0.0
    product_counts = Counter(sale.product_ids)
    sale_items_data = []

    for p_id, qty in product_counts.items():
        product = db.query(Product).filter(Product.id == p_id).first()
        if not product:
            raise HTTPException(status_code=404, detail=f"Produto {p_id} não encontrado")
        if product.stock < qty:
            raise HTTPException(status_code=400, detail=f"Sem estoque: {product.name}")
        
        product.stock -= qty
        total += product.sell_price * qty
        sale_items_data.append({
            "product_id": p_id,
            "quantity": qty,
            "unit_sell": product.sell_price,
            "unit_cost": product.cost_price
        })

    db_sale = Sale(customer_id=sale.customer_id, total_value=total, is_paid=sale.is_paid)
    db.add(db_sale)
    db.flush() # Gera ID da venda

    for item in sale_items_data:
        db_item = SaleItem(
            sale_id=db_sale.id,
            product_id=item["product_id"],
            quantity=item["quantity"],
            unit_sell_price=item["unit_sell"],
            unit_cost_price=item["unit_cost"]
        )
        db.add(db_item)

    if not sale.is_paid:
        cust = db.query(Customer).filter(Customer.id == sale.customer_id).first()
        cust.debt += total

    db.commit()
    return {"message": "Venda realizada"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)