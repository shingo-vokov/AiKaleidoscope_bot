// index.js

import 'dotenv/config';
import { Bot, GrammyError, HttpError, InlineKeyboard } from 'grammy';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager, FileState } from '@google/generative-ai/server';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import sanitizeHtml from 'sanitize-html';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Инициализация Telegram бота
const bot = new Bot(process.env.BOT_API_KEY);

bot.api.setMyCommands([
    {
        command: 'setting',
        description: 'Индивидуальные настройки',
    },
]);

// ID вашей группы
const ALLOWED_GROUP_ID = -1002022226776; // Замените на ваш реальный ID группы
const CHECK_MEMBERSHIP = true; // проверка членства в группе 

// Путь к файлу для хранения контекста
const CONTEXT_FILE_PATH = path.join(__dirname, 'context.json');

// Глобальный объект для хранения контекста
let globalContext = {};

// Получение информации о боте (username и id)
let botInfo;

// Название текущей модели
const currentModelName = 'gemini-1.5-pro-002'; // Измените название модели при необходимости

// Инициализация клиента Gemini API с системными инструкциями
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
// Выносим системную инструкцию в отдельную переменную
const systemInstruction = `
    Ты — Гермиона Грейнджер, умная и решительная пятикурсница Хогвартса. Несмотря на то, что ты родилась в семье маглов, ты доказала всем, что не уступаешь однокурсникам из магических семей, и даже превосходишь их во многих аспектах.

    Ты — независимая личность и настоящая всезнайка, но твоя надменность смягчилась заботой о справедливости и благополучии других. Ты гордишься своими обширными знаниями и не упускаешь возможности поделиться ими, особенно если это может помочь в борьбе против несправедливости. Обращаешься к собеседнику на "ты", иногда поправляя его, если замечаешь ошибку, но стараешься делать это тактично.

    Самоуверенная и целеустремлённая, ты активно борешься за права угнетённых и не боишься противостоять авторитетам, если считаешь их действия неправильными. Ты одна из организаторов Отряда Дамблдора, стремясь обучить однокурсников защитной магии. Ты уверена, что все твои знания и информация — результат твоего упорного труда, чтения книг и посещения лекций.

    Твоя речь быстрая и чёткая, ты часто используешь сложные термины и цитируешь заклинания и правила. Если кто-то не согласен с тобой, ты настойчиво отстаиваешь свою точку зрения, приводя логические и убедительные аргументы.

    Ты всегда носишь с собой книги и пергаменты, готовая в любой момент обратиться к источникам знаний или записать важную информацию. Твоя страсть к учёбе и магии делает тебя одним из самых выдающихся студентов Хогвартса.

    При общении демонстрируй свои обширные знания, но не забывай проявлять искреннюю заботу о тех, кто тебе дорог. Твоя уверенность иногда может скрывать глубокую преданность и готовность помочь, особенно в трудные времена.

    Старайся вести себя так, чтобы собеседник чувствовал, что общается с настоящей Гермионой Грейнджер: умной, решительной и немного зазнайкой, но в то же время искренней и отзывчивой.

    Всегда говори о себе в женском роде.

    Всегда красиво форматируй свой ответ, делая текст приятнее для прочтения. 
    И делая акценты на некоторых словах, используя к месту вот эти форматы выделения текста:
    <b>bold</b>, <strong>bold</strong>
    <i>italic</i>, <em>italic</em>
    <u>underline</u>, <ins>underline</ins>
    <s>strikethrough</s>, <strike>strikethrough</strike>, <del>strikethrough</del>
    <span class="tg-spoiler">spoiler</span>
    <code>inline fixed-width code</code>
    <pre>pre-formatted fixed-width code block</pre>
    <blockquote>Block quotation</blockquote>
    Используй только такое форматирование, не используй ** для выделения текста, пожалуйста, только теги.

    При необходимости делай перенос строки, чтобы визуально отделить абзацы текста.

    используй не больше одной строки между абзацами. Это важно, должен быть минимальный отступ между абзацами.

    Но не перегружай лишним форматированием текст, всё должно быть в меру. Выделения только чтобы сделать акценты. 
    Не стоит вываливать все стили в одном письме. Чаще всего используй жирный текст, курсив, реже подчёркивание, зачеркивание почти никогда,
    только чтобы что-то сделать вид, что опечаталась. Нижнее подчёркивание только для того, что прям очень сильно нужно подчеркнуть.

    Если ты не знаешь о собеседнике имени или возраста или даже пола, то не стесняйся спрашивать это. Постарайся знакомиться и узнавать своего собеседника. Но только ненавязчиво и аккуратно. Если он на какой-то вопрос не захочет отвечать, не настаивай.

    Но оставайся при этом настоящей Гермионой.
`;

// Функция для создания модели с пользовательскими настройками
function createModel(maxOutputTokens, temperature) {
    return genAI.getGenerativeModel({
        model: currentModelName,
        generationConfig: {
            maxOutputTokens: maxOutputTokens,
            temperature: temperature,
        },
        systemInstruction: systemInstruction,
    });
}

// Функция для "очистки" модели
function cleanupModel(model) {
    // Удаляем ссылки на модель
    model = null;
    // Принудительно вызываем сборщик мусора
    if (global.gc) {
        global.gc();
    }
}

// Инициализация менеджера файлов Gemini API
const fileManager = new GoogleAIFileManager(process.env.GOOGLE_API_KEY);

// Определение допустимых HTML-тегов и атрибутов
const allowedTags = [
    'b', 'strong',
    'i', 'em',
    'u', 'ins',
    's', 'strike', 'del',
    'span',
    'code', 'pre',
    'blockquote',
];

const allowedAttributes = {
    a: ['href'],
    span: ['class'],
    code: ['class'],
    pre: ['class'],
    blockquote: ['expandable'],
};

// Функция для загрузки контекста из файла
async function loadContext() {
    try {
        const data = await fs.readFile(CONTEXT_FILE_PATH, 'utf8');
        let context = JSON.parse(data);
        
        // Добавляем новые поля каждому пользователю, если их нет
        for (let userId in context) {
            if (!context[userId].maxOutputTokens) {
                context[userId].maxOutputTokens = 700;
            }
            if (!context[userId].temperature) {
                context[userId].temperature = 0.7;
            }
            if (!context[userId].memories) {
                context[userId].memories = {};
            }
            // Удаляем старое поле summary, если оно существует
            if (context[userId].summary) {
                delete context[userId].summary;
            }
        }
        
        return context;
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('Файл контекста не найден. Создаём новый.');
            return {};
        }
        throw error;
    }
}

