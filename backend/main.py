import os
import io
import csv
import uuid
from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy import create_engine, Column, Integer, String, Float, Boolean, ForeignKey, DateTime, Text
from sqlalchemy.orm import sessionmaker, Session, relationship, joinedload, declarative_base
from pydantic import BaseModel
from datetime import datetime, timedelta
from typing import List, Optional
from passlib.context import CryptContext
from jose import JWTError, jwt
from collections import Counter

SECRET_KEY = os.getenv("SECRET_KEY", "netobebidas-chave-secreta-mude-isso-em-producao")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("TOKEN_EXPIRE_MINUTES", "600"))
ADMIN_ROLE = "admin"
SELLER_ROLE = "vendedor"
VALID_ROLES = {ADMIN_ROLE, SELLER_ROLE}
PAYMENT_METHODS = {
    "dinheiro": "Dinheiro",
    "pix": "Pix",
    "cartao_debito": "Cartão de débito",
    "cartao_credito": "Cartão de crédito",
    "pagbank": "PagBank",
    "fiado": "Fiado"
}

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "sqlite:///./netobebidas.db"
)
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

app = FastAPI(title="Mercadinho Caminhar API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- MODELOS ---

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, index=True)
    hashed_password = Column(String(255))
    role = Column(String(20), default=SELLER_ROLE)


class Product(Base):
    __tablename__ = "products"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), index=True)
    category = Column(String(100), default="Geral")
    barcode = Column(String(100), unique=True, nullable=True, index=True)
    cost_price = Column(Float)
    sell_price = Column(Float)
    stock = Column(Integer)


class Customer(Base):
    __tablename__ = "customers"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), index=True)
    phone = Column(String(30), nullable=True)
    group_name = Column(String(100), nullable=True)
    debt = Column(Float, default=0.0)


class Sale(Base):
    __tablename__ = "sales"
    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"))
    seller_username = Column(String(100), nullable=True)
    total_value = Column(Float)
    is_paid = Column(Boolean, default=True)
    payment_method = Column(String(30), default="dinheiro")
    payment_status = Column(String(20), default="paid")
    payment_provider = Column(String(30), nullable=True)
    payment_reference = Column(String(200), nullable=True)
    event_day = Column(String(40), default="Dia 1")
    created_at = Column(DateTime, default=datetime.utcnow)

    customer = relationship("Customer")
    items = relationship("SaleItem", back_populates="sale")


class SaleItem(Base):
    __tablename__ = "sale_items"
    id = Column(Integer, primary_key=True, index=True)
    sale_id = Column(Integer, ForeignKey("sales.id"))
    product_id = Column(Integer, ForeignKey("products.id"))
    quantity = Column(Integer)
    unit_sell_price = Column(Float)
    unit_cost_price = Column(Float)

    sale = relationship("Sale", back_populates="items")
    product = relationship("Product")


# --- SCHEMAS ---

class UserCreate(BaseModel):
    username: str
    password: str
    role: str = SELLER_ROLE

class UserUpdate(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None

class ProductCreate(BaseModel):
    name: str
    cost_price: float
    sell_price: float
    stock: int
    category: Optional[str] = "Geral"
    barcode: Optional[str] = None

class ProductUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    cost_price: Optional[float] = None
    sell_price: Optional[float] = None
    stock: Optional[int] = None
    barcode: Optional[str] = None

class CustomerCreate(BaseModel):
    name: str
    phone: Optional[str] = None
    group_name: Optional[str] = None

class DebtPayment(BaseModel):
    amount: float

class SaleItemCreate(BaseModel):
    product_id: int
    quantity: int

class SaleCreate(BaseModel):
    customer_id: int
    product_ids: Optional[List[int]] = None
    items: Optional[List[SaleItemCreate]] = None
    is_paid: Optional[bool] = None
    payment_method: str = "dinheiro"
    event_day: Optional[str] = None
    payment_provider: Optional[str] = None
    payment_reference: Optional[str] = None

class PagBankPaymentIntentCreate(BaseModel):
    amount: float
    payment_method: str
    sale_code: Optional[str] = None
    terminal_mac_address: Optional[str] = None

class BulkCustomerItem(BaseModel):
    name: str
    phone: Optional[str] = None
    group_name: Optional[str] = None

class BulkCustomerCreate(BaseModel):
    customers: List[BulkCustomerItem]

class BulkProductItem(BaseModel):
    name: str
    category: Optional[str] = "Geral"
    barcode: Optional[str] = None
    cost_price: float
    sell_price: float
    stock: int

class BulkProductCreate(BaseModel):
    products: List[BulkProductItem]


# --- DEPENDENCIAS ---

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

def normalize_role(role: str):
    if role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="Perfil de usuário inválido")
    return role

