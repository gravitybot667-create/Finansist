from sqlalchemy import create_engine, Column, Integer, BigInteger, String, Float, ForeignKey, DateTime, Boolean, JSON
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from sqlalchemy.sql import text
from datetime import datetime

import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./finansist.db")

connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class User(Base):
    __tablename__ = "users"
    
    id = Column(BigInteger, primary_key=True, index=True) # Telegram User ID
    username = Column(String, nullable=True)
    first_name = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class Company(Base):
    __tablename__ = "companies"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    owner_id = Column(BigInteger, ForeignKey("users.id"))
    tax_type = Column(String, default="ip4")
    monthly_goal = Column(Float, default=20000000)
    
    # Requisites
    bin = Column(String, nullable=True)
    bank = Column(String, nullable=True)
    iik = Column(String, nullable=True)
    bik = Column(String, nullable=True)
    address = Column(String, nullable=True)

    # Invite Link
    invite_token = Column(String, nullable=True)
    invite_token_expires_at = Column(DateTime, nullable=True)

class CompanyMember(Base):
    __tablename__ = "company_members"
    
    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"))
    user_id = Column(BigInteger, ForeignKey("users.id"))
    role = Column(String, default="member") # owner, member

class Tender(Base):
    __tablename__ = "tenders"
    
    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"))
    product_name = Column(String)
    nmck = Column(Float)
    buy_price = Column(Float)
    buy_qty = Column(Integer)
    buy_total = Column(Float)
    sell_price = Column(Float)
    sell_qty = Column(Integer)
    sell_total = Column(Float)
    extra_costs = Column(Float)
    total_costs = Column(Float)
    tax_system = Column(String)
    tax_amount = Column(Float)
    net_profit = Column(Float)
    margin = Column(Float)
    roi = Column(Float)
    status = Column(String, default="draft")
    sign_date = Column(String, nullable=True)
    expenses_detail = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class Transaction(Base):
    __tablename__ = "transactions"
    
    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"))
    ref_tender_id = Column(Integer, nullable=True)
    type = Column(String) # income, expense
    amount = Column(Float)
    description = Column(String)
    is_tax = Column(Boolean, default=False)
    date = Column(DateTime, default=datetime.utcnow)

class Reminder(Base):
    __tablename__ = "reminders"
    
    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"))
    ref_tender_id = Column(Integer, nullable=True)
    date = Column(String)
    text = Column(String)
    comment = Column(String, nullable=True)
    is_auto = Column(Boolean, default=False)

def init_db():
    Base.metadata.create_all(bind=engine)
    # Attempt to alter existing tables to use BIGINT for Telegram IDs if using PostgreSQL
    if "postgres" in DATABASE_URL:
        try:
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE users ALTER COLUMN id TYPE BIGINT;"))
                conn.execute(text("ALTER TABLE companies ALTER COLUMN owner_id TYPE BIGINT;"))
                conn.execute(text("ALTER TABLE company_members ALTER COLUMN user_id TYPE BIGINT;"))
                try:
                    conn.execute(text("ALTER TABLE tenders ADD COLUMN expenses_detail JSON;"))
                except Exception:
                    pass # Column might already exist
                conn.commit()
        except Exception as e:
            print("DB Alter failed or already bigints:", e)