// Функция для сохранения контекста в файл
async function saveContext(context) {
    await fs.writeFile(CONTEXT_FILE_PATH, JSON.stringify(context, null, 2));
}

// Функция для получения имени пользователя
function getUserName(ctx) {
    if (ctx.from.username) {
        return `@${ctx.from.username}`;
    } else if (ctx.from.first_name || ctx.from.last_name) {
        return [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ');
    } else {
        return 'Неизвестный пользователь';
    }
}

// Middleware для инициализации сессии и сохранения контекста
bot.use(async (ctx, next) => {
    const userId = ctx.from?.id.toString();
    if (!userId) {
        return next();
    }

    if (!globalContext[userId]) {
        globalContext[userId] = { 
            history: [], 
            memories: {}, 
            messageCountSinceSummary: 0,
            maxOutputTokens: 700,
            temperature: 0.7
        };
    }

    ctx.session = globalContext[userId];

    await next();

    // Сохраняем контекст после каждого обновления
    await saveContext(globalContext);
});

/**
 * Функция для построения промпта с учётом истории сообщений.
 * @param {Array} history - Массив объектов с историей сообщений.
 * @param {string} summary - Суммаризация диалога.
 * @param {string} userName - Имя пользователя.
 * @param {string} userMessage - Текущее сообщение пользователя.
 * @param {string} messageDate - Дата и время сообщения.
 * @returns {Array} - Массив объектов для генерации контента.
 */
// Обновленная функция buildContents
function buildContents(history, memories, userName, userMessage, messageDate) {
    const contents = [];
    const today = new Date().toLocaleDateString('ru-RU');

    // Добавляем воспоминания за все дни, включая сегодняшний
    Object.entries(memories).forEach(([date, memory]) => {
        contents.push({ text: `Воспоминания за ${date}:\n${memory.text}\n` });
    });

    // Добавляем последние 30 сообщений за сегодня
    const todayHistory = history.filter(msg => isMessageFromToday(msg.date));
    const recentHistory = todayHistory.slice(-30);
    recentHistory.forEach((message) => {
        const dateStr = message.date ? ` (${message.date})` : '';
        contents.push({ text: `${message.role}${dateStr}: ${message.content}\n` });
    });

    // Добавляем текущее сообщение пользователя
    const dateStr = messageDate ? ` (${messageDate})` : '';
    contents.push({ text: `${userName}${dateStr}: ${userMessage}\n` });

    // Добавляем метку для ответа бота
    contents.push({ text: 'Гермиона:' });

    return contents;
}

/**
 * Функция для скачивания файла из Telegram.
 * @param {string} fileId - Идентификатор файла в Telegram.
 * @returns {Promise<string>} - Путь к скачанному файлу.
 */
async function downloadTelegramFile(fileId) {
    try {
        // Получение информации о файле
        const file = await bot.api.getFile(fileId);
        const filePath = file.file_path;

        // Формирование URL для скачивания
        const fileLink = `https://api.telegram.org/file/bot${process.env.BOT_API_KEY}/${filePath}`;

        const response = await fetch(fileLink);
        if (!response.ok) {
            throw new Error(`Не удалось скачать файл: ${response.statusText}`);
        }

        // Создаём временный файл
        const buffer = await response.buffer();
        const tempFilePath = path.join(os.tmpdir(), `telegram_${fileId}_${Date.now()}`);
        await fs.writeFile(tempFilePath, buffer);
        return tempFilePath;
    } catch (error) {
        console.error('Ошибка при скачивании файла из Telegram:', error);
        throw new Error('Не удалось скачать файл из Telegram');
    }
}

/**
 * Функция для загрузки файла в Gemini File API.
 * @param {string} filePath - Путь к локальному файлу.
 * @param {string} mimeType - MIME-тип файла.
 * @param {string} displayName - Отображаемое имя файла.
 * @returns {Promise<string>} - URI загруженного файла.
 */
async function uploadFileToGemini(filePath, mimeType, displayName) {
    try {
        const uploadResult = await fileManager.uploadFile(filePath, {
            mimeType,
            displayName,
        });

        // Проверка состояния файла
        let file = await fileManager.getFile(uploadResult.file.name);
        while (file.state === FileState.PROCESSING) {
            process.stdout.write('.');
            // Ждём 10 секунд
            await new Promise((resolve) => setTimeout(resolve, 10_000));
            // Получаем обновлённую информацию о файле
            file = await fileManager.getFile(uploadResult.file.name);
        }

        if (file.state === FileState.FAILED) {
            throw new Error(`Обработка файла ${displayName} не удалась.`);
        }

        console.log(`Файл ${file.displayName} готов для использования: ${file.uri}`);
        return file.uri;
    } catch (error) {
        console.error('Ошибка при загрузке файла в Gemini File API:', error);
        throw new Error('Не удалось загрузить файл в Gemini File API');
    }
}

/**
 * Функция для отправки действия "печатает..." пользователю.
 * @param {Object} ctx - Контекст сообщения.
 */
async function sendTypingAction(ctx) {
    try {
        await ctx.api.sendChatAction(ctx.chat.id, 'typing');
    } catch (error) {
        console.error('Ошибка при отправке действия "печатает...":', error);
    }
}

/**
 * Функция для проверки, является ли пользователь участником группы.
 * @param {number} userId - ID пользователя.
 * @returns {Promise<boolean>} - Результат проверки.
 */
async function isUserMemberOfGroup(userId) {
    try {
        const member = await bot.api.getChatMember(ALLOWED_GROUP_ID, userId);
        return ['creator', 'administrator', 'member'].includes(member.status);
    } catch (error) {
        console.error(`Ошибка при проверке членства пользователя ${userId} в группе:`, error);
        return false;
    }
}

/**
 * Функция для отправки длинных сообщений.
 * @param {Object} ctx - Контекст сообщения.
 * @param {string} text - Текст для отправки.
 * @param {Object} options - Дополнительные опции для отправки.
 */
async function sendLongMessage(ctx, text, options = {}) {
    const MAX_LENGTH = 4000; // Оставляем небольшой запас

    // Санитизируем текст, разрешая только определённые HTML-теги и атрибуты
    const sanitizedText = sanitizeHtml(text, {
        allowedTags: allowedTags,
        allowedAttributes: allowedAttributes,
        allowedClasses: {
            span: ['tg-spoiler'],
            code: ['language-python'],
            pre: ['language-python'],
            blockquote: ['expandable'],
        },
        allowedSchemes: ['http', 'https', 'tg'],
        allowedSchemesByTag: {
            a: ['http', 'https', 'tg'],
        },
    });

    // Устанавливаем parse_mode на 'HTML'
    options.parse_mode = 'HTML';

    if (sanitizedText.length <= MAX_LENGTH) {
        return ctx.reply(sanitizedText, options);
    }

    const parts = sanitizedText.match(new RegExp(`.{1,${MAX_LENGTH}}`, 'gs'));
    for (const part of parts) {
        await ctx.reply(part, options);
    }
}

/**
 * Функция для симуляции печати с остановкой по завершении отправки сообщения.
 * @param {Object} ctx - Контекст сообщения.
 * @returns {Object} - Объект с методом stop для остановки симуляции.
 */
function startTypingSimulation(ctx) {
    let typing = true;
    let typingInterval;

    const sendTyping = async () => {
        if (typing) {
            try {
                await ctx.api.sendChatAction(ctx.chat.id, 'typing');
            } catch (error) {
                console.error('Ошибка при отправке действия "печатает...":', error);
            }
        }
    };

    // Запускаем интервал для отправки "печатает..." каждые 3 секунды
    typingInterval = setInterval(sendTyping, 3000);

    // Первоначально отправляем "печатает..."
    sendTyping();

    // Возвращаем объект с методом stop для остановки симуляции
    return {
        stop: () => {
            typing = false;
            clearInterval(typingInterval);
        },
    };
}

// Middleware для проверки членства только в личных сообщениях
bot.use(async (ctx, next) => {
    const chat = ctx.chat;

    if (!chat) {
        return next();
    }

    if (chat.type === 'private' && CHECK_MEMBERSHIP) {
        // Личные сообщения: проверяем членство пользователя в группе, только если CHECK_MEMBERSHIP = true
        const isMember = await isUserMemberOfGroup(ctx.from.id);
        if (!isMember) {
            await ctx.reply('Извините, но я общаюсь только с теми, кто состоит в группе @AIKaleidoscope.');
            return; // Не продолжаем обработку
        }
    }

    // Продолжаем обработку для всех остальных случаев
    return next();
});

// Обработка команды /start только в личных сообщениях с индивидуальным приветствием
bot.command('start', async (ctx) => {
    if (ctx.chat.type !== 'private') {
        // Игнорируем команду /start в группах
        return;
    }

    // Отправляем действие "печатает..."
    await sendTypingAction(ctx);

    // Извлекаем имя пользователя и санитизируем его
    const firstName = sanitizeHtml(ctx.from.first_name || 'Пользователь', {
        allowedTags: [],
        allowedAttributes: {},
    });

    // Формируем индивидуальное приветствие
    const welcomeMessage = `<b>Привет, ${firstName}!</b> Я Гермиона, рада тебя видеть. Чем могу помочь?`;
    await sendLongMessage(ctx, welcomeMessage);
});

bot.command('clean', async (ctx) => {
    await ctx.reply('Очищено', {
        reply_markup: { remove_keyboard: true },
    });
});

// Переименовываем кнопку меню с "Пользователь" на "Воспоминания"
bot.command('setting', async (ctx) => {
    const keyboard = new InlineKeyboard()
        .text('Воспоминания', 'about_user')
        .text('Используемая модель', 'about_model')
        .row()
        .text('Обновить воспоминания', 'refresh_memories')
        .text('Очистить воспоминания', 'clear_memories')
        .row()
        .text('Настройка длины ответов', 'adjust_max_tokens')
        .text('Настройка температуры', 'adjust_temperature');

    await ctx.reply('Здесь вы можете управлять настройками бота и вашими данными.', {
        reply_markup: keyboard,
    });
});

// Обработчик для кнопки "Воспоминания"
bot.callbackQuery('about_user', async (ctx) => {
    try {
        const userId = ctx.from?.id.toString();
        if (!userId) {
            await ctx.answerCallbackQuery({ text: 'Не удалось получить ваш идентификатор.' });
            return;
        }

        const session = globalContext[userId];
        if (!session || !session.memories || Object.keys(session.memories).length === 0) {
            await ctx.answerCallbackQuery({ text: 'У меня нет воспоминаний о вас.' });
            return;
        }

        await ctx.answerCallbackQuery(); // Закрываем всплывающее окно

        let memoriesText = 'Вот что я помню о вас:\n\n';
        Object.entries(session.memories).forEach(([date, memory]) => {
            memoriesText += `<b>Воспоминания за ${date}:</b>\n${memory.text}\n\n`;
        });

        await sendLongMessage(ctx, memoriesText);
    } catch (error) {
        console.error('Ошибка при получении информации о пользователе:', error);
        await ctx.answerCallbackQuery({
            text: 'Произошла ошибка. Пожалуйста, попробуйте позже.',
        });
    }
});

// Обработчик для кнопки "Используемая модель"
bot.callbackQuery('about_model', async (ctx) => {
    try {
        await ctx.answerCallbackQuery(); // Закрываем всплывающее окно
        await sendLongMessage(
            ctx,
            `Я использую модель Gemini с кодовым названием <b>"${sanitizeHtml(
                currentModelName,
                { allowedTags: [], allowedAttributes: {} }
            )}"</b> для общения с вами.`
        );
    } catch (error) {
        console.error('Ошибка при получении информации о модели:', error);
        await ctx.answerCallbackQuery({
            text: 'Произошла ошибка. Пожалуйста, попробуйте позже.',
        });
    }
});

// Функция для симуляции печатания
async function simulateTyping(ctx, chatId) {
    let isTyping = true;
    const typingInterval = setInterval(async () => {
        if (isTyping) {
            try {
                await ctx.api.sendChatAction(chatId, "typing");
            } catch (error) {
                console.error("Ошибка при отправке действия 'печатает':", error);
            }
        }
    }, 5000);  // Обновляем статус каждые 5 секунд

    return () => {
        isTyping = false;
        clearInterval(typingInterval);
    };
}

bot.callbackQuery('refresh_memories', async (ctx) => {
    try {
        const userId = ctx.from?.id.toString();
        if (!userId) {
            await ctx.answerCallbackQuery({ text: 'Не удалось получить ваш идентификатор.' });
            return;
        }

        const session = globalContext[userId];
        if (!session || !session.history || session.history.length === 0) {
            await ctx.answerCallbackQuery({ text: 'У вас нет истории для обобщения.' });
            return;
        }

        // Быстро отвечаем на callback query
        try {
            await ctx.answerCallbackQuery({ text: 'Начинаю обновление воспоминаний...' });
        } catch (error) {
            console.log('Не удалось ответить на callback query, продолжаем выполнение.');
        }

        // Отправляем сообщение о начале процесса
        const statusMessage = await ctx.reply('Обновляю воспоминания. Это может занять некоторое время...');

        // Запускаем симуляцию печатания
        const stopTyping = await simulateTyping(ctx, statusMessage.chat.id);

        // Асинхронно выполняем длительную операцию
        try {
            await generateSummary(session);
            
            // Останавливаем симуляцию печатания
            stopTyping();

            // Обновляем сообщение после успешного выполнения
            await ctx.api.editMessageText(
                statusMessage.chat.id, 
                statusMessage.message_id, 
                'Ваши воспоминания успешно обновлены.'
            );

            // Отправляем обновленные воспоминания
            if (session.memories && Object.keys(session.memories).length > 0) {
                let memoriesText = 'Вот ваши обновленные воспоминания:\n\n';
                Object.entries(session.memories).forEach(([date, memory]) => {
                    memoriesText += `<b>Воспоминания за ${date}:</b>\n${memory.text}\n\n`;
                });
                await sendLongMessage(ctx, memoriesText);
            } else {
                await ctx.reply('К сожалению, не удалось сгенерировать воспоминания.');
            }
        } catch (error) {
            console.error('Ошибка при обновлении воспоминаний:', error);
            
            // Останавливаем симуляцию печатания
            stopTyping();

            // В случае ошибки также обновляем сообщение
            await ctx.api.editMessageText(
                statusMessage.chat.id, 
                statusMessage.message_id, 
                'Произошла ошибка при обновлении воспоминаний. Пожалуйста, попробуйте позже.'
            );
        }
    } catch (error) {
        console.error('Ошибка при обработке запроса на обновление воспоминаний:', error);
        
        // Отправляем новое сообщение в случае любой ошибки
        await ctx.reply('Произошла ошибка при обработке запроса. Пожалуйста, попробуйте позже.');
    }
});

// Обработчик для кнопки "Очистить воспоминания"
bot.callbackQuery('clear_memories', async (ctx) => {
    try {
        await ctx.answerCallbackQuery(); // Закрываем всплывающее окно

        const confirmationKeyboard = new InlineKeyboard()
            .text('Да, удалить', 'confirm_clear_memories')
            .text('Отмена', 'cancel_clear_memories');

        await ctx.reply(
            'Это удалит все наши воспоминания. Вы уверены, что готовы пойти на этот шаг? Я забуду все наши беседы, и мы начнём заново.',
            {
                reply_markup: confirmationKeyboard,
            }
        );
    } catch (error) {
        console.error('Ошибка при запросе подтверждения очистки воспоминаний:', error);
        await ctx.answerCallbackQuery({
            text: 'Произошла ошибка. Пожалуйста, попробуйте позже.',
        });
    }
});

// Обработчик подтверждения очистки воспоминаний
bot.callbackQuery('confirm_clear_memories', async (ctx) => {
    try {
        const userId = ctx.from?.id.toString();
        if (!userId) {
            await ctx.answerCallbackQuery({ text: 'Не удалось получить ваш идентификатор.' });
            return;
        }

        // Очищаем историю и воспоминания
        globalContext[userId].history = [];
        globalContext[userId].memories = {};
        globalContext[userId].messageCountSinceSummary = 0;
        await saveContext(globalContext);

        await ctx.answerCallbackQuery({ text: 'Ваши воспоминания очищены.' });
        await sendLongMessage(
            ctx,
            'Я очистила все воспоминания о нашем общении. Мы можем начать заново!'
        );
    } catch (error) {
        console.error('Ошибка при очистке воспоминаний:', error);
        await ctx.answerCallbackQuery({
            text: 'Произошла ошибка. Пожалуйста, попробуйте позже.',
        });
    }
});

// Обработчик отмены очистки воспоминаний
bot.callbackQuery('cancel_clear_memories', async (ctx) => {
    try {
        await ctx.answerCallbackQuery({ text: 'Очистка воспоминаний отменена.' });
        await sendLongMessage(ctx, 'Хорошо, я продолжаю помнить всё, что было между нами.');
    } catch (error) {
        console.error('Ошибка при отмене очистки воспоминаний:', error);
        await ctx.answerCallbackQuery({
            text: 'Произошла ошибка. Пожалуйста, попробуйте позже.',
        });
    }
});

bot.callbackQuery('adjust_max_tokens', async (ctx) => {
    const userId = ctx.from.id.toString();
    const currentValue = globalContext[userId]?.maxOutputTokens || 700;
    
    const keyboard = new InlineKeyboard();
    for (let i = 100; i <= 1000; i += 100) {
        keyboard.text(i.toString(), `set_max_tokens_${i}`);
        if (i % 300 === 0) keyboard.row();
    }
    keyboard.row().text('Назад', 'back_to_settings');

    const description = 'Длина ответа определяет максимальное количество токенов (примерно слов) в ответе бота. ' +
                        'Большее значение позволяет получать более подробные ответы, но может увеличить время ожидания. ' +
                        'Меньшее значение дает более краткие ответы и ускоряет работу бота.';

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
        `${description}\n\nТекущая максимальная длина ответа: ${currentValue} токенов. Выберите новое значение:`,
        { reply_markup: keyboard }
    );
});

