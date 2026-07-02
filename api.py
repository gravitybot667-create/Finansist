import os
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, Header, Body, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
from dotenv import load_dotenv
from urllib.parse import parse_qsl
from datetime import datetime

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

async def keep_alive():
    """Ping the server itself every 10 minutes to prevent Render from sleeping."""
    url = os.getenv("WEBAPP_URL")
    if not url:
        return
    import aiohttp
    
    # Wait a bit for the server to fully start
    await asyncio.sleep(10)
    
    while True:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=10) as response:
                    logging.info(f"Keep-alive ping sent to {url}. Status: {response.status}")
        except Exception as e:
            logging.error(f"Keep-alive ping failed: {e}")
        
        # Ping every 10 minutes (600 seconds)
        await asyncio.sleep(600)

async def check_deliveries():
    """Background task to check delivery dates and send reminders via Telegram."""
    await asyncio.sleep(20) # wait for startup
    while True:
        try:
            db = SessionLocal()
            tenders = db.query(Tender).filter(Tender.status.notin_(["draft", "paid"])).all()
            now = datetime.utcnow()
            
            for t in tenders:
                if not t.deliveries: continue
                
                updated_deliveries = []
                changed = False
                for d in t.deliveries:
                    if not isinstance(d, dict) or 'date' not in d:
                        updated_deliveries.append(d)
                        continue
                        
                    try:
                        del_date = datetime.fromisoformat(d['date'].replace('Z', '+00:00')).replace(tzinfo=None)
                        days_left = (del_date - now).days
                        
                        alerts_sent = d.get('alerts_sent', [])
                        
                        for target in [10, 5, 3, 1]:
                            if days_left == target and target not in alerts_sent:
                                # Send notification
                                members = db.query(CompanyMember).filter(CompanyMember.company_id == t.company_id).all()
                                for m in members:
                                    try:
                                        msg = f"🔔 Напоминание по тендеру: {t.product_name}\n" \
                                              f"Поставка партии ({d.get('quantity', 0)} шт) запланирована на {del_date.strftime('%d.%m.%Y')} (через {target} дней)."
                                        asyncio.create_task(bot.send_message(m.user_id, msg))
                                    except Exception as e:
                                        logging.error(f"Failed to send delivery alert to {m.user_id}: {e}")
                                
                                alerts_sent.append(target)
                                changed = True
                        
                        d['alerts_sent'] = alerts_sent
                    except Exception as e:
                        logging.error(f"Error parsing delivery date: {e}")
                    
                    updated_deliveries.append(d)
                
                if changed:
                    t.deliveries = updated_deliveries
                    # SQLAlchemy JSON mutation tracking might need explicit set
                    from sqlalchemy.orm.attributes import flag_modified
                    flag_modified(t, "deliveries")
                    db.commit()
            
            db.close()
        except Exception as e:
            logging.error(f"Error in check_deliveries: {e}")
            
        await asyncio.sleep(60 * 60) # Check every hour

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB
    init_db()
    # Start bot polling in background
    polling_task = asyncio.create_task(dp.start_polling(bot))
    # Start keep_alive task
    keep_alive_task = asyncio.create_task(keep_alive())
    # Start delivery check task
    delivery_task = asyncio.create_task(check_deliveries())
    yield
    # Stop bot
    polling_task.cancel()
    keep_alive_task.cancel()
    delivery_task.cancel()

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

import traceback
from fastapi.responses import JSONResponse

class CompanyCreate(BaseModel):
    name: str
    tax_type: str

@app.post("/api/companies")
def create_company(company: CompanyCreate, user: User = Depends(get_current_user), db=Depends(get_db)):
    try:
        db_company = Company(name=company.name, tax_type=company.tax_type, owner_id=user.id)
        # Ensure default values are populated before commit if needed
        db_company.monthly_goal = 20000000.0
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
    except Exception as e:
        db.rollback()
        return JSONResponse(status_code=400, content=f"DB Error: {str(e)}\n{traceback.format_exc()}")

import uuid
from datetime import datetime, timedelta

