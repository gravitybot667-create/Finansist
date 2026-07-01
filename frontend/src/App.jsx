import React, { useState, useEffect } from 'react';
import { Calculator, Calendar as CalendarIcon, Plus, Download, FileText, Trash2, CheckCircle2, ChevronLeft, Building2, Wallet, Moon, Sun, Settings, PieChart, BarChart } from 'lucide-react';
import * as xlsx from 'xlsx';
import pdfMake from "pdfmake/build/pdfmake";
import * as pdfFonts from "pdfmake/build/vfs_fonts";
import { format, addDays, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, subDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import { PieChart as RechartsPie, Pie, Cell, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart as RechartsBar, Bar } from 'recharts';
import * as api from './api';

pdfMake.vfs = pdfFonts && pdfFonts.pdfMake ? pdfFonts.pdfMake.vfs : pdfFonts;

const formatKZT = (amount) => {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'KZT',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount || 0).replace('KZT', '₸');
};

const formatKZTPDF = (num) => new Intl.NumberFormat('ru-RU', { style: 'decimal', maximumFractionDigits: 0 }).format(num || 0) + ' тг.';

const mapTender = (t) => ({
  id: t.id,
  productName: t.product_name,
  lotNumber: t.nmck ? t.nmck.toString() : '',
  buyPrice: t.buy_price,
  buyQty: t.buy_qty,
  buyTotal: t.buy_total,
  sellPrice: t.sell_price,
  sellQty: t.sell_qty,
  sellTotal: t.sell_total,
  totalExtra: t.extra_costs,
  totalCosts: t.total_costs,
  taxAmount: t.tax_amount,
  netProfit: t.net_profit,
  margin: t.margin,
  roi: t.roi,
  status: t.status,
  signDate: t.sign_date,
  date: t.sign_date,
  expenses: t.expenses_detail || []
});