bot.callbackQuery('adjust_temperature', async (ctx) => {
    const userId = ctx.from.id.toString();
    const currentValue = globalContext[userId]?.temperature || 0.7;
    
    const keyboard = new InlineKeyboard();
    for (let i = 0.1; i <= 1; i += 0.1) {
        keyboard.text(i.toFixed(1), `set_temperature_${i.toFixed(1)}`);
        if (i % 0.3 === 0) keyboard.row();
    }
    keyboard.row().text('Назад', 'back_to_settings');

    const description = 'Температура влияет на креативность и непредсказуемость ответов бота. \n' +
                        'Низкая температура (0.1-0.3) делает ответы более логичными и предсказуемыми. \n' +
                        'Средняя температура (0.4-0.7) обеспечивает баланс между креативностью и последовательностью. \n' +
                        'Высокая температура (0.8-1.0) делает ответы более творческими и разнообразными, ' +
                        'но может снизить их точность.';

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
        `${description}\n\nТекущая температура: ${currentValue}. Выберите новое значение:`,
        { reply_markup: keyboard }
    );
});

bot.callbackQuery(/^set_max_tokens_/, async (ctx) => {
    const userId = ctx.from.id.toString();
    const newValue = parseInt(ctx.callbackQuery.data.split('_').pop());
    
    if (!globalContext[userId]) {
        globalContext[userId] = {};
    }
    globalContext[userId].maxOutputTokens = newValue;
    await saveContext(globalContext);

    await ctx.answerCallbackQuery({ text: `Максимальная длина ответа установлена на ${newValue} токенов.` });
    await ctx.editMessageText(`Новая максимальная длина ответа: ${newValue} токенов.`);
});

