const BASE_URL = '/api';

const getHeaders = () => {
  let initData = '';
  if (window.Telegram && window.Telegram.WebApp) {
    initData = window.Telegram.WebApp.initData;
  }
  return {
    'Content-Type': 'application/json',
    'Authorization': `tma ${initData}`
  };
};

export const fetchCompanies = async () => {
  const res = await fetch(`${BASE_URL}/companies`, { headers: getHeaders() });
  return res.json();
};

export const createCompany = async (companyData) => {
  const res = await fetch(`${BASE_URL}/companies`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(companyData)
  });
  return res.json();
};

export const fetchTenders = async (companyId) => {
  const res = await fetch(`${BASE_URL}/companies/${companyId}/tenders`, { headers: getHeaders() });
  return res.json();
};

export const fetchTransactions = async (companyId) => {
  const res = await fetch(`${BASE_URL}/companies/${companyId}/transactions`, { headers: getHeaders() });
  return res.json();
};

export const createTender = async (companyId, tenderData) => {
  const res = await fetch(`${BASE_URL}/companies/${companyId}/tenders`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(tenderData)
  });
  return res.json();
};

export const updateTenderStatus = async (companyId, tenderId, status) => {
  const res = await fetch(`${BASE_URL}/companies/${companyId}/tenders/${tenderId}?status=${status}`, {
    method: 'PUT',
    headers: getHeaders()
  });
  return res.json();
};

export const createTransaction = async (companyId, txData) => {
  const res = await fetch(`${BASE_URL}/companies/${companyId}/transactions`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(txData)
  });
  return res.json();
};

export const getInviteLink = async (companyId) => {
  const res = await fetch(`${BASE_URL}/companies/${companyId}/invite`, { headers: getHeaders() });
  return res.json();
};

export const getCompanyMembers = async (companyId) => {
  const res = await fetch(`${BASE_URL}/companies/${companyId}/members`, { headers: getHeaders() });
  return res.json();
};