def normalize_payment_method(payment_method: str):
    if payment_method not in PAYMENT_METHODS:
        raise HTTPException(status_code=400, detail="Forma de pagamento inválida")
    return payment_method

def normalize_event_day(event_day: Optional[str]):
    value = (event_day or "").strip()
    if not value:
        return None
    return value[:40]

def serialize_product(p: Product):
    return {
        "id": p.id,
        "name": p.name,
        "category": p.category or "Geral",
        "barcode": p.barcode,
        "cost_price": p.cost_price,
        "sell_price": p.sell_price,
        "stock": p.stock,
    }

def serialize_user(user: User):
    return {"id": user.id, "username": user.username, "role": user.role}

def serialize_customer(c: Customer):
    return {
        "id": c.id,
        "name": c.name,
        "phone": c.phone,
        "group_name": c.group_name,
        "debt": c.debt,
    }

def serialize_sale_item(item: SaleItem):
    return {
        "id": item.id,
        "sale_id": item.sale_id,
        "product_id": item.product_id,
        "quantity": item.quantity,
        "unit_sell_price": item.unit_sell_price,
        "unit_cost_price": item.unit_cost_price,
        "product": {
            "id": item.product.id,
            "name": item.product.name,
            "category": item.product.category or "Geral",
            "barcode": item.product.barcode,
        } if item.product else None
    }

def serialize_sale(sale: Sale):
    method = sale.payment_method or ("dinheiro" if sale.is_paid else "fiado")
    return {
        "id": sale.id,
        "customer_id": sale.customer_id,
        "seller_username": sale.seller_username,
        "total_value": sale.total_value,
        "is_paid": sale.is_paid,
        "payment_method": method,
        "payment_method_label": PAYMENT_METHODS.get(method, method),
        "payment_status": sale.payment_status or ("paid" if sale.is_paid else "pending"),
        "payment_provider": sale.payment_provider,
        "payment_reference": sale.payment_reference,
        "event_day": sale.event_day or "Dia 1",
        "sale_date": sale.created_at.date().isoformat(),
        "created_at": sale.created_at,
        "customer": serialize_customer(sale.customer) if sale.customer else None,
        "items": [serialize_sale_item(item) for item in sale.items]
    }

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
    if not user.role:
        user.role = ADMIN_ROLE
        db.commit()
        db.refresh(user)
    return user


Base.metadata.create_all(bind=engine)