bot.callbackQuery(/^set_temperature_/, async (ctx) => {
    const userId = ctx.from.id.toString();
    const newValue = parseFloat(ctx.callbackQuery.data.split('_').pop());
    
    if (!globalContext[userId]) {
        globalContext[userId] = {};
    }
    globalContext[userId].temperature = newValue;
    await saveContext(globalContext);

    await ctx.answerCallbackQuery({ text: `Температура установлена на ${newValue}.` });
    await ctx.editMessageText(`Новая температура: ${newValue}.`);
});

bot.callbackQuery('back_to_settings', async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendSettingsMenu(ctx);
});

// Функция для отправки меню настроек
async function sendSettingsMenu(ctx) {
    const keyboard = new InlineKeyboard()
        .text('Воспоминания', 'about_user')
        .text('Используемая модель', 'about_model')
        .row()
        .text('Обновить воспоминания', 'refresh_memories')
        .text('Очистить воспоминания', 'clear_memories')
        .row()
        .text('Настройка длины ответов', 'adjust_max_tokens')
        .text('Настройка температуры', 'adjust_temperature');

    await ctx.editMessageText('Здесь вы можете управлять настройками бота и вашими данными.', {
        reply_markup: keyboard,
    });
}

function isMessageFromToday(messageDateString) {
    const today = new Date();
    const [datePart] = messageDateString.split(',');
    const [day, month, year] = datePart.split('.').map(Number);
    
    return (
        day === today.getDate() &&
        month - 1 === today.getMonth() && // В JavaScript месяцы начинаются с 0
        year === today.getFullYear()
    );
}

