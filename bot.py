import asyncio
import logging
import os
from dotenv import load_dotenv
from aiogram import Bot, Dispatcher

from handlers import router

# Настройка логирования
logging.basicConfig(level=logging.INFO)

async def main():
    load_dotenv()
    bot_token = os.getenv("BOT_TOKEN")
    
    if not bot_token or bot_token == "your_bot_token_here":
        logging.error("Не найден BOT_TOKEN в файле .env")
        return
        
    bot = Bot(token=bot_token)
    dp = Dispatcher()
    
    # Подключаем роутер с обработчиками
    dp.include_router(router)
    
    logging.info("Бот запускается...")
    # Запускаем поллинг
    await dp.start_polling(bot)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logging.info("Бот остановлен")