def migrate_schema():
    with engine.begin() as conn:
        is_sqlite = DATABASE_URL.startswith("sqlite")

        if is_sqlite:
            user_columns = [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(users)").fetchall()]
            if "role" not in user_columns:
                conn.exec_driver_sql(f"ALTER TABLE users ADD COLUMN role VARCHAR DEFAULT '{ADMIN_ROLE}'")

            product_columns = [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(products)").fetchall()]
            if "category" not in product_columns:
                conn.exec_driver_sql("ALTER TABLE products ADD COLUMN category VARCHAR DEFAULT 'Geral'")
            if "barcode" not in product_columns:
                conn.exec_driver_sql("ALTER TABLE products ADD COLUMN barcode VARCHAR")

            customer_columns = [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(customers)").fetchall()]
            if "phone" not in customer_columns:
                conn.exec_driver_sql("ALTER TABLE customers ADD COLUMN phone VARCHAR")
            if "group_name" not in customer_columns:
                conn.exec_driver_sql("ALTER TABLE customers ADD COLUMN group_name VARCHAR")

            sale_columns = [row[1] for row in conn.exec_driver_sql("PRAGMA table_info(sales)").fetchall()]
            if "payment_method" not in sale_columns:
                conn.exec_driver_sql("ALTER TABLE sales ADD COLUMN payment_method VARCHAR")
            if "payment_status" not in sale_columns:
                conn.exec_driver_sql("ALTER TABLE sales ADD COLUMN payment_status VARCHAR")
            if "payment_provider" not in sale_columns:
                conn.exec_driver_sql("ALTER TABLE sales ADD COLUMN payment_provider VARCHAR")
            if "payment_reference" not in sale_columns:
                conn.exec_driver_sql("ALTER TABLE sales ADD COLUMN payment_reference VARCHAR")
            if "event_day" not in sale_columns:
                conn.exec_driver_sql("ALTER TABLE sales ADD COLUMN event_day VARCHAR DEFAULT 'Dia 1'")
            if "seller_username" not in sale_columns:
                conn.exec_driver_sql("ALTER TABLE sales ADD COLUMN seller_username VARCHAR")

        conn.exec_driver_sql(
            "UPDATE users SET role = 'admin' WHERE role IS NULL OR role = ''"
        )
        conn.exec_driver_sql(
            "UPDATE products SET category = 'Geral' WHERE category IS NULL OR category = ''"
        )
        conn.exec_driver_sql(
            "UPDATE sales SET payment_method = CASE WHEN is_paid = 1 THEN 'dinheiro' ELSE 'fiado' END "
            "WHERE payment_method IS NULL OR payment_method = ''"
        )
        conn.exec_driver_sql(
            "UPDATE sales SET payment_status = CASE WHEN is_paid = 1 THEN 'paid' ELSE 'pending' END "
            "WHERE payment_status IS NULL OR payment_status = ''"
        )
        conn.exec_driver_sql(
            "UPDATE sales SET event_day = 'Dia 1' WHERE event_day IS NULL OR event_day = ''"
        )


migrate_schema()


def require_admin(u: User = Depends(get_current_user)):
    if u.role != ADMIN_ROLE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Apenas administrador")
    return u

def require_seller_or_admin(u: User = Depends(get_current_user)):
    if u.role not in VALID_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Sem permissão")
    return u

def ensure_admin_will_remain(db: Session, user: User):
    admin_count = db.query(User).filter(User.role == ADMIN_ROLE).count()
    if user.role == ADMIN_ROLE and admin_count <= 1:
        raise HTTPException(status_code=400, detail="É preciso manter ao menos um administrador")


# --- ROTAS ---

@app.post("/token")
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not pwd_context.verify(form_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Login incorreto")
    return {
        "access_token": create_access_token(data={"sub": user.username, "role": user.role}),
        "token_type": "bearer",
        "user": serialize_user(user)
    }

@app.get("/me")
def read_me(u: User = Depends(get_current_user)):
    return serialize_user(u)


# --- USUARIOS ---

@app.get("/users/")
def list_users(db: Session = Depends(get_db), u: User = Depends(require_admin)):
    return [serialize_user(user) for user in db.query(User).order_by(User.username).all()]

@app.post("/users/")
def create_user(user: UserCreate, db: Session = Depends(get_db), u: User = Depends(require_admin)):
    username = user.username.strip()
    if not username or not user.password:
        raise HTTPException(status_code=400, detail="Informe usuário e senha")
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(status_code=400, detail="Usuário já existe")

    db_user = User(
        username=username,
        hashed_password=pwd_context.hash(user.password),
        role=normalize_role(user.role)
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return serialize_user(db_user)

@app.put("/users/{id}")
def update_user(id: int, user: UserUpdate, db: Session = Depends(get_db), u: User = Depends(require_admin)):
    db_user = db.query(User).filter(User.id == id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    if user.username is not None:
        username = user.username.strip()
        if not username:
            raise HTTPException(status_code=400, detail="Informe o usuário")
        if username != db_user.username:
            if db.query(User).filter(User.username == username).first():
                raise HTTPException(status_code=400, detail="Usuário já existe")
            db_user.username = username

    if user.password:
        db_user.hashed_password = pwd_context.hash(user.password)

    if user.role:
        new_role = normalize_role(user.role)
        if db_user.role == ADMIN_ROLE and new_role != ADMIN_ROLE:
            ensure_admin_will_remain(db, db_user)
        db_user.role = new_role

    db.commit()
    db.refresh(db_user)
    return serialize_user(db_user)

@app.delete("/users/{id}")
def delete_user(id: int, db: Session = Depends(get_db), u: User = Depends(require_admin)):
    db_user = db.query(User).filter(User.id == id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")
    if db_user.id == u.id:
        raise HTTPException(status_code=400, detail="Você não pode excluir o próprio usuário")
    if db_user.role == ADMIN_ROLE:
        ensure_admin_will_remain(db, db_user)

    db.delete(db_user)
    db.commit()
    return {"message": "Usuário excluído"}


# --- PRODUTOS ---

@app.get("/products/")
def read_products(db: Session = Depends(get_db), u: User = Depends(require_seller_or_admin)):
    return [serialize_product(p) for p in db.query(Product).order_by(Product.name).all()]

@app.get("/products/barcode/{barcode}")
def get_product_by_barcode(barcode: str, db: Session = Depends(get_db), u: User = Depends(require_seller_or_admin)):
    product = db.query(Product).filter(Product.barcode == barcode).first()
    if not product:
        raise HTTPException(status_code=404, detail="Produto não encontrado com este código")
    return serialize_product(product)

@app.post("/products/")
def create_product(p: ProductCreate, db: Session = Depends(get_db), u: User = Depends(require_seller_or_admin)):
    if u.role == SELLER_ROLE and p.stock < 0:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Vendedor só pode adicionar estoque")

    name = p.name.strip()
    category = (p.category or "Geral").strip() or "Geral"
    barcode = (p.barcode or "").strip() or None

    if barcode:
        existing_barcode = db.query(Product).filter(Product.barcode == barcode).first()
        if existing_barcode:
            total_curr = max(existing_barcode.stock, 0) * existing_barcode.cost_price
            total_new = p.stock * p.cost_price
            new_qty = max(existing_barcode.stock, 0) + p.stock
            if new_qty > 0:
                existing_barcode.cost_price = (total_curr + total_new) / new_qty
            else:
                existing_barcode.cost_price = p.cost_price
            existing_barcode.stock += p.stock
            existing_barcode.sell_price = p.sell_price
            existing_barcode.category = category
            if name:
                existing_barcode.name = name
            db.commit()
            db.refresh(existing_barcode)
            return serialize_product(existing_barcode)

    existing = db.query(Product).filter(Product.name == name).first()
    if existing:
        total_curr = max(existing.stock, 0) * existing.cost_price
        total_new = p.stock * p.cost_price
        new_qty = max(existing.stock, 0) + p.stock
        if new_qty > 0:
            existing.cost_price = (total_curr + total_new) / new_qty
        else:
            existing.cost_price = p.cost_price
        existing.stock += p.stock
        existing.sell_price = p.sell_price
        existing.category = category
        if barcode and not existing.barcode:
            existing.barcode = barcode
        db.commit()
        db.refresh(existing)
        return serialize_product(existing)

    new_p = Product(name=name, category=category, barcode=barcode, cost_price=p.cost_price, sell_price=p.sell_price, stock=p.stock)
    db.add(new_p)
    db.commit()
    db.refresh(new_p)
    return serialize_product(new_p)

@app.put("/products/{id}")
def update_product(id: int, p: ProductUpdate, db: Session = Depends(get_db), u: User = Depends(require_admin)):
    db_p = db.query(Product).filter(Product.id == id).first()
    if not db_p:
        raise HTTPException(status_code=404, detail="Produto não encontrado")

    if p.name:
        db_p.name = p.name
    if p.category:
        db_p.category = p.category
    if p.cost_price is not None:
        db_p.cost_price = p.cost_price
    if p.sell_price is not None:
        db_p.sell_price = p.sell_price
    if p.stock is not None:
        db_p.stock = p.stock
    if p.barcode is not None:
        db_p.barcode = p.barcode.strip() or None

    db.commit()
    db.refresh(db_p)
    return serialize_product(db_p)

@app.post("/products/generate-qrcode/{id}")
def generate_qr_for_product(id: int, db: Session = Depends(get_db), u: User = Depends(require_admin)):
    db_p = db.query(Product).filter(Product.id == id).first()
    if not db_p:
        raise HTTPException(status_code=404, detail="Produto não encontrado")
    if db_p.barcode:
        return {"barcode": db_p.barcode, "generated": False}
    code = f"MC-{db_p.id:05d}"
    db_p.barcode = code
    db.commit()
    return {"barcode": code, "generated": True}

@app.post("/products/bulk")
def bulk_create_products(data: BulkProductCreate, db: Session = Depends(get_db), u: User = Depends(require_admin)):
    created = 0
    updated = 0
    for item in data.products:
        name = item.name.strip()
        if not name:
            continue
        barcode = (item.barcode or "").strip() or None
        category = (item.category or "Geral").strip() or "Geral"

        existing = None
        if barcode:
            existing = db.query(Product).filter(Product.barcode == barcode).first()
        if not existing:
            existing = db.query(Product).filter(Product.name == name).first()

        if existing:
            total_curr = max(existing.stock, 0) * existing.cost_price
            total_new = item.stock * item.cost_price
            new_qty = max(existing.stock, 0) + item.stock
            if new_qty > 0:
                existing.cost_price = (total_curr + total_new) / new_qty
            else:
                existing.cost_price = item.cost_price
            existing.stock += item.stock
            existing.sell_price = item.sell_price
            existing.category = category
            if barcode and not existing.barcode:
                existing.barcode = barcode
            updated += 1
        else:
            new_p = Product(name=name, category=category, barcode=barcode,
                            cost_price=item.cost_price, sell_price=item.sell_price, stock=item.stock)
            db.add(new_p)
            created += 1

    db.commit()
    return {"message": f"{created} criados, {updated} atualizados", "created": created, "updated": updated}

@app.post("/products/import-nfe")
async def import_nfe(file: UploadFile = File(...), db: Session = Depends(get_db), u: User = Depends(require_admin)):
    if not file.filename.lower().endswith(".xml"):
        raise HTTPException(status_code=400, detail="Envie um arquivo XML de NF-e")

    from lxml import etree
    content = await file.read()
    try:
        root = etree.fromstring(content)
    except Exception:
        raise HTTPException(status_code=400, detail="XML inválido")

    ns = {"nfe": "http://www.portalfiscal.inf.br/nfe"}
    det_elements = root.findall(".//nfe:det", ns)
    if not det_elements:
        ns = {"nfe": ""}
        det_elements = root.findall(".//det")

    created = 0
    updated = 0
    items_imported = []

    for det in det_elements:
        prod = det.find("nfe:prod", ns) if ns["nfe"] else det.find("prod")
        if prod is None:
            continue

        def txt(tag):
            el = prod.find(f"nfe:{tag}", ns) if ns["nfe"] else prod.find(tag)
            return el.text.strip() if el is not None and el.text else ""

        name = txt("xProd")
        barcode_raw = txt("cEAN") or txt("cEANTrib")
        barcode = barcode_raw if barcode_raw and barcode_raw != "SEM GTIN" else None
        qty = float(txt("qCom") or "0")
        unit_cost = float(txt("vUnCom") or "0")
        total_val = float(txt("vProd") or "0")

        if not name:
            continue

        existing = None
        if barcode:
            existing = db.query(Product).filter(Product.barcode == barcode).first()
        if not existing:
            existing = db.query(Product).filter(Product.name == name).first()

        stock_add = max(int(qty), 1)

        if existing:
            total_curr = max(existing.stock, 0) * existing.cost_price
            total_new = stock_add * unit_cost
            new_qty = max(existing.stock, 0) + stock_add
            if new_qty > 0:
                existing.cost_price = (total_curr + total_new) / new_qty
            existing.stock += stock_add
            if barcode and not existing.barcode:
                existing.barcode = barcode
            updated += 1
            items_imported.append({"name": name, "qty": stock_add, "action": "atualizado"})
        else:
            sell_price = round(unit_cost * 1.5, 2)
            new_p = Product(name=name, category="NF-e", barcode=barcode,
                            cost_price=unit_cost, sell_price=sell_price, stock=stock_add)
            db.add(new_p)
            created += 1
            items_imported.append({"name": name, "qty": stock_add, "cost": unit_cost, "sell": sell_price, "action": "criado"})

    db.commit()
    return {
        "message": f"NF-e importada: {created} novos, {updated} atualizados",
        "created": created,
        "updated": updated,
        "items": items_imported,
    }


# --- CLIENTES ---

@app.get("/customers/")
def list_customers(db: Session = Depends(get_db), u: User = Depends(require_seller_or_admin)):
    return [serialize_customer(c) for c in db.query(Customer).order_by(Customer.name).all()]

@app.post("/customers/")
def create_customer(c: CustomerCreate, db: Session = Depends(get_db), u: User = Depends(require_seller_or_admin)):
    name = c.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Nome obrigatório")
    db_c = Customer(name=name, phone=c.phone, group_name=c.group_name)
    db.add(db_c)
    db.commit()
    db.refresh(db_c)
    return serialize_customer(db_c)

@app.put("/customers/{id}")
def update_customer(id: int, c: CustomerCreate, db: Session = Depends(get_db), u: User = Depends(require_seller_or_admin)):
    db_c = db.query(Customer).filter(Customer.id == id).first()
    if not db_c:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    name = c.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Nome obrigatório")
    db_c.name = name
    if c.phone is not None:
        db_c.phone = c.phone
    if c.group_name is not None:
        db_c.group_name = c.group_name
    db.commit()
    db.refresh(db_c)
    return serialize_customer(db_c)

@app.delete("/customers/{id}")
def delete_customer(id: int, db: Session = Depends(get_db), u: User = Depends(require_admin)):
    db_c = db.query(Customer).filter(Customer.id == id).first()
    if not db_c:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    if db_c.debt > 0:
        raise HTTPException(status_code=400, detail="Cliente possui dívida pendente")
    db.delete(db_c)
    db.commit()
    return {"message": "Cliente excluído"}

@app.post("/customers/{id}/pay/")
def pay_debt(id: int, pay: DebtPayment, db: Session = Depends(get_db), u: User = Depends(require_seller_or_admin)):
    c = db.query(Customer).filter(Customer.id == id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    if pay.amount <= 0:
        raise HTTPException(status_code=400, detail="Valor inválido")
    c.debt -= pay.amount
    db.commit()
    return {"message": "Pago"}

@app.post("/customers/bulk")
def bulk_create_customers(data: BulkCustomerCreate, db: Session = Depends(get_db), u: User = Depends(require_admin)):
    created = 0
    skipped = 0
    for item in data.customers:
        name = item.name.strip()
        if not name:
            skipped += 1
            continue
        existing = db.query(Customer).filter(Customer.name == name).first()
        if existing:
            if item.phone and not existing.phone:
                existing.phone = item.phone
            if item.group_name and not existing.group_name:
                existing.group_name = item.group_name
            skipped += 1
            continue
        db.add(Customer(name=name, phone=item.phone, group_name=item.group_name))
        created += 1
    db.commit()
    return {"message": f"{created} clientes importados, {skipped} ignorados", "created": created, "skipped": skipped}

@app.post("/customers/import-csv")
async def import_customers_csv(file: UploadFile = File(...), db: Session = Depends(get_db), u: User = Depends(require_admin)):
    content = await file.read()
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text), delimiter=";")

    created = 0
    skipped = 0
    for row in reader:
        name = (row.get("nome") or row.get("Nome") or row.get("name") or row.get("Name") or "").strip()
        if not name:
            skipped += 1
            continue
        phone = (row.get("telefone") or row.get("Telefone") or row.get("phone") or "").strip() or None
        group = (row.get("grupo") or row.get("Grupo") or row.get("group") or "").strip() or None

        existing = db.query(Customer).filter(Customer.name == name).first()
        if existing:
            if phone and not existing.phone:
                existing.phone = phone
            if group and not existing.group_name:
                existing.group_name = group
            skipped += 1
            continue
        db.add(Customer(name=name, phone=phone, group_name=group))
        created += 1
    db.commit()
    return {"message": f"{created} clientes importados, {skipped} ignorados/duplicados", "created": created, "skipped": skipped}


# --- VENDAS ---

@app.get("/sales/")
def list_sales(db: Session = Depends(get_db), u: User = Depends(require_admin)):
    sales = db.query(Sale).options(
        joinedload(Sale.customer),
        joinedload(Sale.items).joinedload(SaleItem.product)
    ).order_by(Sale.created_at.desc()).all()
    return [serialize_sale(sale) for sale in sales]

@app.post("/sales/")
def create_sale(sale: SaleCreate, db: Session = Depends(get_db), u: User = Depends(require_seller_or_admin)):
    total = 0.0
    payment_method = normalize_payment_method(sale.payment_method)
    event_day = normalize_event_day(sale.event_day)
    is_paid = payment_method != "fiado" if sale.is_paid is None else sale.is_paid
    if payment_method == "fiado":
        is_paid = False

    cust = db.query(Customer).filter(Customer.id == sale.customer_id).first()
    if not cust:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")

    if sale.items:
        product_counts = Counter()
        for item in sale.items:
            if item.quantity <= 0:
                raise HTTPException(status_code=400, detail="Quantidade inválida")
            product_counts[item.product_id] += item.quantity
    elif sale.product_ids:
        product_counts = Counter(sale.product_ids)
    else:
        raise HTTPException(status_code=400, detail="Carrinho vazio")

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

    db_sale = Sale(
        customer_id=sale.customer_id,
        seller_username=u.username,
        total_value=total,
        is_paid=is_paid,
        payment_method=payment_method,
        payment_status="paid" if is_paid else "pending",
        payment_provider=sale.payment_provider or ("pagbank" if payment_method == "pagbank" else None),
        payment_reference=sale.payment_reference,
        event_day=event_day
    )
    db.add(db_sale)
    db.flush()

    for item in sale_items_data:
        db.add(SaleItem(
            sale_id=db_sale.id,
            product_id=item["product_id"],
            quantity=item["quantity"],
            unit_sell_price=item["unit_sell"],
            unit_cost_price=item["unit_cost"]
        ))

    if not is_paid:
        cust.debt += total

    db.commit()
    db.refresh(db_sale)
    return {"message": "Venda realizada", "sale": serialize_sale(db_sale)}


# --- RELATORIOS ---

@app.get("/reports/summary")
def sales_summary(
    event_day: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
    u: User = Depends(require_admin)
):
    query = db.query(Sale).options(
        joinedload(Sale.customer),
        joinedload(Sale.items).joinedload(SaleItem.product)
    )

    if event_day:
        query = query.filter(Sale.event_day == event_day)
    if start_date:
        query = query.filter(Sale.created_at >= datetime.fromisoformat(start_date))
    if end_date:
        end = datetime.fromisoformat(end_date)
        if len(end_date) == 10:
            end = end.replace(hour=23, minute=59, second=59)
        query = query.filter(Sale.created_at <= end)

    sales = query.order_by(Sale.created_at.desc()).all()
    by_payment = {}
    by_event_day = {}
    by_product = {}
    by_seller = {}
    gross_total = 0.0
    cost_total = 0.0
    debt_total = 0.0

    for sale in sales:
        method = sale.payment_method or ("dinheiro" if sale.is_paid else "fiado")
        day = sale.created_at.strftime("%d/%m/%Y")
        sortable_day = sale.created_at.date().isoformat()
        gross_total += sale.total_value
        if not sale.is_paid:
            debt_total += sale.total_value

        by_payment.setdefault(method, {
            "payment_method": method,
            "label": PAYMENT_METHODS.get(method, method),
            "count": 0, "total": 0.0
        })
        by_payment[method]["count"] += 1
        by_payment[method]["total"] += sale.total_value

        by_event_day.setdefault(day, {"event_day": day, "date": sortable_day, "count": 0, "total": 0.0})
        by_event_day[day]["count"] += 1
        by_event_day[day]["total"] += sale.total_value

        seller = sale.seller_username or "desconhecido"
        by_seller.setdefault(seller, {"seller": seller, "count": 0, "total": 0.0})
        by_seller[seller]["count"] += 1
        by_seller[seller]["total"] += sale.total_value

        for item in sale.items:
            item_cost = item.quantity * item.unit_cost_price
            item_total = item.quantity * item.unit_sell_price
            cost_total += item_cost
            product_name = item.product.name if item.product else f"Produto {item.product_id}"
            category = item.product.category if item.product and item.product.category else "Geral"
            by_product.setdefault(item.product_id, {
                "product_id": item.product_id, "name": product_name,
                "category": category, "quantity": 0, "total": 0.0, "cost": 0.0
            })
            by_product[item.product_id]["quantity"] += item.quantity
            by_product[item.product_id]["total"] += item_total
            by_product[item.product_id]["cost"] += item_cost

    paid_total = gross_total - debt_total
    return {
        "filters": {"event_day": event_day, "start_date": start_date, "end_date": end_date},
        "totals": {
            "sales_count": len(sales),
            "gross_total": gross_total,
            "paid_total": paid_total,
            "debt_total": debt_total,
            "cost_total": cost_total,
            "profit_total": gross_total - cost_total
        },
        "by_payment_method": sorted(by_payment.values(), key=lambda row: row["label"]),
        "by_event_day": sorted(by_event_day.values(), key=lambda row: row["date"]),
        "by_seller": sorted(by_seller.values(), key=lambda row: row["total"], reverse=True),
        "top_products": sorted(by_product.values(), key=lambda row: row["total"], reverse=True),
        "sales": [serialize_sale(sale) for sale in sales]
    }


@app.get("/payment-methods")
def list_payment_methods(u: User = Depends(require_seller_or_admin)):
    return [{"value": value, "label": label} for value, label in PAYMENT_METHODS.items()]

@app.get("/integrations/pagbank/status")
def pagbank_status(u: User = Depends(require_seller_or_admin)):
    return {
        "provider": "pagbank",
        "mode": "plugpag",
        "ready": False,
        "message": "Estrutura preparada. PlugPag exige bridge nativo com Bluetooth e terminal PagBank físico.",
        "requirements": [
            "terminal_pagbank_compativel",
            "mac_address_bluetooth",
            "bridge_nativo_plugpag",
            "homologacao_fluxo_operacional"
        ]
    }

@app.post("/integrations/pagbank/payment-intents")
def create_pagbank_payment_intent(intent: PagBankPaymentIntentCreate, u: User = Depends(require_seller_or_admin)):
    if intent.amount <= 0:
        raise HTTPException(status_code=400, detail="Valor inválido")
    if intent.payment_method not in {"cartao_debito", "cartao_credito", "pagbank"}:
        raise HTTPException(status_code=400, detail="Forma PagBank inválida")

    return {
        "provider": "pagbank",
        "mode": "plugpag",
        "status": "bridge_required",
        "sale_code": intent.sale_code,
        "amount": intent.amount,
        "payment_method": intent.payment_method,
        "terminal_mac_address": intent.terminal_mac_address,
        "message": "Quando o bridge PlugPag estiver instalado, este endpoint enviará a cobrança para a maquineta."
    }


@app.get("/health")
def health_check():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