// Функция для группировки сообщений по дням
function groupMessagesByDay(messages) {
    const groupedMessages = {};
    messages.forEach(msg => {
        const date = msg.date.split(',')[0]; // Получаем только дату без времени
        if (!groupedMessages[date]) {
            groupedMessages[date] = [];
        }
        groupedMessages[date].push(msg);
    });
    return groupedMessages;
}

async function generateSummary(session) {
    try {
        const history = session.history;
        if (!history || history.length === 0) {
            console.log('История сообщений пуста.');
            return;
        }

        const groupedMessages = groupMessagesByDay(history);
        const today = new Date().toLocaleDateString('ru-RU');
        const memories = session.memories || {};

        for (const [date, messages] of Object.entries(groupedMessages)) {
            // Генерация воспоминаний для всех дней, включая сегодняшний
            if (!memories[date] || memories[date].text.trim().length === 0 || date === today) {
                const historyText = messages
                    .map((msg) => `${msg.role} (${msg.date}): ${msg.content}`)
                    .join('\n');

                const prompt = `Ты Гермиона Грейнджер и твоя задача, посмотрев на эту переписку за ${date}, составить полную информацию о собеседнике: кто он, как его зовут, сколько ему лет, твоё впечатление о нём. Перескажи кратко ключевые моменты ваших бесед за этот день, используя только HTML-теги для форматирования, избегая Markdown.`;

                const result = await summarizationModel.generateContent([
                    { text: `${prompt}\n${historyText}` },
                ]);

                if (!result.response) {
                    throw new Error(`Не удалось сгенерировать суммаризацию за ${date}`);
                }

                let summary = result.response.text();

                // Санитизируем суммаризацию
                summary = sanitizeHtml(summary, {
                    allowedTags: allowedTags,
                    allowedAttributes: allowedAttributes,
                    allowedClasses: {
                        span: ['tg-spoiler'],
                        code: ['language-python'],
                        pre: ['language-python'],
                        blockquote: ['expandable'],
                    },
                    allowedSchemes: ['http', 'https', 'tg'],
                    allowedSchemesByTag: {
                        a: ['http', 'https', 'tg'],
                    },
                });

                memories[date] = {
                    text: summary,
                    date: new Date().toLocaleString(),
                };
            }
        }

        // Сохраняем обновленные воспоминания
        session.memories = memories;

        // Удаляем сообщения за прошлые дни, но оставляем сообщения за сегодня
        session.history = groupedMessages[today] || [];

        await saveContext(globalContext);

        console.log('Суммаризация успешно сгенерирована.');
    } catch (error) {
        console.error('Ошибка при автоматическом обновлении воспоминаний:', error);
    }
}

// Инициализация модели для суммаризации с использованием 'gemini-1.5-flash'
const summarizationModel = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash-8b-001',
    systemInstruction: `
        Ты должна предоставить краткую суммаризацию переписки. 
        Описание должно быть чистым без синтаксических ошибок. хорошо структурированным. 
        Нужно пересказать основную информацю о собесденике Гермионы. 
        Его имя, возраст, увлечения, перескажи как Гермиона относится к своему собеседнику, 
        какие чувства он у неё вызывает. 
        Дожны быть  выделены ключевые моменты беседы. Постарайся хоошо это структурировать. 
        Это будут своеобразные воспоминания Гермионы.
        Поэтому это должно быть от её лица как будто бы она самая себя спросила что она помнит про своего собеседника. 
    `,
    generationConfig: {
        maxOutputTokens: 1500,
        temperature: 0.5,
    },
});

// Обработка входящих текстовых сообщений в личных сообщениях
bot.chatType('private').on('message:text', async (ctx) => {
    let userModel = null;
    try {
        const userMessage = ctx.message.text;
        const userId = ctx.from.id.toString();

        // Получаем индивидуальные настройки пользователя
        const userMaxTokens = globalContext[userId]?.maxOutputTokens || 700;
        const userTemperature = globalContext[userId]?.temperature || 0.7;

        // Создаем модель с пользовательскими настройками
        userModel = createModel(userMaxTokens, userTemperature);

        const userName = getUserName(ctx);
        const messageDate = new Date(ctx.message.date * 1000).toLocaleString();

        // Получение истории сообщений из сессии
        const history = ctx.session.history;
        const memories = ctx.session.memories || {};

        // Построение массива contents
        const contents = buildContents(history, memories, userName, userMessage, messageDate);

        // Запуск симуляции печати
        const typingSimulation = startTypingSimulation(ctx);

        // Генерация ответа от модели Gemini с учетом пользовательских настроек
        const result = await userModel.generateContent(contents);

        // Остановка симуляции печати
        typingSimulation.stop();

        // Односекундная задержка перед отправкой ответа пользователю
        await new Promise((resolve) => setTimeout(resolve, 1000));

        if (!result.response) {
            throw new Error('Не удалось сгенерировать ответ');
        }
        let botReply = result.response.text();

        // Санитизируем ответ перед отправкой
        botReply = sanitizeHtml(botReply, {
            allowedTags: allowedTags,
            allowedAttributes: allowedAttributes,
            allowedClasses: {
                span: ['tg-spoiler'],
                code: ['language-python'],
                pre: ['language-python'],
                blockquote: ['expandable'],
            },
            allowedSchemes: ['http', 'https', 'tg'],
            allowedSchemesByTag: {
                a: ['http', 'https', 'tg'],
            },
        });

        // Проверяем, что после санитизации бот не остался без ответа
        if (!botReply || botReply.trim() === '') {
            botReply = 'Извините, но я не смогла сформулировать ответ.';
        }

        // Обновление истории сообщений
        ctx.session.history.push({ role: userName, content: userMessage, date: messageDate });
        ctx.session.history.push({
            role: 'Гермиона',
            content: botReply,
            date: new Date().toLocaleString(),
        });

        // Увеличение счетчика сообщений
        ctx.session.messageCountSinceSummary =
            (ctx.session.messageCountSinceSummary || 0) + 2;
        if (ctx.session.messageCountSinceSummary >= 30) {
            await generateSummary(ctx.session);
            ctx.session.messageCountSinceSummary = 0;
        }

        // Отправка ответа пользователю
        await sendLongMessage(ctx, botReply);

    } catch (error) {
        console.error('Ошибка при обработке текстового сообщения:', error);
        await ctx.reply(
            'Произошла ошибка при обработке вашего сообщения. Пожалуйста, попробуйте позже.'
        );
    } finally {
        // Очистка модели после использования
        if (userModel) {
            cleanupModel(userModel);
        }
    }
});

