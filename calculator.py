def calculate_unit_economics(nmck: float, cost_price: float, extra_costs: float, tax_system: str) -> dict:
    """
    Рассчитывает юнит-экономику тендера.
    
    :param nmck: Начальная максимальная цена контракта (или текущая ставка)
    :param cost_price: Себестоимость товара/работ
    :param extra_costs: Дополнительные расходы (логистика, комиссии и т.д.)
    :param tax_system: "usn6" (УСН Доходы), "usn15" (УСН Доходы - Расходы), "osno" (ОСНО с НДС)
    :return: Словарь с результатами расчета
    """
    total_costs = cost_price + extra_costs
    
    tax_amount = 0.0
    if tax_system == "usn6":
        # УСН 6% "Доходы"
        tax_amount = nmck * 0.06
    elif tax_system == "usn15":
        # УСН 15% "Доходы минус расходы"
        profit_before_tax = nmck - total_costs
        tax_amount = max(0, profit_before_tax * 0.15)
        # Минимальный налог при УСН 15% - это 1% от доходов
        min_tax = nmck * 0.01
        if tax_amount < min_tax:
            tax_amount = min_tax
    elif tax_system == "osno":
        # Упрощенный расчет ОСНО:
        # Считаем, что в НМЦК сидит НДС 20%
        # Считаем, что в расходах тоже сидит НДС 20% (для простоты)
        # НДС к уплате = НДС исходящий - НДС входящий
        revenue_no_vat = nmck / 1.2
        costs_no_vat = total_costs / 1.2
        vat_to_pay = max(0, (nmck - revenue_no_vat) - (total_costs - costs_no_vat))
        
        # Налог на прибыль 20% с (Доходы без НДС - Расходы без НДС)
        profit_tax = max(0, (revenue_no_vat - costs_no_vat) * 0.20)
        
        tax_amount = vat_to_pay + profit_tax

    net_profit = nmck - total_costs - tax_amount
    margin = (net_profit / nmck * 100) if nmck > 0 else 0.0
    roi = (net_profit / total_costs * 100) if total_costs > 0 else 0.0
    
    return {
        "nmck": nmck,
        "cost_price": cost_price,
        "extra_costs": extra_costs,
        "total_costs": total_costs,
        "tax_amount": tax_amount,
        "net_profit": net_profit,
        "margin": margin,
        "roi": roi
    }
