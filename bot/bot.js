import { Bot, Keyboard } from '@maxhub/max-bot-api';
import dotenv from 'dotenv';
import { findUserByMaxId, saveUser } from './db.js';
import { findByPhone } from './bitrix.js';

dotenv.config();

const bot = new Bot(process.env.BOT_TOKEN);

const userStates = new Map();

const STATE = {
  IDLE: 'idle',
  WAITING_PHONE: 'waiting_phone',
  REGISTERED: 'registered',
};

// ─── Клавиатура с кнопкой запроса контакта ────────────────────────────────────
function getContactKeyboard() {
  return Keyboard.inlineKeyboard([
    [Keyboard.button.requestContact('📱 Поделиться номером телефона')],
  ]);
}

// ─── Запрос телефона у пользователя ───────────────────────────────────────────
async function askForPhone(ctx) {
  const userId = getUserId(ctx);
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
  phone = phone.trim();

  // Валидация формата номера
  const phoneRegex = /^[\+\d][\d\s\-\(\)]{6,20}$/;
  if (!phoneRegex.test(phone)) {
    await ctx.reply(
      '❌ Некорректный формат номера телефона.\n\n' +
      'Я не смог найти ваш номер телефона в базе, пожалуйста проверьте телефон ' +
      'и укажите его вручную в формате **+79999999999**',
      {
        format: 'markdown',
        attachments: [getContactKeyboard()],
      }
    );
    userStates.set(userId, STATE.WAITING_PHONE);
    return;
  }

  await ctx.reply('🔍 Ищу вас в базе данных...');

  try {
    const bitrixData = await findByPhone(phone);

    // ─── Ничего не найдено ─────────────────────────────────────────────────
    if (!bitrixData) {
      await ctx.reply(
        'Я не смог найти ваш номер телефона в базе, пожалуйста проверьте телефон ' +
        'и укажите его вручную в формате **+79999999999**',
        {
          format: 'markdown',
          attachments: [getContactKeyboard()],
        }
      );
      // Ждём — пользователь введёт другой номер
      userStates.set(userId, STATE.WAITING_PHONE);
      return;
    }

    // ─── Найдено — сохраняем в БД ──────────────────────────────────────────
    await saveUser({
      maxUserId: userId,
      bitrixContactId: bitrixData.contactId,  // может быть null
      bitrixLeadId: bitrixData.leadId,         // может быть null
      phone: phone,
    });

    userStates.set(userId, STATE.REGISTERED);

    // Формируем сообщение об успехе
    const nameText = bitrixData.name ? `, **${bitrixData.name}**` : '';
    let successMsg =
      `✅ Отлично${nameText}! Вы успешно авторизованы.\n\n` +
      `📞 Телефон: ${phone}\n`;

    if (bitrixData.leadId && bitrixData.contactId) {
      successMsg += `📋 Лид: #${bitrixData.leadId}\n`;
      successMsg += `👤 Контакт: #${bitrixData.contactId}\n`;
    } else if (bitrixData.leadId && !bitrixData.contactId) {
      successMsg += `📋 Лид: #${bitrixData.leadId}\n`;
      successMsg += `ℹ️ Контакт не привязан\n`;
    } else if (!bitrixData.leadId && bitrixData.contactId) {
      successMsg += `👤 Контакт: #${bitrixData.contactId}\n`;
    }

    successMsg += '\nТеперь вы можете пользоваться всеми функциями бота!';

    await ctx.reply(successMsg, { format: 'markdown' });

    console.log(
      `✅ Сохранено: MAX ID=${userId}, ` +
      `Lead=${bitrixData.leadId}, ` +
      `Contact=${bitrixData.contactId}, ` +
      `Phone=${phone}, ` +
      `Source=${bitrixData.source}`
    );

  } catch (error) {
    console.error('Ошибка при обработке телефона:', error);
    await ctx.reply(
      '⚠️ Произошла техническая ошибка. Попробуйте позже или введите номер ещё раз.',
      { attachments: [getContactKeyboard()] }
    );
    userStates.set(userId, STATE.WAITING_PHONE);
  }
}

// ─── Получение user_id ────────────────────────────────────────────────────────
function getUserId(ctx) {
  return (
    ctx.update?.user?.user_id ||
    ctx.user?.user_id ||
    null
  );
}

// ─── bot_started ──────────────────────────────────────────────────────────────
bot.on('bot_started', async (ctx) => {
  const userId = getUserId(ctx);
  if (!userId) return;

  console.log(`▶️  bot_started: user_id=${userId}`);

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

// ─── /start ───────────────────────────────────────────────────────────────────
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

// ─── Входящие сообщения ───────────────────────────────────────────────────────
bot.on('message_created', async (ctx) => {
  const userId = getUserId(ctx);
  if (!userId) return;

  const message = ctx.message;

  // Контакт через кнопку requestContact
  const contactAttachment = message?.body?.attachments?.find(
    (a) => a.type === 'contact'
  );

  if (contactAttachment) {
    const phone =
      contactAttachment.payload?.phone ||
      contactAttachment.phone ||
      null;

    if (phone) {
      console.log(`📱 Контакт через кнопку от ${userId}: ${phone}`);
      await handlePhone(ctx, phone, userId);
      return;
    }
  }

  const text = message?.body?.text?.trim();
  if (!text) return;
  if (text.startsWith('/')) return;

  const state = userStates.get(userId) || STATE.IDLE;

  // Ждём телефон — обрабатываем ввод
  if (state === STATE.WAITING_PHONE) {
    await handlePhone(ctx, text, userId);
    return;
  }

  // Уже зарегистрирован
  if (state === STATE.REGISTERED) {
    await ctx.reply(`Чем могу помочь?`);
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

// ─── Callback кнопки ──────────────────────────────────────────────────────────
bot.on('message_callback', async (ctx) => {
  const userId = getUserId(ctx);
  console.log(`🔘 Callback от ${userId}`);
});

// ─── Запуск ───────────────────────────────────────────────────────────────────
console.log('🤖 Бот запускается...');
bot.start();
console.log('✅ Бот запущен!');