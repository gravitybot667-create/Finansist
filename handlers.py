from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.types.web_app_info import WebAppInfo
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import StatesGroup, State
import os

from calculator import calculate_unit_economics
from database import SessionLocal, CompanyMember, User

router = Router()

class CalcStates(StatesGroup):
    waiting_for_nmck = State()
    waiting_for_cost = State()
    waiting_for_extra_costs = State()
    waiting_for_tax = State()

@router.message(Command("start"))
async def cmd_start(message: Message, state: FSMContext):
    await state.clear()
    
    # Handle invite link
    args = message.text.split()
    if len(args) > 1 and args[1].startswith("invite_"):
        company_id_str = args[1].replace("invite_", "")
        if company_id_str.isdigit():
            company_id = int(company_id_str)
            db = SessionLocal()
            # Ensure user exists
            user = db.query(User).filter(User.id == message.from_user.id).first()
            if not user:
                user = User(id=message.from_user.id, username=message.from_user.username, first_name=message.from_user.first_name)
                db.add(user)
                db.commit()
            
            # Check if already in company
            existing = db.query(CompanyMember).filter(CompanyMember.company_id == company_id, CompanyMember.user_id == user.id).first()
            if not existing:
                db.add(CompanyMember(company_id=company_id, user_id=user.id, role="member"))
                db.commit()
                await message.answer("✅ Вы успешно добавлены в компанию как сотрудник!")
            else:
                await message.answer("ℹ️ Вы уже состоите в этой компании.")
            db.close()
            
    webapp_url = os.getenv("WEBAPP_URL")
    if not webapp_url:
        webapp_url = "https://google.com" # Fallback if not configured
        
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="📊 Открыть Финансист", web_app=WebAppInfo(url=webapp_url))]
    ])
    
    await message.answer(
        "Привет! Я твой карманный финдир по тендерам. 📊\n"
        "Теперь всё управление доступно прямо внутри Telegram в удобном приложении!\n\n"
        "Жми кнопку ниже, чтобы открыть приложение:",
        reply_markup=keyboard
    )

@router.callback_query(F.data == "start_calc")
async def start_calc_callback(callback: CallbackQuery, state: FSMContext):
    await state.set_state(CalcStates.waiting_for_nmck)
    await callback.message.edit_text(
        "Отлично! Введи **НМЦК** (Начальную максимальную цену контракта) или сумму, которую планируешь предложить:\n"
        "*(Например: 1000000 или 1000000.50)*",
        parse_mode="Markdown"
    )
    await callback.answer()

@router.message(CalcStates.waiting_for_nmck)
async def process_nmck(message: Message, state: FSMContext):
    try:
        nmck = float(message.text.replace(" ", "").replace(",", "."))
        if nmck <= 0:
            raise ValueError
    except ValueError:
        await message.answer("Пожалуйста, введи корректное число больше нуля.")
        return

    await state.update_data(nmck=nmck)
    await state.set_state(CalcStates.waiting_for_cost)
    await message.answer(
        "Записал. Теперь введи **Себестоимость** закупки товара или работ:\n"
        "*(Сколько ты заплатишь поставщику/подрядчику?)*",
        parse_mode="Markdown"
    )

@router.message(CalcStates.waiting_for_cost)
async def process_cost(message: Message, state: FSMContext):
    try:
        cost = float(message.text.replace(" ", "").replace(",", "."))
        if cost < 0:
            raise ValueError
    except ValueError:
        await message.answer("Пожалуйста, введи корректное число (можно 0).")
        return

    await state.update_data(cost=cost)
    await state.set_state(CalcStates.waiting_for_extra_costs)
    await message.answer(
        "Принято. Введи **Дополнительные расходы**:\n"
        "*(Логистика, комиссии банка за гарантию, зарплата грузчиков и т.д. Если нет - введи 0)*",
        parse_mode="Markdown"
    )

@router.message(CalcStates.waiting_for_extra_costs)
async def process_extra_costs(message: Message, state: FSMContext):
    try:
        extra_costs = float(message.text.replace(" ", "").replace(",", "."))
        if extra_costs < 0:
            raise ValueError
    except ValueError:
        await message.answer("Пожалуйста, введи корректное число (можно 0).")
        return

    await state.update_data(extra_costs=extra_costs)
    
    # Клавиатура для выбора налоговой системы
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="УСН 6% (Доходы)", callback_data="tax_usn6")],
        [InlineKeyboardButton(text="УСН 15% (Доходы - Расходы)", callback_data="tax_usn15")],
        [InlineKeyboardButton(text="ОСНО (с НДС)", callback_data="tax_osno")]
    ])
    
    await state.set_state(CalcStates.waiting_for_tax)
    await message.answer(
        "Отлично, финальный шаг!\n"
        "Выбери свою **Систему налогообложения**:",
        reply_markup=keyboard,
        parse_mode="Markdown"
    )

@router.callback_query(CalcStates.waiting_for_tax, F.data.startswith("tax_"))
async def process_tax_selection(callback: CallbackQuery, state: FSMContext):
    tax_system = callback.data.split("_")[1] # usn6, usn15, osno
    
    data = await state.get_data()
    nmck = data['nmck']
    cost = data['cost']
    extra_costs = data['extra_costs']
    
    # Вычисляем экономику
    result = calculate_unit_economics(nmck, cost, extra_costs, tax_system)
    
    # Формируем красивый отчет
    report = (
        f"📊 **Результат расчета:**\n\n"
        f"💰 Выручка (НМЦК): `{result['nmck']:,.2f} ₽`\n"
        f"📦 Себестоимость: `{result['cost_price']:,.2f} ₽`\n"
        f"🚚 Доп. расходы: `{result['extra_costs']:,.2f} ₽`\n"
        f"🏦 Налоги: `{result['tax_amount']:,.2f} ₽`\n\n"
        f"💵 **Чистая прибыль**: `{result['net_profit']:,.2f} ₽`\n"
        f"📈 Маржинальность: `{result['margin']:.2f}%`\n"
        f"🚀 Рентабельность (ROI): `{result['roi']:.2f}%`\n\n"
    )
    
    # Добавим вердикт
    if result['margin'] >= 20:
        report += "✅ **Вердикт:** Отличный тендер, маржа высокая! Можно смело участвовать."
    elif result['margin'] > 0:
        report += "⚠️ **Вердикт:** Тендер плюсовой, но маржа небольшая. Учитывай риски."
    else:
        report += "🛑 **Вердикт:** ВНИМАНИЕ! Убыточный тендер. Участвовать не рекомендуется."

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🔄 Рассчитать новый", callback_data="start_calc")]
    ])

    await callback.message.edit_text(report, parse_mode="Markdown", reply_markup=keyboard)
    await state.clear()
    await callback.answer()