@app.get("/api/companies/{company_id}/invite")
def get_invite_link(company_id: int, user: User = Depends(get_current_user), db=Depends(get_db)):
    m = db.query(CompanyMember).filter(CompanyMember.company_id == company_id, CompanyMember.user_id == user.id).first()
    if not m or m.role != "owner":
        raise HTTPException(status_code=403, detail="Only owner can invite")
    
    company = db.query(Company).get(company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
        
    token = str(uuid.uuid4())
    company.invite_token = token
    company.invite_token_expires_at = datetime.utcnow() + timedelta(minutes=5)
    db.commit()
    
    bot_username = os.getenv("BOT_USERNAME", "Tendify_bot") # Fallback to new bot name
    return {"link": f"https://t.me/{bot_username}?start=invite_{token}"}

@app.get("/api/companies/{company_id}/members")
def get_company_members(company_id: int, user: User = Depends(get_current_user), db=Depends(get_db)):
    members = db.query(CompanyMember).filter(CompanyMember.company_id == company_id).all()
    res = []
    for m in members:
        u = db.query(User).get(m.user_id)
        res.append({"id": u.id, "username": u.username, "first_name": u.first_name, "role": m.role})
    return res

@app.delete("/api/companies/{company_id}/members/{user_id}")
def remove_company_member(company_id: int, user_id: int, user: User = Depends(get_current_user), db=Depends(get_db)):
    m = db.query(CompanyMember).filter(CompanyMember.company_id == company_id, CompanyMember.user_id == user.id).first()
    if not m or m.role != "owner":
        raise HTTPException(status_code=403, detail="Only owner can remove members")
    
    if user_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot remove yourself")
        
    member_to_remove = db.query(CompanyMember).filter(CompanyMember.company_id == company_id, CompanyMember.user_id == user_id).first()
    if member_to_remove:
        db.delete(member_to_remove)
        db.commit()
    return {"success": True}

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
    expenses_detail: Optional[list] = []
    deliveries: Optional[list] = []

@app.post("/api/companies/{company_id}/tenders")
def create_tender(company_id: int, tender: TenderCreate, user: User = Depends(get_current_user), db=Depends(get_db)):
    m = db.query(CompanyMember).filter(CompanyMember.company_id == company_id, CompanyMember.user_id == user.id).first()
    if not m or m.role != "owner":
        raise HTTPException(status_code=403, detail="Only owner can add tenders")
        
    db_tender = Tender(**tender.dict(), company_id=company_id)
    db.add(db_tender)
    db.commit()
    db.refresh(db_tender)
    
    return db_tender

@app.get("/api/companies/{company_id}/tenders")
def get_tenders(company_id: int, user: User = Depends(get_current_user), db=Depends(get_db)):
    return db.query(Tender).filter(Tender.company_id == company_id).order_by(Tender.id.desc()).all()

class TenderUpdate(BaseModel):
    status: Optional[str] = None
    deliveries: Optional[list] = None

@app.put("/api/companies/{company_id}/tenders/{tender_id}")
def update_tender(company_id: int, tender_id: int, data: TenderUpdate = Body(None), status: str = Query(None), user: User = Depends(get_current_user), db=Depends(get_db)):
    t = db.query(Tender).filter(Tender.id == tender_id, Tender.company_id == company_id).first()
    if t:
        if status:
            t.status = status
        if data:
            if data.status is not None:
                t.status = data.status
            if data.deliveries is not None:
                t.deliveries = data.deliveries
        db.commit()
        db.refresh(t)
    return t

@app.delete("/api/companies/{company_id}/tenders/{tender_id}")
def delete_tender(company_id: int, tender_id: int, user: User = Depends(get_current_user), db=Depends(get_db)):
    m = db.query(CompanyMember).filter(CompanyMember.company_id == company_id, CompanyMember.user_id == user.id).first()
    if not m or m.role != "owner":
        raise HTTPException(status_code=403, detail="Only owner can delete tenders")
        
    t = db.query(Tender).filter(Tender.id == tender_id, Tender.company_id == company_id).first()
    if t:
        # Delete associated transactions
        db.query(Transaction).filter(Transaction.ref_tender_id == tender_id).delete()
        db.delete(t)
        db.commit()
    return {"status": "ok"}

class TransactionCreate(BaseModel):
    type: str
    amount: float
    description: str
    category: Optional[str] = None
    ref_tender_id: Optional[int] = None
    is_tax: Optional[bool] = False

@app.post("/api/companies/{company_id}/transactions")
def create_transaction(company_id: int, tx: TransactionCreate, user: User = Depends(get_current_user), db=Depends(get_db)):
    m = db.query(CompanyMember).filter(CompanyMember.company_id == company_id, CompanyMember.user_id == user.id).first()
    if not m or m.role != "owner":
        raise HTTPException(status_code=403, detail="Only owner can modify treasury")
        
    author = user.first_name or user.username or f"User {user.id}"
    db_tx = Transaction(**tx.dict(), company_id=company_id, author_name=author)
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