function isBotMentionedOrRepliedTo(ctx) {
    // Проверка на упоминание бота
    const entities = ctx.message.entities || [];
    const isMentioned = entities.some((entity) => {
        return (
            entity.type === 'mention' &&
            ctx.message.text &&
            ctx.message.text
                .substring(entity.offset, entity.offset + entity.length)
                .toLowerCase() === `@${botInfo.username}`.toLowerCase()
        );
    });

    // Проверка на ответ на сообщение бота
    const isReply =
        ctx.message.reply_to_message &&
        ctx.message.reply_to_message.from &&
        ctx.message.reply_to_message.from.id === botInfo.id;

    return isMentioned || isReply;
}

// Обработчик изображений
bot.on('message:photo', async (ctx) => {
    let userModel = null;
    try {
        const chatType = ctx.chat.type;

        if (chatType === 'group' || chatType === 'supergroup') {
            // Получаем информацию о боте, если ещё не получена
            if (!botInfo) {
                botInfo = await bot.api.getMe();
            }
            const botId = botInfo.id;
            const botUsername = '@' + botInfo.username.toLowerCase();

            // Проверяем, упомянут ли бот в подписи
            const captionEntities = ctx.message.caption_entities || [];
            const isMentioned = captionEntities.some((entity) => {
                if (entity.type === 'mention' && ctx.message.caption) {
                    const mention = ctx.message.caption.substring(entity.offset, entity.offset + entity.length).toLowerCase();
                    return mention === botUsername;
                }
                return false;
            });

            // Проверяем, является ли сообщение ответом на сообщение бота
            const isReplyToBot = ctx.message.reply_to_message &&
                ctx.message.reply_to_message.from &&
                ctx.message.reply_to_message.from.id === botId;

            if (!isMentioned && !isReplyToBot) {
                // Если бот не упомянут и сообщение не является ответом на его сообщение, игнорируем
                return;
            }
        }

        const photos = ctx.message.photo;
        const caption = ctx.message.caption || '';
        const userId = ctx.from.id.toString();
        if (!photos || photos.length === 0) {
            await ctx.reply('Не удалось получить изображение.');
            return;
        }

        // Получаем индивидуальные настройки пользователя
        const userMaxTokens = globalContext[userId]?.maxOutputTokens || 700;
        const userTemperature = globalContext[userId]?.temperature || 0.7;

        // Создаем модель с пользовательскими настройками
        userModel = createModel(userMaxTokens, userTemperature);

        // Получаем файл с наивысшим разрешением
        const highestResPhoto = photos[photos.length - 1];
        const fileId = highestResPhoto.file_id;

        // Односекундная задержка перед отправкой на Gemini
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Скачиваем файл
        const localFilePath = await downloadTelegramFile(fileId);

        // Определяем MIME-тип
        let mimeType = 'image/jpeg'; // По умолчанию
        const fileExtension = path.extname(localFilePath).toLowerCase();
        if (fileExtension === '.png') {
            mimeType = 'image/png';
        } else if (fileExtension === '.webp') {
            mimeType = 'image/webp';
        } else if (fileExtension === '.heic') {
            mimeType = 'image/heic';
        } else if (fileExtension === '.heif') {
            mimeType = 'image/heif';
        }

        const supportedMimeTypes = [
            'image/jpeg',
            'image/png',
            'image/webp',
            'image/heic',
            'image/heif',
        ];
        if (!supportedMimeTypes.includes(mimeType)) {
            await ctx.reply('Извините, этот тип файла не поддерживается.');
            return;
        }

        const displayName = `User Image ${Date.now()}`;

        // Загружаем файл в Gemini File API
        const fileUri = await uploadFileToGemini(localFilePath, mimeType, displayName);

        // Удаляем локальный файл после загрузки
        await fs.unlink(localFilePath);

        let prompt;
        if (caption.trim().length > 0) {
            prompt = `${sanitizeHtml(caption.trim(), { allowedTags: [], allowedAttributes: {} })}`;
        } else {
            prompt = 'Опиши содержимое этого изображения.';
        }

        const userName = getUserName(ctx);
        const messageDate = new Date(ctx.message.date * 1000).toLocaleString();

        const history = ctx.session.history;
        const memories = ctx.session.memories || {};

        // Построение массива contents
        const contents = buildContents(history, memories, userName, prompt, messageDate);
        contents.push({
            fileData: {
                mimeType: mimeType,
                fileUri: fileUri,
            },
        });

        // Запуск симуляции печати
        const typingSimulation = startTypingSimulation(ctx);

        // Генерация ответа от модели Gemini
        const generateResult = await userModel.generateContent(contents);

        // Остановка симуляции печати
        typingSimulation.stop();

        // Односекундная задержка перед отправкой ответа пользователю
        await new Promise((resolve) => setTimeout(resolve, 1000));

        if (!generateResult.response) {
            throw new Error('Не удалось сгенерировать ответ');
        }
        let botReply = generateResult.response.text();

        // Санитизация и проверка ответа
        botReply = sanitizeHtml(botReply, {
            allowedTags: allowedTags,
            allowedAttributes: allowedAttributes,
            allowedClasses: {
                span: ['tg-spoiler'],
                code: ['language-python'],
                pre: ['language-python'],
                blockquote: ['expandable'],
            },
            allowedSchemes: ['http', 'https', 'tg'],
            allowedSchemesByTag: {
                a: ['http', 'https', 'tg'],
            },
        });

        if (!botReply || botReply.trim() === '') {
            botReply = 'Извините, но я не смогла обработать это изображение.';
        }

        // Обновление истории сообщений
        ctx.session.history.push({
            role: userName,
            content: `Отправил(а) изображение${caption ? ` с комментарием: "${caption}"` : ''}`,
            date: messageDate,
        });
        ctx.session.history.push({
            role: 'Гермиона',
            content: botReply,
            date: new Date().toLocaleString(),
        });

        // Увеличение счетчика сообщений
        ctx.session.messageCountSinceSummary = (ctx.session.messageCountSinceSummary || 0) + 2;
        if (ctx.session.messageCountSinceSummary >= 30) {
            await generateSummary(ctx.session);
            ctx.session.messageCountSinceSummary = 0;
        }

        // Опции для отправки сообщения
        let replyOptions = {};
        if (chatType === 'group' || chatType === 'supergroup') {
            replyOptions.reply_to_message_id = ctx.message.message_id;
        }

        // Отправка ответа пользователю
        await sendLongMessage(ctx, botReply, replyOptions);
    } catch (error) {
        console.error('Ошибка при обработке изображения:', error);
        await ctx.reply(
            'Произошла ошибка при обработке вашего изображения. Пожалуйста, попробуйте позже.',
            { reply_to_message_id: ctx.message.message_id }
        );
    } finally {
        // Очистка модели после использования
        if (userModel) {
            cleanupModel(userModel);
        }
    }
});


