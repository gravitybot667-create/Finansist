import os
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
from dotenv import load_dotenv
from urllib.parse import parse_qsl

from aiogram import Bot, Dispatcher
from handlers import router
from database import init_db, SessionLocal, User, Company, CompanyMember, Tender, Transaction, Reminder

load_dotenv()
BOT_TOKEN = os.getenv("BOT_TOKEN")
if not BOT_TOKEN:
    raise ValueError("No BOT_TOKEN found")

logging.basicConfig(level=logging.INFO)
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()
dp.include_router(router)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB
    init_db()
    # Start bot polling in background
    polling_task = asyncio.create_task(dp.start_polling(bot))
    yield
    # Stop bot
    polling_task.cancel()

app = FastAPI(lifespan=lifespan)

# CORS for frontend testing
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Mock Telegram WebApp initData validation for simplicity in testing
def get_current_user(authorization: str = Header(None), db=Depends(get_db)):
    if not authorization or not authorization.startswith("tma "):
        # For local testing without Telegram, let's allow a mock user
        user = db.query(User).filter(User.id == 1).first()
        if not user:
            user = User(id=1, username="test_user", first_name="Test")
            db.add(user)
            db.commit()
            db.refresh(user)
        return user
    
    # In production, you would parse and validate the initData via HMAC-SHA256
    # For now, we'll parse the user object from the initData string
    init_data = authorization[4:]
    data = dict(parse_qsl(init_data))
    import json
    if 'user' in data:
        user_data = json.loads(data['user'])
        user_id = user_data.get('id')
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            user = User(
                id=user_id,
                username=user_data.get('username'),
                first_name=user_data.get('first_name')
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        return user
    raise HTTPException(status_code=401, detail="Invalid auth")

# --- API Endpoints ---

class CompanyResponse(BaseModel):
    id: int
    name: str
    tax_type: str
    monthly_goal: float
    bin: Optional[str]
    bank: Optional[str]
    iik: Optional[str]
    bik: Optional[str]
    address: Optional[str]
    role: str

@app.get("/api/companies", response_model=List[CompanyResponse])
def get_companies(user: User = Depends(get_current_user), db=Depends(get_db)):
    members = db.query(CompanyMember).filter(CompanyMember.user_id == user.id).all()
    
    res = []
    for m in members:
        c = db.query(Company).get(m.company_id)
        res.append({
            "id": c.id, "name": c.name, "tax_type": c.tax_type,
            "monthly_goal": c.monthly_goal, "bin": c.bin, "bank": c.bank,
            "iik": c.iik, "bik": c.bik, "address": c.address, "role": m.role
        })
    return res

class CompanyCreate(BaseModel):
    name: str
    tax_type: str

@app.post("/api/companies", response_model=CompanyResponse)
def create_company(company: CompanyCreate, user: User = Depends(get_current_user), db=Depends(get_db)):
    db_company = Company(name=company.name, tax_type=company.tax_type, owner_id=user.id)
    db.add(db_company)
    db.commit()
    db.refresh(db_company)
    
    db_member = CompanyMember(company_id=db_company.id, user_id=user.id, role="owner")
    db.add(db_member)
    db.commit()
    
    return {
        "id": db_company.id, "name": db_company.name, "tax_type": db_company.tax_type,
        "monthly_goal": db_company.monthly_goal, "bin": db_company.bin, "bank": db_company.bank,
        "iik": db_company.iik, "bik": db_company.bik, "address": db_company.address, "role": "owner"
    }

@app.get("/api/companies/{company_id}/invite")
def get_invite_link(company_id: int, user: User = Depends(get_current_user), db=Depends(get_db)):
    m = db.query(CompanyMember).filter(CompanyMember.company_id == company_id, CompanyMember.user_id == user.id).first()
    if not m or m.role != "owner":
        raise HTTPException(status_code=403, detail="Only owner can invite")
    # Generates a deep link to start the bot with payload: invite_companyId
    bot_username = "Finansit7_bot" # Ideally fetch from bot.get_me()
    return {"link": f"https://t.me/{bot_username}?start=invite_{company_id}"}

@app.get("/api/companies/{company_id}/members")
def get_company_members(company_id: int, user: User = Depends(get_current_user), db=Depends(get_db)):
    members = db.query(CompanyMember).filter(CompanyMember.company_id == company_id).all()
    res = []
    for m in members:
        u = db.query(User).get(m.user_id)
        res.append({"id": u.id, "username": u.username, "first_name": u.first_name, "role": m.role})
    return res

class TenderCreate(BaseModel):
    product_name: str
    nmck: float
    buy_price: float
    buy_qty: int
    buy_total: float
    sell_price: float
    sell_qty: int
    sell_total: float
    extra_costs: float
    total_costs: float
    tax_system: str
    tax_amount: float
    net_profit: float
    margin: float
    roi: float
    status: str
    sign_date: Optional[str] = None

@app.post("/api/companies/{company_id}/tenders")
def create_tender(company_id: int, tender: TenderCreate, user: User = Depends(get_current_user), db=Depends(get_db)):
    db_tender = Tender(**tender.dict(), company_id=company_id)
    db.add(db_tender)
    db.commit()
    db.refresh(db_tender)
    return db_tender

@app.get("/api/companies/{company_id}/tenders")
def get_tenders(company_id: int, user: User = Depends(get_current_user), db=Depends(get_db)):
    return db.query(Tender).filter(Tender.company_id == company_id).order_by(Tender.id.desc()).all()

@app.put("/api/companies/{company_id}/tenders/{tender_id}")
def update_tender(company_id: int, tender_id: int, status: str, user: User = Depends(get_current_user), db=Depends(get_db)):
    t = db.query(Tender).filter(Tender.id == tender_id, Tender.company_id == company_id).first()
    if t:
        t.status = status
        db.commit()
    return t

class TransactionCreate(BaseModel):
    type: str
    amount: float
    description: str
    ref_tender_id: Optional[int] = None
    is_tax: Optional[bool] = False

@app.post("/api/companies/{company_id}/transactions")
def create_transaction(company_id: int, tx: TransactionCreate, user: User = Depends(get_current_user), db=Depends(get_db)):
    db_tx = Transaction(**tx.dict(), company_id=company_id)
    db.add(db_tx)
    db.commit()
    db.refresh(db_tx)
    return db_tx

@app.get("/api/companies/{company_id}/transactions")
def get_transactions(company_id: int, user: User = Depends(get_current_user), db=Depends(get_db)):
    return db.query(Transaction).filter(Transaction.company_id == company_id).order_by(Transaction.id.desc()).all()

# Serve Frontend
app.mount("/assets", StaticFiles(directory="frontend/dist/assets"), name="assets")

@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    return FileResponse("frontend/dist/index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