function App() {
  const [activeTab, setActiveTab] = useState('calc');
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('erpTheme') || 'light');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);

  const [appState, setAppState] = useState({
    activeCompanyId: null,
    companies: {}
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('erpTheme', theme);
  }, [theme]);

  useEffect(() => {
    try {
      if (window.Telegram && window.Telegram.WebApp) {
        window.Telegram.WebApp.ready();
        window.Telegram.WebApp.expand();
      }
    } catch (e) {}

    const loadData = async (retries = 3) => {
      try {
        setErrorMsg(null);
        // Добавляем небольшую задержку, чтобы Telegram.WebApp.initData успел инициализироваться
        await new Promise(r => setTimeout(r, 300));
        const comps = await api.fetchCompanies();
        if (comps && comps.length > 0) {
          const companiesObj = {};
          for (const c of comps) {
            companiesObj[c.id] = {
              id: c.id,
              name: c.name,
              role: c.role,
              taxType: c.tax_type,
              monthlyGoal: c.monthly_goal,
              requisites: { bin: c.bin || '', bank: c.bank || '', iik: c.iik || '', bik: c.bik || '', address: c.address || '' },
              tenders: (await api.fetchTenders(c.id)).map(mapTender),
              treasuryTransactions: await api.fetchTransactions(c.id),
              reminders: []
            };
          }
          setAppState({
            activeCompanyId: comps[0].id,
            companies: companiesObj
          });
        }
        setLoading(false);
      } catch (e) {
        console.error("Failed to load data:", e);
        if (retries > 0) {
          setTimeout(() => loadData(retries - 1), 1000);
        } else {
          setErrorMsg(e.message || "Ошибка подключения");
          setLoading(false);
        }
      }
    };
    loadData();
  }, []);

  const company = appState.activeCompanyId ? appState.companies[appState.activeCompanyId] : null;

  const updateCompany = (updates) => {
    setAppState(prev => ({
      ...prev,
      companies: {
        ...prev.companies,
        [prev.activeCompanyId]: {
          ...prev.companies[prev.activeCompanyId],
          ...updates
        }
      }
    }));
  };

  const handleCreateTender = async (tender) => {
    if (!company) return;
    try {
      const payload = {
        product_name: tender.productName,
        nmck: parseFloat(tender.lotNumber) || 0,
        buy_price: tender.buyPrice,
        buy_qty: tender.buyQty,
        buy_total: tender.buyTotal,
        sell_price: tender.sellPrice,
        sell_qty: tender.sellQty,
        sell_total: tender.sellTotal,
        extra_costs: tender.totalExtra,
        total_costs: tender.totalCosts,
        tax_system: company.taxType,
        tax_amount: tender.taxAmount,
        net_profit: tender.netProfit,
        margin: tender.margin,
        roi: tender.roi,
        status: tender.status,
        sign_date: tender.signDate || null,
        expenses_detail: tender.expenses
      };

      const dbTender = await api.createTender(company.id, payload);
      
      let updatedTx = [...company.treasuryTransactions];
      if (['won', 'shipping'].includes(dbTender.status)) {
        const txRes = await api.createTransaction(company.id, {
          type: 'expense',
          amount: dbTender.total_costs || payload.total_costs,
          description: `Закуп и расходы (Тендер: ${dbTender.product_name || payload.product_name})`,
          ref_tender_id: dbTender.id
        });
        updatedTx.unshift(txRes);
      }
      
      const t = mapTender(dbTender);
      updateCompany({ tenders: [t, ...company.tenders], treasuryTransactions: updatedTx });
    } catch (e) {
      alert("Ошибка при сохранении тендера: " + e.message);
    }
  };

  const handleUpdateTenderStatus = async (tenderId, newStatus) => {
    if (!company) return;
    const tender = company.tenders.find(t => t.id === tenderId);
    if (!tender || tender.status === newStatus) return;

    await api.updateTenderStatus(company.id, tenderId, newStatus);
    
    let updatedTx = [...company.treasuryTransactions];
    const wasActive = ['won', 'shipping'].includes(tender.status);
    const isNowActive = ['won', 'shipping'].includes(newStatus);
    
    if (!wasActive && isNowActive) {
      const txRes = await api.createTransaction(company.id, {
        type: 'expense',
        amount: tender.totalCosts || tender.total_costs,
        description: `Закуп и расходы (Тендер: ${tender.productName || tender.product_name})`,
        ref_tender_id: tenderId
      });
      updatedTx.unshift(txRes);
    }
    
    if (newStatus === 'paid') {
      const txRes = await api.createTransaction(company.id, {
        type: 'income',
        amount: tender.sellTotal || tender.sell_total,
        description: `Оплата по тендеру: ${tender.productName || tender.product_name}`,
        ref_tender_id: tenderId
      });
      updatedTx.unshift(txRes);
    }

    const updatedTenders = company.tenders.map(t => t.id === tenderId ? { ...t, status: newStatus } : t);
    updateCompany({ tenders: updatedTenders, treasuryTransactions: updatedTx });
  };

  const currentBalance = company ? company.treasuryTransactions.reduce((acc, tx) => acc + (tx.type === 'income' ? tx.amount : -tx.amount), 0) : 0;

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: 'var(--text-secondary)' }}>Загрузка данных с сервера...</div>;
  }

  if (errorMsg) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', padding: '20px', textAlign: 'center' }}>
        <div style={{ color: 'var(--danger-color)', marginBottom: '10px' }}>Ошибка загрузки</div>
        <div style={{ color: 'var(--text-secondary)', marginBottom: '20px', fontSize: '14px' }}>{errorMsg}</div>
        <button className="btn-primary" onClick={() => { setLoading(true); window.location.reload(); }}>Обновить</button>
      </div>
    );
  }

  if (!company) {
    return <CreateCompanyScreen 
      onCreated={(c) => {
        setAppState({
          activeCompanyId: c.id,
          companies: {
            [c.id]: {
              id: c.id, name: c.name, role: c.role, taxType: c.tax_type, monthlyGoal: c.monthly_goal,
              requisites: { bin: '', bank: '', iik: '', bik: '', address: '' },
              tenders: [], treasuryTransactions: [], reminders: []
            }
          }
        });
      }} 
    />;
  }

  return (
    <div className="app-container">
      {/* HEADER */}
      <div className="glass-panel" style={{ padding: '12px 20px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Building2 size={24} color="var(--primary-color)" />
          <span style={{ fontWeight: 600, fontSize: '18px' }}>
            {company.name}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="tabs" style={{ marginBottom: 0 }}>
            {Object.values(appState.companies).map(c => (
              <div key={c.id} className={`tab ${appState.activeCompanyId === c.id ? 'active' : ''}`} onClick={() => setAppState(p => ({...p, activeCompanyId: c.id}))}>{c.name}</div>
            ))}
          </div>
          <button onClick={() => setShowSettings(!showSettings)} style={{ background: 'transparent', padding: '6px', color: 'var(--text-secondary)' }}><Settings size={20} /></button>
          <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} style={{ background: 'transparent', padding: '6px', color: 'var(--text-secondary)' }}>
            {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
          </button>
        </div>
      </div>

      {showSettings && (
        <SettingsModal company={company} updateCompany={updateCompany} onClose={() => setShowSettings(false)} companyName={company.name || 'Компания'} />
      )}

      <div style={{ paddingBottom: '80px', display: showSettings ? 'none' : 'block' }}>
        {activeTab === 'calc' && <CalculatorScreen company={company} onSaveResult={handleCreateTender} updateCompany={updateCompany} />}
        {activeTab === 'crm' && <CRMScreen company={company} onUpdateStatus={handleUpdateTenderStatus} companyName={company.name || 'Компания'} />}
        {activeTab === 'analytics' && <AnalyticsScreen company={company} balance={currentBalance} updateCompany={updateCompany} />}
        {activeTab === 'treasury' && <TreasuryScreen company={company} balance={currentBalance} updateCompany={updateCompany} />}
        {activeTab === 'calendar' && <CalendarScreen company={company} updateCompany={updateCompany} />}
      </div>

      <nav className="bottom-nav">
        <button className={`nav-item ${activeTab === 'calc' ? 'active' : ''}`} onClick={() => setActiveTab('calc')}><Calculator size={20}/>Счет</button>
        <button className={`nav-item ${activeTab === 'crm' ? 'active' : ''}`} onClick={() => setActiveTab('crm')}><FileText size={20}/>CRM</button>
        <button className={`nav-item ${activeTab === 'analytics' ? 'active' : ''}`} onClick={() => setActiveTab('analytics')}><PieChart size={20}/>Аналитика</button>
        <button className={`nav-item ${activeTab === 'treasury' ? 'active' : ''}`} onClick={() => setActiveTab('treasury')}><Wallet size={20}/>Касса</button>
        <button className={`nav-item ${activeTab === 'calendar' ? 'active' : ''}`} onClick={() => setActiveTab('calendar')}><CalendarIcon size={20}/>План</button>
      </nav>
    </div>
  );
}

// ========================
// CREATE COMPANY SCREEN
// ========================
const CreateCompanyScreen = ({ onCreated }) => {
  const [name, setName] = useState('');
  const [taxType, setTaxType] = useState('ip');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) return alert("Введите название компании");
    setIsSubmitting(true);
    try {
      const data = await api.createCompany({ name, tax_type: taxType });
      onCreated(data);
    } catch (e) {
      alert("Ошибка при создании компании: " + e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', padding: '20px' }}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: '400px', padding: '24px' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '20px', fontSize: '20px' }}>Добро пожаловать!</h2>
        <p style={{ textAlign: 'center', marginBottom: '24px', color: 'var(--text-secondary)', fontSize: '14px' }}>Для начала работы создайте свою первую компанию.</p>
        
        <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>Название компании (или ваше имя)</label>
        <input 
          type="text" 
          className="input-field" 
          placeholder="Например: ИП Иванов" 
          value={name} 
          onChange={e => setName(e.target.value)} 
          style={{ width: '100%', marginBottom: '16px' }}
        />
        
        <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>Форма собственности</label>
        <select 
          className="input-field" 
          value={taxType} 
          onChange={e => setTaxType(e.target.value)} 
          style={{ width: '100%', marginBottom: '24px' }}
        >
          <option value="ip">Индивидуальный Предприниматель (ИП)</option>
          <option value="too">Товарищество (ТОО / ООО)</option>
        </select>
        
        <button 
          className="btn-primary" 
          style={{ width: '100%' }} 
          onClick={handleSubmit} 
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Создание...' : 'Создать компанию'}
        </button>
      </div>
    </div>
  );
};

// ========================
// SETTINGS MODAL
// ========================
const SettingsModal = ({ company, updateCompany, onClose, companyName }) => {
  const [reqs, setReqs] = useState(company.requisites || { bin: '', bank: '', iik: '', bik: '', address: '' });
  const [members, setMembers] = useState([]);
  const [inviteLink, setInviteLink] = useState('');

  useEffect(() => {
    const loadMembers = async () => {
      try {
        const data = await api.getCompanyMembers(company.id);
        setMembers(data);
      } catch (e) {
        console.error("Failed to load members", e);
      }
    };
    loadMembers();
  }, [company.id]);

  const handleGenerateLink = async () => {
    try {
      const data = await api.getInviteLink(company.id);
      setInviteLink(data.link);
    } catch (e) {
      alert("Ошибка при генерации ссылки. Убедитесь, что вы владелец.");
    }
  };

  const handleRemoveMember = async (memberId) => {
    if (!window.confirm("Удалить этого сотрудника?")) return;
    try {
      await api.removeCompanyMember(company.id, memberId);
      setMembers(members.filter(m => m.id !== memberId));
    } catch (e) {
      alert("Ошибка при удалении сотрудника.");
    }
  };

  const save = () => { updateCompany({ requisites: reqs }); onClose(); };

  return (
    <div className="glass-panel animate-fade-in" style={{ padding: '20px 20px 100px 20px' }}>
      <h2 style={{ marginBottom: '16px', fontSize: '18px' }}>Реквизиты {companyName}</h2>
      <div className="input-row"><div className="input-group" style={{ flex: 1 }}><label>БИН / ИИН</label><input type="text" className="input-field" value={reqs.bin} onChange={e => setReqs({...reqs, bin: e.target.value})} /></div></div>
      <div className="input-row"><div className="input-group" style={{ flex: 1 }}><label>Банк</label><input type="text" className="input-field" value={reqs.bank} onChange={e => setReqs({...reqs, bank: e.target.value})} /></div></div>
      <div className="input-row"><div className="input-group" style={{ flex: 1 }}><label>ИИК (Расчетный счет)</label><input type="text" className="input-field" value={reqs.iik} onChange={e => setReqs({...reqs, iik: e.target.value})} /></div></div>
      <div className="input-row"><div className="input-group" style={{ flex: 1 }}><label>БИК</label><input type="text" className="input-field" value={reqs.bik} onChange={e => setReqs({...reqs, bik: e.target.value})} /></div></div>
      <div className="input-row"><div className="input-group" style={{ flex: 1 }}><label>Юр. Адрес</label><input type="text" className="input-field" value={reqs.address} onChange={e => setReqs({...reqs, address: e.target.value})} /></div></div>
      
      <h3 style={{ marginTop: '20px', marginBottom: '10px', fontSize: '16px' }}>Команда</h3>
      <div style={{ marginBottom: '10px' }}>
        {members.map(m => (
          <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px', background: 'var(--bg-primary)', borderRadius: '8px', marginBottom: '4px' }}>
            <span>{m.first_name || m.username || 'Без имени'}</span>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{m.role === 'owner' ? 'Владелец' : 'Сотрудник'}</span>
              {company.role === 'owner' && m.role !== 'owner' && (
                <button onClick={() => handleRemoveMember(m.id)} style={{ padding: '2px 6px', background: 'var(--danger-color)', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '12px' }}>Удалить</button>
              )}
            </div>
          </div>
        ))}
      </div>
      {company.role === 'owner' && (
        <div style={{ marginBottom: '20px' }}>
          {!inviteLink ? (
            <button className="btn-secondary" style={{ width: '100%' }} onClick={handleGenerateLink}>Пригласить сотрудника</button>
          ) : (
            <div style={{ padding: '10px', background: 'var(--bg-primary)', borderRadius: '8px', wordBreak: 'break-all', fontSize: '12px' }}>
              Ссылка для приглашения:<br/>
              <a href={inviteLink} style={{ color: 'var(--primary-color)' }}>{inviteLink}</a>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '10px' }}>
        <button className="btn-secondary" style={{ flex: 1 }} onClick={onClose}>Закрыть</button>
        <button className="btn-primary" style={{ flex: 1 }} onClick={save}>Сохранить</button>
      </div>
    </div>
  );
};

// ========================
// 1. CALCULATOR SCREEN
// ========================
const CalculatorScreen = ({ company, onSaveResult, updateCompany }) => {
  const [productName, setProductName] = useState('');
  const [lotNumber, setLotNumber] = useState('');
  const [signDate, setSignDate] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [sellQty, setSellQty] = useState('');
  const sellTotal = (parseFloat(sellPrice) || 0) * (parseFloat(sellQty) || 1);
  const [buyPrice, setBuyPrice] = useState('');
  const [buyQty, setBuyQty] = useState('');
  const buyTotal = (parseFloat(buyPrice) || 0) * (parseFloat(buyQty) || 1);
  const [status, setStatus] = useState('draft');
  const [expenses, setExpenses] = useState([]);
  const [expenseName, setExpenseName] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [result, setResult] = useState(null);

  const addExpense = () => {
    if (expenseName && expenseAmount) {
      setExpenses([...expenses, { id: Date.now(), name: expenseName, amount: parseFloat(expenseAmount) }]);
      setExpenseName(''); setExpenseAmount('');
    }
  };

  const calculate = () => {
    const totalExtra = expenses.reduce((sum, e) => sum + e.amount, 0);
    const totalCosts = buyTotal + totalExtra;
    let taxAmount = 0;
    if (company.taxType === 'ip4') taxAmount = sellTotal * 0.04;
    else if (company.taxType === 'too3') taxAmount = sellTotal * 0.03;
    else if (company.taxType === 'too20') { const profit = Math.max(0, sellTotal - totalCosts); taxAmount = profit * 0.20; }

    const netProfit = sellTotal - totalCosts - taxAmount;
    const margin = sellTotal > 0 ? (netProfit / sellTotal) * 100 : 0;
    const roi = totalCosts > 0 ? (netProfit / totalCosts) * 100 : 0;

    setResult({
      id: Date.now(), date: new Date().toISOString(),
      productName, lotNumber, signDate, status,
      sellPrice: parseFloat(sellPrice) || 0, sellQty: parseFloat(sellQty) || 1, sellTotal,
      buyPrice: parseFloat(buyPrice) || 0, buyQty: parseFloat(buyQty) || 1, buyTotal,
      totalExtra, totalCosts, taxAmount, netProfit, margin, roi, expenses
    });
  };

  const saveTender = () => {
    if (result) {
      onSaveResult({ ...result, status });
      setResult(null); setProductName(''); setLotNumber(''); setSignDate('');
      setSellPrice(''); setSellQty(''); setBuyPrice(''); setBuyQty(''); setExpenses([]);
    }
  };

  return (
    <div className="animate-fade-in" style={{ padding: '0 4px' }}>
      <div className="glass-panel" style={{ padding: '20px', marginBottom: '20px' }}>
        <h2 style={{ marginBottom: '20px', fontSize: '20px' }}>Параметры тендера</h2>
        <div className="input-row"><div className="input-group" style={{ flex: 1 }}><label>Название товара / тендера</label><input type="text" className="input-field" placeholder="Поставка ноутбуков" value={productName} onChange={e => setProductName(e.target.value)} /></div></div>
        <div className="input-row">
          <div className="input-group" style={{ flex: 1 }}><label>Номер лота (закупа)</label><input type="text" className="input-field" placeholder="№ 12345" value={lotNumber} onChange={e => setLotNumber(e.target.value)} /></div>
          <div className="input-group" style={{ flex: 1 }}><label>Дата подписания (для календаря)</label><input type="date" className="input-field" value={signDate} onChange={e => setSignDate(e.target.value)} /></div>
        </div>
        <div className="input-group">
          <label>Режим налогообложения</label>
          <div className="tabs" style={{ marginBottom: 0, marginTop: '8px' }}>
            <div className={`tab ${company.taxType === 'ip4' ? 'active' : ''}`} onClick={() => updateCompany({taxType: 'ip4'})}>ИП 4%</div>
            <div className={`tab ${company.taxType === 'too3' ? 'active' : ''}`} onClick={() => updateCompany({taxType: 'too3'})}>ТОО 3%</div>
            <div className={`tab ${company.taxType === 'too20' ? 'active' : ''}`} onClick={() => updateCompany({taxType: 'too20'})}>ТОО 20%</div>
          </div>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '20px', marginBottom: '20px' }}>
        <h3 style={{ marginBottom: '16px', fontSize: '18px', color: 'var(--success-color)' }}>Доход (Продажа)</h3>
        <div className="input-row">
          <div className="input-group" style={{ flex: 2 }}><label>Цена за 1 шт. ₸</label><input type="number" className="input-field" placeholder="Цена" value={sellPrice} onChange={e => setSellPrice(e.target.value)} /></div>
          <div className="input-group" style={{ flex: 1 }}><label>Кол-во</label><input type="number" className="input-field" placeholder="Шт" value={sellQty} onChange={e => setSellQty(e.target.value)} /></div>
        </div>
        <div style={{ fontSize: '14px', textAlign: 'right', marginTop: '-5px', color: 'var(--text-secondary)' }}>Общая выручка: <strong style={{ color: 'var(--text-primary)' }}>{formatKZT(sellTotal)}</strong></div>
      </div>

      <div className="glass-panel" style={{ padding: '20px', marginBottom: '20px' }}>
        <h3 style={{ marginBottom: '16px', fontSize: '18px', color: 'var(--danger-color)' }}>Расход (Закуп)</h3>
        <div className="input-row">
          <div className="input-group" style={{ flex: 2 }}><label>Цена закупа 1 шт. ₸</label><input type="number" className="input-field" placeholder="Цена" value={buyPrice} onChange={e => setBuyPrice(e.target.value)} /></div>
          <div className="input-group" style={{ flex: 1 }}><label>Кол-во</label><input type="number" className="input-field" placeholder="Шт" value={buyQty} onChange={e => setBuyQty(e.target.value)} /></div>
        </div>
        <div style={{ fontSize: '14px', textAlign: 'right', marginTop: '-5px', color: 'var(--text-secondary)' }}>Общий закуп: <strong style={{ color: 'var(--text-primary)' }}>{formatKZT(buyTotal)}</strong></div>
      </div>

      <div className="glass-panel" style={{ padding: '20px', marginBottom: '20px' }}>
        <h3 style={{ marginBottom: '16px', fontSize: '18px' }}>Доп. расходы</h3>
        {expenses.map(e => (
          <div key={e.id} className="expense-item"><span className="expense-name">{e.name}</span><div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}><span className="expense-amount">{formatKZT(e.amount)}</span><Trash2 size={16} color="var(--danger-color)" style={{ cursor: 'pointer' }} onClick={() => removeExpense(e.id)} /></div></div>
        ))}
        <div className="expense-input-row">
          <input type="text" className="input-field" placeholder="Название (напр. Логистика)" style={{ flex: 2 }} value={expenseName} onChange={e => setExpenseName(e.target.value)} />
          <input type="number" className="input-field" placeholder="Сумма" style={{ flex: 1 }} value={expenseAmount} onChange={e => setExpenseAmount(e.target.value)} />
        </div>
        <button className="btn-secondary" style={{ width: '100%', marginTop: '10px' }} onClick={addExpense}><Plus size={18} /> Добавить статью</button>
      </div>

      <button className="btn-primary" onClick={calculate} style={{ marginBottom: '20px' }}>Рассчитать прибыль</button>

      {result && (
        <div className="animate-fade-in glass-panel result-card" style={{ marginBottom: '20px' }}>
          <h3 style={{ marginBottom: '16px', fontSize: '18px' }}>Отчет по тендеру</h3>
          <div className="result-row"><span>Общая Выручка:</span><span>{formatKZT(result.sellTotal)}</span></div>
          <div className="result-row" style={{ marginTop: '10px' }}><span>Общий Закуп:</span><span>{formatKZT(result.buyTotal)}</span></div>
          <div className="result-row"><span>Доп. расходы:</span><span>{formatKZT(result.totalExtra)}</span></div>
          <div className="result-row"><span>Налоги:</span><span>{formatKZT(result.taxAmount)}</span></div>
          <div className="result-row" style={{ marginTop: '10px', color: 'var(--text-secondary)' }}><span>Полная себестоимость (Закуп + Допы + Налог):</span><span>{formatKZT(result.totalCosts + result.taxAmount)}</span></div>
          <div className="result-row" style={{ color: 'var(--text-secondary)' }}><span>Себестоимость 1 единицы:</span><span>{formatKZT((result.totalCosts + result.taxAmount) / result.buyQty)}</span></div>
          <div className="result-row total" style={{ marginTop: '16px' }}><span>Чистая прибыль:</span><span style={{ color: result.netProfit > 0 ? 'var(--success-color)' : 'var(--danger-color)'}}>{formatKZT(result.netProfit)}</span></div>
          <div style={{ display: 'flex', gap: '16px', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-color)' }}>
            <div style={{ flex: 1 }}><div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Маржа</div><div style={{ fontSize: '18px', fontWeight: 600 }}>{result.margin.toFixed(2)}%</div></div>
            <div style={{ flex: 1 }}><div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>ROI</div><div style={{ fontSize: '18px', fontWeight: 600 }}>{result.roi.toFixed(2)}%</div></div>
          </div>
          <div style={{ marginTop: '20px' }}>
            {company.role === 'owner' ? (
              <>
                <label style={{ fontSize: '14px', marginBottom: '8px', display: 'block' }}>Воронка: На каком этапе тендер?</label>
                <select className="input-field" value={status} onChange={e => setStatus(e.target.value)} style={{ width: '100%', marginBottom: '16px' }}>
                  <option value="draft">Черновик (Просчет)</option>
                  <option value="submitted">Заявка подана</option>
                  <option value="won">Выигран (Заморозка средств)</option>
                  <option value="shipping">В процессе доставки</option>
                </select>
                <button className="btn-primary" onClick={saveTender} style={{ width: '100%' }}>Сохранить в CRM</button>
              </>
            ) : (
              <div style={{ padding: '12px', background: 'var(--bg-secondary)', borderRadius: '12px', textAlign: 'center', fontSize: '14px', color: 'var(--text-secondary)' }}>
                Сохранение в CRM доступно только владельцу компании.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ========================
// 2. CRM SCREEN
// ========================
const getStatusLabel = (s) => ({ draft: 'Черновик', submitted: 'Заявка подана', won: 'Заморозка', shipping: 'Доставка', paid: 'Оплачено', lost: 'Отменен / Не состоялся' }[s] || s);
const getStatusColor = (s) => ({ draft: '#6b7280', submitted: '#3b82f6', won: '#f59e0b', shipping: '#8b5cf6', paid: '#10b981', lost: '#ef4444' }[s] || '#000');

const CRMScreen = ({ company, onUpdateStatus, companyName }) => {
  const [selectedItem, setSelectedItem] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredTenders = company.tenders.filter(item => {
    if (!searchQuery) return true;
    return (item.productName || '').toLowerCase().includes(searchQuery.toLowerCase()) || (item.lotNumber || '').includes(searchQuery);
  });

  if (selectedItem) {
    return (
      <div className="animate-fade-in" style={{ padding: '0 4px' }}>
        <button className="btn-secondary" onClick={() => setSelectedItem(null)} style={{ marginBottom: '16px' }}><ChevronLeft size={18} /> К списку</button>
        <div className="glass-panel result-card">
          <h3 style={{ fontSize: '18px' }}>{selectedItem.productName || 'Без названия'}</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px' }}>Лот: {selectedItem.lotNumber || '—'} | Договор: {selectedItem.signDate || '—'}</p>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ fontSize: '12px', display: 'block', marginBottom: '8px', color: 'var(--text-secondary)' }}>Статус тендера:</label>
            <select className="input-field" value={selectedItem.status} onChange={e => { onUpdateStatus(selectedItem.id, e.target.value); setSelectedItem({...selectedItem, status: e.target.value}); }} style={{ width: '100%' }}>
              <option value="draft">Черновик (Просчет)</option>
              <option value="submitted">Заявка подана</option>
              <option value="won">Выигран (Заморозка средств)</option>
              <option value="shipping">В процессе доставки</option>
              <option value="paid">Оплачено (В кассу)</option>
              <option value="lost">Отменен / Не состоялся</option>
            </select>
          </div>
          <div className="result-row"><span>Цена за единицу (доход):</span><span>{formatKZT(selectedItem.sellPrice)} x {selectedItem.sellQty} шт</span></div>
          <div className="result-row"><span>Общая выручка:</span><span>{formatKZT(selectedItem.sellTotal)}</span></div>
          <div className="result-row" style={{ marginTop: '10px' }}><span>Цена закупа за единицу:</span><span>{formatKZT(selectedItem.buyPrice)} x {selectedItem.buyQty} шт</span></div>
          <div className="result-row"><span>Общая сумма закупа:</span><span>{formatKZT(selectedItem.buyTotal)}</span></div>
          
          {selectedItem.expenses && selectedItem.expenses.length > 0 && (
            <div style={{ marginTop: '10px' }}>
              <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Дополнительные расходы:</div>
              {selectedItem.expenses.map((e, idx) => (
                <div key={idx} className="result-row" style={{ fontSize: '13px', paddingLeft: '10px' }}><span>- {e.name}</span><span>{formatKZT(e.amount)}</span></div>
              ))}
            </div>
          )}
          
          <div className="result-row" style={{ marginTop: '10px' }}><span>Сумма доп. расходов:</span><span>{formatKZT(selectedItem.totalExtra)}</span></div>
          <div className="result-row"><span>Сумма налога:</span><span>{formatKZT(selectedItem.taxAmount)}</span></div>
          <div className="result-row" style={{ marginTop: '10px', fontWeight: 'bold' }}><span>Полная себестоимость (Закуп + Допы + Налог):</span><span>{formatKZT(selectedItem.totalCosts + selectedItem.taxAmount)}</span></div>
          <div className="result-row" style={{ color: 'var(--text-secondary)' }}><span>Себестоимость 1 единицы:</span><span>{selectedItem.buyQty > 0 ? formatKZT((selectedItem.totalCosts + selectedItem.taxAmount) / selectedItem.buyQty) : '0 ₸'}</span></div>
          
          <div className="result-row total" style={{ marginTop: '16px' }}><span>Чистая прибыль:</span><span style={{ color: 'var(--success-color)'}}>{formatKZT(selectedItem.netProfit)}</span></div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '24px' }}>
            <button className="btn-secondary" onClick={() => exportToPDF(selectedItem)}><FileText size={16} /> PDF Отчет</button>
            <button className="btn-secondary" onClick={() => exportToExcel(selectedItem)}><Download size={16} /> Excel</button>
            <button className="btn-secondary" onClick={() => exportInvoice(selectedItem, company, companyName)} style={{ gridColumn: '1 / -1' }}><FileText size={16} /> Скачать Счет на оплату</button>
            <button className="btn-secondary" onClick={() => exportAct(selectedItem, company, companyName)} style={{ gridColumn: '1 / -1' }}><FileText size={16} /> Скачать Акт (АВР)</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in" style={{ padding: '0 4px' }}>
      <h2 style={{ marginBottom: '20px', fontSize: '20px' }}>CRM: Мои тендеры</h2>
      {company.tenders.length > 0 && <input type="text" className="input-field" placeholder="🔍 Поиск по названию или лоту..." style={{ width: '100%', marginBottom: '16px' }} value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />}
      {company.tenders.length === 0 ? (
        <div className="glass-panel" style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--text-secondary)' }}>В CRM пока нет тендеров.</div>
      ) : (
        <div>
          {filteredTenders.map(item => (
            <div key={item.id} className="glass-panel history-item" style={{ cursor: 'pointer' }} onClick={() => setSelectedItem(item)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div className="history-title" style={{ marginBottom: '4px' }}>{item.productName || "Без названия"}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Лот: {item.lotNumber || '—'}</div>
                  <span className="status-badge" style={{ background: `${getStatusColor(item.status)}22`, color: getStatusColor(item.status) }}>{getStatusLabel(item.status)}</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{formatKZT(item.sellTotal)}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Сумма</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ========================
// 3. ANALYTICS SCREEN
// ========================
const AnalyticsScreen = ({ company, balance, updateCompany }) => {
  const wonTenders = company.tenders.filter(t => ['won', 'shipping', 'paid'].includes(t.status));
  const lostTenders = company.tenders.filter(t => t.status === 'lost');
  const paidTenders = company.tenders.filter(t => t.status === 'paid');
  
  const statusCounts = company.tenders.reduce((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {});
  
  const pieData = Object.keys(statusCounts).map(k => ({ name: getStatusLabel(k), value: statusCounts[k], fill: getStatusColor(k) }));

  const currentMonthStart = startOfMonth(new Date());
  const currentMonthEnd = endOfMonth(new Date());
  const currentMonthProfit = paidTenders.filter(t => {
    const d = new Date(t.date);
    return d >= currentMonthStart && d <= currentMonthEnd;
  }).reduce((sum, t) => sum + t.netProfit, 0);

  const totalProfit = paidTenders.reduce((sum, t) => sum + t.netProfit, 0);
  const avgMargin = paidTenders.length > 0 ? paidTenders.reduce((sum, t) => sum + t.margin, 0) / paidTenders.length : 0;
  const bestTender = paidTenders.length > 0 ? paidTenders.reduce((best, t) => (t.netProfit > best.netProfit ? t : best), paidTenders[0]) : null;

  const frozenCapital = company.tenders.filter(t => ['won', 'shipping'].includes(t.status)).reduce((acc, t) => acc + t.totalCosts, 0);

  const [editGoal, setEditGoal] = useState(false);
  const [goalInput, setGoalInput] = useState(company.monthlyGoal || 20000000);
  
  const saveGoal = () => {
    updateCompany({ monthlyGoal: parseFloat(goalInput) || 1000000 });
    setEditGoal(false);
  };

  const goalPercent = Math.min(100, ((currentMonthProfit / (company.monthlyGoal || 20000000)) * 100));

  return (
    <div className="animate-fade-in" style={{ padding: '0 4px' }}>
      <h2 style={{ marginBottom: '20px', fontSize: '20px' }}>Аналитика</h2>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px' }}>
        <div className="glass-panel" style={{ margin: 0, padding: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Заморожено в товаре</div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: '#f59e0b', marginTop: '4px' }}>{formatKZT(frozenCapital)}</div>
        </div>
        <div className="glass-panel" style={{ margin: 0, padding: '16px', textAlign: 'center' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Свободно в кассе</div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--success-color)', marginTop: '4px' }}>{formatKZT(balance)}</div>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '20px' }}>
        <h3 style={{ fontSize: '16px', marginBottom: '16px' }}>Воронка тендеров</h3>
        {pieData.length > 0 ? (
          <div style={{ height: '220px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <RechartsPie>
                <Pie 
                  data={pieData} 
                  cx="50%" cy="50%" 
                  innerRadius={50} outerRadius={70} 
                  paddingAngle={5} 
                  dataKey="value"
                  labelLine={{ stroke: 'var(--text-secondary)', strokeWidth: 1 }}
                  label={({ percent, cx, x, y, midAngle }) => (
                    <text 
                      x={x} y={y} 
                      fill="var(--text-primary)" 
                      textAnchor={x > cx ? 'start' : 'end'} 
                      dominantBaseline="central" 
                      fontSize={12} 
                      fontWeight={600}
                    >
                      {`${(percent * 100).toFixed(0)}%`}
                    </text>
                  )}
                >
                  {pieData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.fill} />)}
                </Pie>
              </RechartsPie>
            </ResponsiveContainer>
          </div>
        ) : <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '14px' }}>Нет данных</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center', marginTop: '10px' }}>
          {pieData.map(d => (
            <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: d.fill }}></div>{d.name} ({d.value})
            </div>
          ))}
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '20px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '16px', margin: 0 }}>План на месяц ({format(currentMonthStart, 'LLLL', { locale: ru })})</h3>
          {!editGoal && <button onClick={() => setEditGoal(true)} style={{ background: 'transparent', color: 'var(--primary-color)', fontSize: '12px' }}>Изменить</button>}
        </div>
        
        {editGoal ? (
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <input type="number" className="input-field" style={{ flex: 1 }} value={goalInput} onChange={e => setGoalInput(e.target.value)} />
            <button className="btn-primary" style={{ width: 'auto' }} onClick={saveGoal}>ОК</button>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Факт: <strong style={{ color: 'var(--text-primary)' }}>{formatKZT(currentMonthProfit)}</strong></span>
            <span style={{ color: 'var(--text-secondary)' }}>Цель: <strong style={{ color: 'var(--text-primary)' }}>{formatKZT(company.monthlyGoal || 20000000)}</strong></span>
          </div>
        )}
        
        <div style={{ width: '100%', height: '12px', background: 'var(--input-bg)', borderRadius: '6px', overflow: 'hidden' }}>
          <div style={{ width: `${goalPercent}%`, height: '100%', background: goalPercent >= 100 ? 'var(--success-color)' : 'var(--primary-color)', transition: 'width 0.5s ease' }}></div>
        </div>
        <div style={{ textAlign: 'right', fontSize: '12px', marginTop: '6px', color: goalPercent >= 100 ? 'var(--success-color)' : 'var(--text-secondary)', fontWeight: 600 }}>
          {goalPercent.toFixed(1)}% выполнено
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        <div className="glass-panel" style={{ padding: '16px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Прибыль за всё время</div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--success-color)' }}>{formatKZT(totalProfit)}</div>
        </div>
        <div className="glass-panel" style={{ padding: '16px' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Средняя маржа</div>
          <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--primary-color)' }}>{avgMargin.toFixed(1)}%</div>
        </div>
        <div className="glass-panel" style={{ padding: '16px', gridColumn: '1 / -1' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Топ тендер (По прибыли)</div>
          {bestTender ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '14px', fontWeight: 500 }}>{bestTender.productName || 'Без названия'}</div>
              <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--success-color)' }}>{formatKZT(bestTender.netProfit)}</div>
            </div>
          ) : <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Нет завершенных сделок</div>}
        </div>
      </div>
    </div>
  );
};

// ========================
// 4. TREASURY SCREEN
// ========================
const TreasuryScreen = ({ company, balance, updateCompany }) => {
  const [formMode, setFormMode] = useState(null);
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const handleTransaction = () => {
    if (!amount || !comment) return alert("Введите сумму и комментарий");
    const val = parseFloat(amount);
    if (val <= 0) return alert("Сумма должна быть больше 0");
    const newTx = { id: Date.now(), date: new Date().toISOString(), type: formMode === 'deposit' ? 'income' : 'expense', amount: val, description: formMode === 'deposit' ? `Внесение: ${comment}` : `Снятие: ${comment}` };
    updateCompany({ treasuryTransactions: [newTx, ...company.treasuryTransactions] });
    setAmount(''); setComment(''); setFormMode(null);
  };

  return (
    <div className="animate-fade-in" style={{ padding: '0 4px' }}>
      <h2 style={{ marginBottom: '20px', fontSize: '20px' }}>Моя Касса</h2>
      <div className="balance-card">
        <div style={{ fontSize: '14px', opacity: 0.8 }}>Текущий баланс</div>
        <div className="balance-amount">{formatKZT(balance)}</div>
      </div>
      {company.role === 'owner' && (
        !formMode ? (
          <div style={{ display: 'flex', gap: '10px', marginBottom: '24px' }}>
            <button className="btn-secondary" style={{ flex: 1, borderColor: 'var(--success-color)', color: 'var(--success-color)' }} onClick={() => setFormMode('deposit')}>Внести</button>
            <button className="btn-secondary" style={{ flex: 1, borderColor: 'var(--danger-color)', color: 'var(--danger-color)' }} onClick={() => setFormMode('withdraw')}>Изъять</button>
          </div>
        ) : (
          <div className="glass-panel animate-fade-in" style={{ marginBottom: '24px', padding: '16px' }}>
            <h3 style={{ fontSize: '16px', marginBottom: '16px' }}>{formMode === 'deposit' ? 'Внесение в кассу' : 'Снятие из кассы'}</h3>
            <input type="number" className="input-field" placeholder="Сумма" style={{ marginBottom: '10px' }} value={amount} onChange={e => setAmount(e.target.value)} />
            <input type="text" className="input-field" placeholder="Комментарий" style={{ marginBottom: '16px' }} value={comment} onChange={e => setComment(e.target.value)} />
            <div style={{ display: 'flex', gap: '10px' }}><button className="btn-secondary" style={{ flex: 1 }} onClick={() => setFormMode(null)}>Отмена</button><button className="btn-primary" style={{ flex: 1, background: formMode === 'deposit' ? 'var(--success-color)' : 'var(--danger-color)' }} onClick={handleTransaction}>{formMode === 'deposit' ? 'Внести' : 'Снять'}</button></div>
          </div>
        )
      )}
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '16px', margin: 0 }}>История операций</h3>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
        <div>
          <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Период с:</label>
          <input 
            type={startDate ? "date" : "text"}
            onFocus={(e) => e.target.type = "date"}
            onBlur={(e) => { if (!e.target.value) e.target.type = "text" }}
            placeholder="ДД.ММ.ГГГГ"
            className="input-field" 
            style={{ padding: '8px', width: '100%', boxSizing: 'border-box', fontSize: '14px' }} 
            value={startDate} 
            onChange={e => setStartDate(e.target.value)} 
          />
        </div>
        <div>
          <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>По:</label>
          <input 
            type={endDate ? "date" : "text"}
            onFocus={(e) => e.target.type = "date"}
            onBlur={(e) => { if (!e.target.value) e.target.type = "text" }}
            placeholder="ДД.ММ.ГГГГ"
            className="input-field" 
            style={{ padding: '8px', width: '100%', boxSizing: 'border-box', fontSize: '14px' }} 
            value={endDate} 
            onChange={e => setEndDate(e.target.value)} 
          />
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '16px' }}>
        {company.treasuryTransactions.length === 0 ? <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '14px' }}>Операций нет</div> : (
          company.treasuryTransactions.filter(tx => {
            if (startDate && new Date(tx.date) < new Date(startDate)) return false;
            if (endDate && new Date(tx.date) > new Date(endDate + 'T23:59:59')) return false;
            return true;
          }).length === 0 ? <div style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '14px' }}>За этот период операций нет</div> :
          company.treasuryTransactions.filter(tx => {
            if (startDate && new Date(tx.date) < new Date(startDate)) return false;
            if (endDate && new Date(tx.date) > new Date(endDate + 'T23:59:59')) return false;
            return true;
          }).map(tx => (
            <div key={tx.id} className="treasury-transaction">
              <div><div style={{ fontSize: '14px', marginBottom: '4px' }}>{tx.description}</div><div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{format(new Date(tx.date), 'dd.MM.yyyy HH:mm')}</div></div>
              <div style={{ fontWeight: 600, color: tx.type === 'income' ? 'var(--success-color)' : 'var(--danger-color)' }}>{tx.type === 'income' ? '+' : '-'}{formatKZT(tx.amount)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// ========================
// 5. CALENDAR SCREEN
// ========================
const CalendarScreen = ({ company, updateCompany }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [remText, setRemText] = useState('');
  
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const selectedReminders = selectedDate ? company.reminders.filter(r => isSameDay(new Date(r.date), selectedDate)) : [];

  const handleAdd = () => {
    if (selectedDate && remText) {
      updateCompany({ reminders: [...company.reminders, { id: Date.now(), date: selectedDate.toISOString(), text: remText }] });
      setRemText(''); setShowForm(false);
    }
  };

  return (
    <div className="animate-fade-in" style={{ padding: '0 4px' }}>
      <div className="glass-panel" style={{ padding: '20px', marginBottom: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '18px', textTransform: 'capitalize' }}>{format(currentDate, 'LLLL yyyy', { locale: ru })}</h2>
          <div><button className="btn-secondary" style={{ padding: '4px 8px', marginRight: '8px' }} onClick={() => setCurrentDate(addDays(currentDate, -30))}>&lt;</button><button className="btn-secondary" style={{ padding: '4px 8px' }} onClick={() => setCurrentDate(addDays(currentDate, 30))}>&gt;</button></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '12px', marginBottom: '8px' }}>
          <div>Пн</div><div>Вт</div><div>Ср</div><div>Чт</div><div>Пт</div><div>Сб</div><div>Вс</div>
        </div>
        <div className="calendar-grid">
          {Array.from({ length: (monthStart.getDay() + 6) % 7 }).map((_, i) => <div key={`pad-${i}`} />)}
          {daysInMonth.map(day => {
            const hasReminder = company.reminders.some(r => isSameDay(new Date(r.date), day));
            return (
              <div key={day.toISOString()} className={`calendar-day ${hasReminder ? 'frozen' : ''}`} style={{ background: selectedDate && isSameDay(selectedDate, day) ? 'var(--primary-color)' : '', color: selectedDate && isSameDay(selectedDate, day) ? '#fff' : '' }} onClick={() => setSelectedDate(day)}>
                {format(day, 'd')}
              </div>
            );
          })}
        </div>
      </div>
      {selectedDate && (
        <div className="glass-panel animate-fade-in" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '16px', marginBottom: '16px' }}>События на {format(selectedDate, 'dd.MM.yyyy')}</h3>
          {selectedReminders.length > 0 ? (
            <div style={{ marginBottom: '16px' }}>
              {selectedReminders.map(r => (
                <div key={r.id} className="expense-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px', background: r.isAuto ? 'var(--bg-main)' : '' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><CheckCircle2 size={16} color="var(--primary-color)" /><span className="expense-name" style={{ color: r.isAuto ? 'var(--primary-color)' : '' }}>{r.text}</span></div>
                  {r.comment && <span style={{ color: 'var(--text-secondary)', fontSize: '13px', marginLeft: '24px' }}>{r.comment}</span>}
                </div>
              ))}
            </div>
          ) : <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px' }}>Событий нет.</p>}
          {!showForm ? <button className="btn-secondary" style={{ width: '100%' }} onClick={() => setShowForm(true)}><Plus size={18} /> Добавить событие</button> : (
            <div className="animate-fade-in">
              <input type="text" className="input-field" placeholder="Название события" style={{ marginBottom: '10px' }} value={remText} onChange={e => setRemText(e.target.value)} />
              <div style={{ display: 'flex', gap: '10px' }}><button className="btn-secondary" style={{ flex: 1 }} onClick={() => setShowForm(false)}>Отмена</button><button className="btn-primary" style={{ flex: 1 }} onClick={handleAdd}>Сохранить</button></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ========================
// SHARED HELPERS (PDF/Excel)
// ========================
const exportToExcel = (r) => {
  const expensesData = (r.expenses || []).map(e => ["Доп. расход", e.name, e.amount]);
  const ws = xlsx.utils.aoa_to_sheet([
    ["ОТЧЕТ", ""], 
    ["Товар", r.productName], 
    ["Выручка", r.sellTotal], 
    ["Цена дохода за 1 шт", r.sellPrice],
    ["Кол-во продажи", r.sellQty],
    ["Закуп", r.buyTotal], 
    ["Цена закупа за 1 шт", r.buyPrice],
    ["Кол-во закупа", r.buyQty],
    ...expensesData,
    ["Сумма доп. расходов", r.totalExtra],
    ["Налог", r.taxAmount],
    ["Полная себестоимость", r.totalCosts + r.taxAmount],
    ["Себестоимость 1 шт", r.buyQty > 0 ? (r.totalCosts + r.taxAmount) / r.buyQty : 0],
    ["Прибыль", r.netProfit]
  ]);
  ws['!cols'] = [{ wch: 25 }, { wch: 20 }];
  const wb = xlsx.utils.book_new(); xlsx.utils.book_append_sheet(wb, ws, "Расчет");
  xlsx.writeFile(wb, `tender_${r.id}.xlsx`);
};

const exportToPDF = (r) => {
  const expensesData = (r.expenses || []).map(e => [`Доп. расход: ${e.name}`, formatKZTPDF(e.amount)]);
  const doc = { 
    content: [
      { text: `Отчет: ${r.productName}`, style: 'header' }, 
      { table: { body: [
        ['Выручка', formatKZTPDF(r.sellTotal)], 
        ['Цена продажи 1 шт', formatKZTPDF(r.sellPrice)],
        ['Закуп', formatKZTPDF(r.buyTotal)], 
        ['Цена закупа 1 шт', formatKZTPDF(r.buyPrice)],
        ...expensesData,
        ['Сумма доп. расходов', formatKZTPDF(r.totalExtra)],
        ['Сумма налога', formatKZTPDF(r.taxAmount)],
        ['Полная себестоимость', formatKZTPDF(r.totalCosts + r.taxAmount)],
        ['Прибыль', formatKZTPDF(r.netProfit)]
      ] } }
    ], 
    styles: { header: { fontSize: 20, bold: true, margin: [0,0,0,10] } } 
  };
  pdfMake.createPdf(doc).download(`report_${r.id}.pdf`);
};

const exportInvoice = (r, company, cName) => {
  const req = company.requisites || {};
  const doc = {
    content: [
      { text: `Счет на оплату № ${r.id} от ${format(new Date(), 'dd.MM.yyyy')}`, style: 'header', alignment: 'center', margin: [0,0,0,20] },
      { text: `Поставщик: ${cName}`, bold: true },
      { text: `БИН/ИИН: ${req.bin || 'Не указан'}, ИИК: ${req.iik || 'Не указан'}, Банк: ${req.bank || 'Не указан'}, БИК: ${req.bik || 'Не указан'}`, margin: [0,0,0,20] },
      { text: `Покупатель: Заказчик (Укажите реквизиты при необходимости)`, margin: [0,0,0,20] },
      { table: {
          headerRows: 1, widths: ['auto', '*', 'auto', 'auto', 'auto'],
          body: [
            ['№', 'Наименование товара', 'Кол-во', 'Цена', 'Сумма'],
            ['1', r.productName || 'Товар по договору', r.sellQty || 1, formatKZTPDF(r.sellPrice), formatKZTPDF(r.sellTotal)]
          ]
        }
      },
      { text: `Итого к оплате: ${formatKZTPDF(r.sellTotal)}`, bold: true, alignment: 'right', margin: [0,20,0,40] },
      { text: 'Руководитель: ___________________', margin: [0,20,0,0] }
    ],
    styles: { header: { fontSize: 18, bold: true } }, defaultStyle: { font: 'Roboto', fontSize: 12 }
  };
  pdfMake.createPdf(doc).download(`invoice_${r.id}.pdf`);
};
const exportAct = (r, company, cName) => {
  const req = company.requisites || {};
  const doc = {
    content: [
      { text: `Акт выполненных работ (оказанных услуг) / приема-передачи`, style: 'header', alignment: 'center', margin: [0,0,0,20] },
      { text: `Исполнитель/Продавец: ${cName} (БИН: ${req.bin || ''})`, margin: [0,0,0,10] },
      { text: `Заказчик/Покупатель: _____________________________________`, margin: [0,0,0,20] },
      { table: {
          headerRows: 1, widths: ['auto', '*', 'auto', 'auto', 'auto'],
          body: [
            ['№', 'Наименование', 'Кол-во', 'Цена', 'Сумма'],
            ['1', r.productName || 'Товар/Услуга', r.sellQty || 1, formatKZTPDF(r.sellPrice), formatKZTPDF(r.sellTotal)]
          ]
        }
      },
      { text: `Общая стоимость: ${formatKZTPDF(r.sellTotal)}`, bold: true, alignment: 'right', margin: [0,20,0,40] },
      { columns: [
          { text: 'Сдал (Исполнитель):\n\n___________________', alignment: 'left' },
          { text: 'Принял (Заказчик):\n\n___________________', alignment: 'right' }
      ]}
    ],
    styles: { header: { fontSize: 16, bold: true } }, defaultStyle: { font: 'Roboto', fontSize: 12 }
  };
  pdfMake.createPdf(doc).download(`act_${r.id}.pdf`);
};

export default App;