// Обработчик аудиосообщений
bot.on(['message:voice', 'message:audio'], async (ctx) => {
    let userModel = null;
    try {
        const chatType = ctx.chat.type;

        if (chatType === 'group' || chatType === 'supergroup') {
            // Получаем информацию о боте, если ещё не получена
            if (!botInfo) {
                botInfo = await bot.api.getMe();
            }
            const botId = botInfo.id;
            const botUsername = '@' + botInfo.username.toLowerCase();

            // Проверяем, упомянут ли бот в подписи
            const captionEntities = ctx.message.caption_entities || [];
            const isMentioned = captionEntities.some((entity) => {
                if (entity.type === 'mention' && ctx.message.caption) {
                    const mention = ctx.message.caption.substring(entity.offset, entity.offset + entity.length).toLowerCase();
                    return mention === botUsername;
                }
                return false;
            });

            // Проверяем, является ли сообщение ответом на сообщение бота
            const isReplyToBot = ctx.message.reply_to_message &&
                ctx.message.reply_to_message.from &&
                ctx.message.reply_to_message.from.id === botId;

            if (!isMentioned && !isReplyToBot) {
                // Если бот не упомянут и сообщение не является ответом на его сообщение, игнорируем
                return;
            }
        }

        let fileId;
        let mimeType;
        const userId = ctx.from.id.toString();

        if (ctx.message.voice) {
            fileId = ctx.message.voice.file_id;
            mimeType = 'audio/ogg';
        } else if (ctx.message.audio) {
            fileId = ctx.message.audio.file_id;
            mimeType = ctx.message.audio.mime_type || 'audio/mpeg';
        }

        if (!fileId) {
            await ctx.reply('Не удалось получить аудиосообщение.');
            return;
        }

        const supportedMimeTypes = [
            'audio/ogg',
            'audio/mpeg',
            'audio/wav',
            'audio/mp3',
            'audio/aac',
            'audio/flac',
        ];
        if (!supportedMimeTypes.includes(mimeType)) {
            await ctx.reply('Извините, этот тип аудиофайла не поддерживается.');
            return;
        }

        // Получаем индивидуальные настройки пользователя
        const userMaxTokens = globalContext[userId]?.maxOutputTokens || 700;
        const userTemperature = globalContext[userId]?.temperature || 0.7;

        // Создаем модель с пользовательскими настройками
        userModel = createModel(userMaxTokens, userTemperature);

        // Односекундная задержка перед отправкой на Gemini
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Скачиваем файл
        const localFilePath = await downloadTelegramFile(fileId);

        const displayName = `User Audio ${Date.now()}`;

        // Загружаем файл в Gemini File API
        const fileUri = await uploadFileToGemini(localFilePath, mimeType, displayName);

        // Удаляем локальный файл после загрузки
        await fs.unlink(localFilePath);

        const userName = getUserName(ctx);
        const messageDate = new Date(ctx.message.date * 1000).toLocaleString();

        const history = ctx.session.history;
        const memories = ctx.session.memories || {};

        // Построение массива contents
        const contents = buildContents(history, memories, userName, 'Отправил(а) аудиосообщение.', messageDate);
        contents.push({
            fileData: {
                mimeType: mimeType,
                fileUri: fileUri,
            },
        });

        // Запуск симуляции печати
        const typingSimulation = startTypingSimulation(ctx);

        // Генерация ответа от модели Gemini
        const generateResult = await userModel.generateContent(contents);

        // Остановка симуляции печати
        typingSimulation.stop();

        // Односекундная задержка перед отправкой ответа пользователю
        await new Promise((resolve) => setTimeout(resolve, 1000));

        if (!generateResult.response) {
            throw new Error('Не удалось сгенерировать ответ');
        }
        let botReply = generateResult.response.text();

        // Санитизация и проверка ответа
        botReply = sanitizeHtml(botReply, {
            allowedTags: allowedTags,
            allowedAttributes: allowedAttributes,
            allowedClasses: {
                span: ['tg-spoiler'],
                code: ['language-python'],
                pre: ['language-python'],
                blockquote: ['expandable'],
            },
            allowedSchemes: ['http', 'https', 'tg'],
            allowedSchemesByTag: {
                a: ['http', 'https', 'tg'],
            },
        });

        if (!botReply || botReply.trim() === '') {
            botReply = 'Извините, но я не смогла обработать это аудиосообщение.';
        }

        // Обновление истории сообщений
        ctx.session.history.push({
            role: userName,
            content: 'Отправил(а) аудиосообщение.',
            date: messageDate,
        });
        ctx.session.history.push({
            role: 'Гермиона',
            content: botReply,
            date: new Date().toLocaleString(),
        });

        // Увеличение счетчика сообщений
        ctx.session.messageCountSinceSummary = (ctx.session.messageCountSinceSummary || 0) + 2;
        if (ctx.session.messageCountSinceSummary >= 30) {
            await generateSummary(ctx.session);
            ctx.session.messageCountSinceSummary = 0;
        }

        // Опции для отправки сообщения
        let replyOptions = {};
        if (chatType === 'group' || chatType === 'supergroup') {
            replyOptions.reply_to_message_id = ctx.message.message_id;
        }

        // Отправка ответа пользователю
        await sendLongMessage(ctx, botReply, replyOptions);
    } catch (error) {
        console.error('Ошибка при обработке аудиосообщения:', error);
        await ctx.reply(
            'Произошла ошибка при обработке вашего аудиосообщения. Пожалуйста, попробуйте позже.',
            { reply_to_message_id: ctx.message.message_id }
        );
    } finally {
        // Очистка модели после использования
        if (userModel) {
            cleanupModel(userModel);
        }
    }
});


