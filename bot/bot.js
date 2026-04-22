import { Bot, Keyboard } from '@maxhub/max-bot-api';
import dotenv from 'dotenv';
import { findUserByMaxId, saveUser } from './db.js';
import { findByPhone } from './bitrix.js';

dotenv.config();

const bot = new Bot(process.env.BOT_TOKEN);

// ─── Хранилище состояний (в памяти) ───────────────────────────────────────────
// Для production лучше использовать Redis
const userStates = new Map();

const STATE = {
  IDLE: 'idle',
  WAITING_PHONE: 'waiting_phone',
  REGISTERED: 'registered',
};

// ─── Клавиатура с кнопкой запроса контакта ────────────────────────────────────
function getContactKeyboard() {
  return Keyboard.inlineKeyboard([
    [
      Keyboard.button.requestContact('📱 Поделиться номером телефона'),
    ],
  ]);
}

// ─── Приветственное сообщение с запросом телефона ─────────────────────────────
async function askForPhone(ctx) {
  const userId = ctx.update?.user?.user_id || ctx.user?.user_id;
  userStates.set(userId, STATE.WAITING_PHONE);

  await ctx.reply(
    '👋 Добро пожаловать!\n\n' +
    'Для начала работы мне нужен ваш номер телефона.\n\n' +
    'Нажмите кнопку ниже, чтобы поделиться номером, ' +
    'или введите его вручную в формате **+79991234567**',
    {
      format: 'markdown',
      attachments: [getContactKeyboard()],
    }
  );
}

// ─── Обработка полученного телефона ───────────────────────────────────────────
async function handlePhone(ctx, phone, userId) {
  // Убираем пробелы
  phone = phone.trim();

  // Базовая валидация номера
  const phoneRegex = /^[\+\d][\d\s\-\(\)]{6,20}$/;
  if (!phoneRegex.test(phone)) {
    await ctx.reply(
      '❌ Некорректный формат номера телефона.\n\n' +
      'Пожалуйста, введите номер в формате **+79991234567** ' +
      'или нажмите кнопку для автоматической отправки.',
      {
        format: 'markdown',
        attachments: [getContactKeyboard()],
      }
    );
    return;
  }

  // Сообщение о поиске
  await ctx.reply('🔍 Ищу вас в базе данных...');

  try {
    // Поиск в Битрикс24
    const bitrixData = await findByPhone(phone);

    if (!bitrixData) {
      // Телефон не найден в Битрикс24
      await ctx.reply(
        '❌ К сожалению, ваш номер телефона не найден в нашей базе.\n\n' +
        'Пожалуйста, обратитесь к менеджеру или попробуйте другой номер.',
        {
          attachments: [
            Keyboard.inlineKeyboard([
              [Keyboard.button.requestContact('📱 Попробовать другой номер')],
            ])
          ]
        }
      );

      userStates.set(userId, STATE.WAITING_PHONE);
      return;
    }

    // Сохраняем в БД
    await saveUser({
      maxUserId: userId,
      bitrixContactId: bitrixData.contactId,
      bitrixLeadId: bitrixData.leadId,
      phone: phone,
    });

    userStates.set(userId, STATE.REGISTERED);

    // Успешная регистрация
    const nameText = bitrixData.name ? `, **${bitrixData.name}**` : '';
    await ctx.reply(
      `✅ Отлично${nameText}! Вы успешно авторизованы.\n\n` +
      `📞 Телефон: ${phone}\n` +
      (bitrixData.leadId ? `🆔 Лид: #${bitrixData.leadId}\n` : '') +
      '\nТеперь вы можете пользоваться всеми функциями бота!',
      { format: 'markdown' }
    );

    console.log(
      `✅ Пользователь зарегистрирован: ` +
      `MAX ID=${userId}, ` +
      `Contact=${bitrixData.contactId}, ` +
      `Lead=${bitrixData.leadId}, ` +
      `Phone=${phone}`
    );

  } catch (error) {
    console.error('Ошибка при обработке телефона:', error);
    await ctx.reply(
      '⚠️ Произошла ошибка при проверке номера. Попробуйте позже.'
    );
  }
}

// ─── Получение user_id из контекста ───────────────────────────────────────────
function getUserId(ctx) {
  return (
    ctx.update?.user?.user_id ||
    ctx.user?.user_id ||
    null
  );
}

// ─── Обработчик старта бота ───────────────────────────────────────────────────
bot.on('bot_started', async (ctx) => {
  const userId = getUserId(ctx);
  if (!userId) return;

  console.log(`▶️  bot_started: user_id=${userId}`);

  // Проверяем — зарегистрирован ли уже пользователь
  const existingUser = await findUserByMaxId(userId);

  if (existingUser) {
    userStates.set(userId, STATE.REGISTERED);
    await ctx.reply(
      `👋 С возвращением! Вы уже авторизованы.\n📞 Телефон: ${existingUser.phone}`
    );
    return;
  }

  // Новый пользователь — запрашиваем телефон
  await askForPhone(ctx);
});

// ─── Команда /start ───────────────────────────────────────────────────────────
bot.command('start', async (ctx) => {
  const userId = getUserId(ctx);
  if (!userId) return;

  const existingUser = await findUserByMaxId(userId);

  if (existingUser) {
    userStates.set(userId, STATE.REGISTERED);
    await ctx.reply(
      `👋 С возвращением! Вы уже авторизованы.\n📞 Телефон: ${existingUser.phone}`
    );
    return;
  }

  await askForPhone(ctx);
});

// ─── Обработчик входящих сообщений ───────────────────────────────────────────
bot.on('message_created', async (ctx) => {
  const userId = getUserId(ctx);
  if (!userId) return;

  const message = ctx.message;

  // Проверяем — пришёл ли контакт через кнопку requestContact
  const contactAttachment = message?.body?.attachments?.find(
    (a) => a.type === 'contact'
  );

  if (contactAttachment) {
    // Пользователь поделился контактом через кнопку
    const phone =
      contactAttachment.payload?.phone ||
      contactAttachment.phone ||
      null;

    if (phone) {
      console.log(`📱 Получен контакт от ${userId}: ${phone}`);
      await handlePhone(ctx, phone, userId);
      return;
    }
  }

  // Проверяем текстовое сообщение
  const text = message?.body?.text?.trim();
  if (!text) return;

  // Команды не обрабатываем повторно
  if (text.startsWith('/')) return;

  const state = userStates.get(userId) || STATE.IDLE;

  if (state === STATE.WAITING_PHONE) {
    // Пользователь вводит телефон вручную
    await handlePhone(ctx, text, userId);
    return;
  }

  if (state === STATE.REGISTERED) {
    // Пользователь уже зарегистрирован — основная логика бота
    await ctx.reply(
      `Вы написали: "${text}"\n\nЯ получил ваше сообщение! Чем могу помочь?`
    );
    return;
  }

  // Состояние неизвестно — проверяем БД
  const existingUser = await findUserByMaxId(userId);
  if (existingUser) {
    userStates.set(userId, STATE.REGISTERED);
    await ctx.reply('Чем могу помочь?');
  } else {
    await askForPhone(ctx);
  }
});

// ─── Обработчик callback-кнопок ───────────────────────────────────────────────
bot.on('message_callback', async (ctx) => {
  const userId = getUserId(ctx);
  console.log(`🔘 Callback от ${userId}:`, ctx.update);
});

// ─── Запуск ───────────────────────────────────────────────────────────────────
console.log('🤖 Бот запускается...');

bot.start();

console.log('✅ Бот запущен!');