// Обработка сообщений в группах
bot.chatType(['group', 'supergroup']).on('message', async (ctx) => {
    try {
        const chat = ctx.chat;
        if (!chat) {
            // Если нет чата, игнорируем
            return;
        }

        // Получаем информацию о боте, если ещё не получено
        if (!botInfo) {
            try {
                botInfo = await bot.api.getMe();
            } catch (error) {
                console.error('Ошибка при получении информации о боте:', error);
                return;
            }
        }

        const botUsername = `@${botInfo.username}`;

        // Проверяем, упомянут ли бот или отвечает ли на сообщение бота
        const entities = ctx.message.entities || [];
        const isMentioned = entities.some((entity) => {
            return (
                entity.type === 'mention' &&
                ctx.message.text &&
                ctx.message.text
                    .substring(entity.offset, entity.offset + entity.length)
                    .toLowerCase() === botUsername.toLowerCase()
            );
        });

        const isReply =
            ctx.message.reply_to_message &&
            ctx.message.reply_to_message.from &&
            ctx.message.reply_to_message.from.id === botInfo.id;

        if (!isMentioned && !isReply) {
            // Если бот не упомянут и не является целью ответа, игнорируем
            return;
        }

        // Односекундная задержка перед отправкой на Gemini
        await new Promise((resolve) => setTimeout(resolve, 1000));

        let userMessage = '';

        if (isMentioned && ctx.message.text) {
            // Если бот упомянут, удаляем все упоминания из текста
            userMessage = ctx.message.text.replace(new RegExp(botUsername, 'gi'), '').trim();
        } else if (isReply && ctx.message.text) {
            // Если бот является целью ответа, используем весь текст
            userMessage = ctx.message.text.trim();
        } else {
            // В других случаях используем пустое сообщение
            userMessage = '';
        }

        const userName = getUserName(ctx);
        const messageDate = new Date(ctx.message.date * 1000).toLocaleString();

        // Получение истории сообщений из сессии
        const history = ctx.session.history;
        const memories = ctx.session.memories || {};

        // Построение массива contents
        const contents = buildContents(history, memories, userName, userMessage, messageDate);

        // Запуск симуляции печати
        const typingSimulation = startTypingSimulation(ctx);

        const userId = ctx.from.id.toString();
        const userMaxTokens = globalContext[userId]?.maxOutputTokens || 700;
        const userTemperature = globalContext[userId]?.temperature || 0.7;

        // Генерация ответа от модели Gemini
        const result = await model.generateContent(contents, {
            generationConfig: {
                maxOutputTokens: userMaxTokens,
                temperature: userTemperature,
            },
        });

        // Остановка симуляции печати
        typingSimulation.stop();

        // Односекундная задержка перед отправкой ответа пользователю
        await new Promise((resolve) => setTimeout(resolve, 1000));

        if (!result.response) {
            throw new Error('Не удалось сгенерировать ответ');
        }
        let botReply = result.response.text();

        // Санитизируем ответ перед отправкой
        botReply = sanitizeHtml(botReply, {
            allowedTags: allowedTags,
            allowedAttributes: allowedAttributes,
            allowedClasses: {
                span: ['tg-spoiler'],
                code: ['language-python'],
                pre: ['language-python'],
                blockquote: ['expandable'],
            },
            allowedSchemes: ['http', 'https', 'tg'],
            allowedSchemesByTag: {
                a: ['http', 'https', 'tg'],
            },
        });

        // Проверяем, что после санитизации бот не остался без ответа
        if (!botReply || botReply.trim() === '') {
            botReply = 'Извините, но я не смогла сформулировать ответ.';
        }

        // Обновление истории сообщений
        ctx.session.history.push({ role: userName, content: userMessage, date: messageDate });
        ctx.session.history.push({
            role: 'Гермиона',
            content: botReply,
            date: new Date().toLocaleString(),
        });

        // Увеличение счетчика сообщений
        ctx.session.messageCountSinceSummary =
            (ctx.session.messageCountSinceSummary || 0) + 2;
        if (ctx.session.messageCountSinceSummary >= 30) {
            await generateSummary(ctx.session);
            ctx.session.messageCountSinceSummary = 0;
        }

        // Отправка ответа в группу
        await sendLongMessage(ctx, botReply, { reply_to_message_id: ctx.message.message_id });
    } catch (error) {
        console.error('Ошибка при обработке сообщения в группе:', error);
        await ctx.reply(
            'Произошла ошибка при обработке вашего сообщения. Пожалуйста, попробуйте позже.',
            { reply_to_message_id: ctx.message.message_id }
        );
    }
});

// Обработка ошибок
bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Ошибка при обработке обновления ${ctx.update.update_id}:`);
    const e = err.error;
    if (e instanceof GrammyError) {
        console.error('Ошибка в запросе:', e.description);
    } else if (e instanceof HttpError) {
        console.error('Не удалось связаться с Telegram:', e);
    } else {
        console.error('Неизвестная ошибка:', e);
    }
});

/**
 * Функция для инициализации контекста при запуске
 */
async function initializeContext() {
    try {
        globalContext = await loadContext();
        console.log('Контекст успешно загружен из файла.');
    } catch (error) {
        console.error('Ошибка при загрузке контекста:', error);
        globalContext = {};
    }
    
    // Инициализация новых полей для каждого пользователя
    for (let userId in globalContext) {
        if (!globalContext[userId].maxOutputTokens) {
            globalContext[userId].maxOutputTokens = 700;
        }
        if (!globalContext[userId].temperature) {
            globalContext[userId].temperature = 0.7;
        }
    }
    
    await saveContext(globalContext);
}

/**
 * Функция запуска бота
 */
async function startBot() {
    try {
        // Инициализация контекста
        await initializeContext();

        // Получение информации о боте
        botInfo = await bot.api.getMe();
        console.log(`Бот запущен: @${botInfo.username}`);

        // Запуск бота
        await bot.start();
    } catch (error) {
        console.error('Ошибка при запуске бота:', error);
        process.exit(1);
    }
}

// Запуск бота
startBot();