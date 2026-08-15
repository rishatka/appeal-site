require('dotenv').config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, PermissionsBitField } = require("discord.js");

// ============================
// НАСТРОЙКИ
// ============================
const PORT = process.env.PORT || 10000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID || "1538206195238572142";
const GUILD_ID = process.env.GUILD_ID; // ID вашего сервера

// ============================
// КАТЕГОРИИ И КАНАЛЫ
// ============================
const CATEGORIES = {
    'technical': {
        name: 'Техническая поддержка',
        emoji: '🖥️',
        channelName: 'тех-поддержка'
    },
    'financial': {
        name: 'Финансовые вопросы',
        emoji: '💳',
        channelName: 'финансы'
    },
    'gameplay': {
        name: 'Игровые вопросы',
        emoji: '🎮',
        channelName: 'игровая-поддержка'
    },
    'moderation': {
        name: 'Модерация',
        emoji: '🛡️',
        channelName: 'модерация'
    },
    'other': {
        name: 'Общие вопросы',
        emoji: '📌',
        channelName: 'общие-вопросы'
    }
};

// ============================
// ПРОВЕРКА ПЕРЕМЕННЫХ
// ============================
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("❌ Ошибка: SUPABASE_URL или SUPABASE_SERVICE_KEY не заданы!");
    process.exit(1);
}

if (!DISCORD_TOKEN) {
    console.warn("⚠️ DISCORD_TOKEN не задан — бот не запустится!");
}

if (!GUILD_ID) {
    console.warn("⚠️ GUILD_ID не задан! Бот не сможет создавать каналы.");
}

// ============================
// ПОДКЛЮЧЕНИЕ К БАЗЕ ДАННЫХ
// ============================
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ============================
// DISCORD БОТ
// ============================
const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ============================
// EXPRESS
// ============================
const app = express();
app.use(express.json());
app.use(cors({ origin: "*" }));

// ============================
// ФУНКЦИЯ СОЗДАНИЯ КАНАЛОВ
// ============================
async function setupChannels() {
    if (!GUILD_ID) {
        console.log("⚠️ GUILD_ID не задан, пропускаем создание каналов");
        return {};
    }

    try {
        const guild = await discordClient.guilds.fetch(GUILD_ID);
        if (!guild) {
            console.error("❌ Сервер не найден! Проверьте GUILD_ID");
            return {};
        }

        console.log(`✅ Найден сервер: ${guild.name}`);
        console.log("🏗️ Начинаю настройку каналов...");

        const channelMap = {};

        // Ищем или создаём категорию "Тикеты"
        let ticketCategory = guild.channels.cache.find(
            c => c.type === ChannelType.GuildCategory && c.name === "Тикеты"
        );

        if (!ticketCategory) {
            console.log("📁 Создаю категорию 'Тикеты'...");
            ticketCategory = await guild.channels.create({
                name: "Тикеты",
                type: ChannelType.GuildCategory,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionsBitField.Flags.ViewChannel],
                    },
                    {
                        id: STAFF_ROLE_ID,
                        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                    }
                ]
            });
            console.log(`✅ Категория создана: ${ticketCategory.name}`);
        } else {
            console.log(`✅ Категория уже существует: ${ticketCategory.name}`);
        }

        // Создаём каналы для каждой категории
        for (const [key, cat] of Object.entries(CATEGORIES)) {
            const channelName = cat.channelName;
            
            let channel = guild.channels.cache.find(
                c => c.name === channelName && c.parentId === ticketCategory.id
            );

            if (!channel) {
                console.log(`📢 Создаю канал #${channelName}...`);
                channel = await guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildText,
                    parent: ticketCategory.id,
                    permissionOverwrites: [
                        {
                            id: guild.id,
                            deny: [PermissionsBitField.Flags.ViewChannel],
                        },
                        {
                            id: STAFF_ROLE_ID,
                            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
                        }
                    ]
                });
                console.log(`✅ Канал создан: #${channel.name} (ID: ${channel.id})`);
            } else {
                console.log(`✅ Канал уже существует: #${channel.name} (ID: ${channel.id})`);
            }

            channelMap[key] = channel.id;
        }

        console.log("✅ Настройка каналов завершена!");
        return channelMap;

    } catch (error) {
        console.error("❌ Ошибка при создании каналов:", error.message);
        return {};
    }
}

// ============================
// ГЛОБАЛЬНАЯ ПЕРЕМЕННАЯ ДЛЯ КАНАЛОВ
// ============================
let CHANNEL_MAP = {};

// ============================
// ПРОВЕРКА РАБОТЫ
// ============================
app.get("/", (req, res) => {
    res.json({
        status: "online",
        message: "Ticket API is working",
        channels: CHANNEL_MAP
    });
});

// ============================
// СОЗДАНИЕ ТИКЕТА
// ============================
app.post("/api/tickets", async (req, res) => {
    try {
        const { userId, userName, subject, message, priority, category } = req.body;

        if (!userId || !userName || !subject || !message || !category) {
            return res.status(400).json({
                success: false,
                message: "Заполните все поля."
            });
        }

        // Проверяем, есть ли канал для этой категории
        const channelId = CHANNEL_MAP[category];
        if (!channelId) {
            return res.status(500).json({
                success: false,
                message: "Канал для этой категории не найден. Попробуйте позже."
            });
        }

        // Создаем тикет в БД
        const { data, error } = await supabase
            .from("tickets")
            .insert({
                user_id: userId,
                user_name: userName,
                subject: subject,
                message: message,
                priority: priority || 'medium',
                category: category,
                status: 'open'
            })
            .select()
            .single();

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Ошибка базы данных."
            });
        }

        const ticketNumber = "TK-" + String(data.id).padStart(6, "0");

        await supabase
            .from("tickets")
            .update({ ticket_number: ticketNumber })
            .eq("id", data.id);

        // ============================
        // ОТПРАВКА В КАНАЛ
        // ============================
        try {
            const channel = await discordClient.channels.fetch(channelId);
            
            if (channel) {
                const priorityEmoji = { low: '🟢', medium: '🟡', high: '🔴' }[priority] || '🟡';
                const catInfo = CATEGORIES[category] || CATEGORIES['other'];

                const embed = new EmbedBuilder()
                    .setTitle('🎫 Новый тикет')
                    .setColor(0x5865F2)
                    .setDescription(`**${userName}** создал(а) обращение.`)
                    .addFields(
                        { name: '📌 Номер', value: `\`${ticketNumber}\``, inline: true },
                        { name: '👤 Пользователь', value: `<@${userId}>`, inline: true },
                        { name: '🏷️ Категория', value: `${catInfo.emoji} ${catInfo.name}`, inline: true },
                        { name: '📊 Приоритет', value: `${priorityEmoji} ${priority || 'medium'}`, inline: true },
                        { name: '📝 Тема', value: subject },
                        { name: '💬 Сообщение', value: message.length > 500 ? message.slice(0, 500) + '…' : message },
                        { name: '⏳ Статус', value: '🟢 Открыт', inline: true }
                    )
                    .setFooter({ text: `Ticket System • ${catInfo.name}` })
                    .setTimestamp();

                const buttons = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`take_${data.id}`)
                            .setLabel("Взять в работу")
                            .setEmoji("🛠️")
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId(`close_${data.id}`)
                            .setLabel("Закрыть тикет")
                            .setEmoji("🔒")
                            .setStyle(ButtonStyle.Danger),
                        new ButtonBuilder()
                            .setCustomId(`quick_reply_${data.id}`)
                            .setLabel("Быстрый ответ")
                            .setEmoji("⚡")
                            .setStyle(ButtonStyle.Success)
                    );

                const content = `<@&${STAFF_ROLE_ID}> 🆕 Новый тикет в категории ${catInfo.emoji} ${catInfo.name}!`;

                const message = await channel.send({
                    content: content,
                    embeds: [embed],
                    components: [buttons]
                });

                await supabase
                    .from("tickets")
                    .update({
                        discord_message_id: message.id,
                        discord_channel_id: channel.id
                    })
                    .eq("id", data.id);
            }
        } catch (discordError) {
            console.error("Ошибка отправки в Discord:", discordError.message);
        }

        res.json({
            success: true,
            ticketNumber: ticketNumber,
            ticketId: data.id
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "Произошла ошибка сервера."
        });
    }
});

// ============================
// ОСТАЛЬНЫЕ ЭНДПОЙНТЫ
// ============================
app.get("/api/tickets/:number", async (req, res) => {
    try {
        const number = req.params.number.toUpperCase();

        const { data, error } = await supabase
            .from("tickets")
            .select("*")
            .eq("ticket_number", number)
            .single();

        if (error || !data) {
            return res.status(404).json({
                success: false,
                message: "Тикет не найден."
            });
        }

        res.json({
            success: true,
            ticket: data
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "Ошибка сервера."
        });
    }
});

app.get("/api/tickets/user/:userId", async (req, res) => {
    try {
        const userId = req.params.userId;

        const { data, error } = await supabase
            .from("tickets")
            .select("*")
            .eq("user_id", userId)
            .order("created_at", { ascending: false });

        if (error) {
            return res.status(500).json({
                success: false,
                message: "Ошибка базы данных."
            });
        }

        res.json({
            success: true,
            tickets: data
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "Ошибка сервера."
        });
    }
});

// ============================
// DISCORD ИНТЕРАКЦИИ
// ============================
discordClient.on("interactionCreate", async (interaction) => {
    try {
        if (!interaction.isButton()) return;

        if (!interaction.member || !interaction.member.roles.cache.has(STAFF_ROLE_ID)) {
            return interaction.reply({
                content: "❌ У вас нет прав для работы с тикетами.",
                ephemeral: true
            });
        }

        const [action, id] = interaction.customId.split("_");
        const ticketId = Number(id);

        if (action === "take") {
            const { data, error } = await supabase
                .from("tickets")
                .select("*")
                .eq("id", ticketId)
                .single();

            if (error || !data) {
                return interaction.reply({
                    content: "❌ Тикет не найден.",
                    ephemeral: true
                });
            }

            if (data.status !== "open") {
                return interaction.reply({
                    content: "⚠️ Этот тикет уже закрыт или взят в работу.",
                    ephemeral: true
                });
            }

            await supabase
                .from("tickets")
                .update({
                    status: "in_progress",
                    assigned_to: interaction.user.id,
                    assigned_name: interaction.user.username,
                    updated_at: new Date().toISOString()
                })
                .eq("id", ticketId);

            const channel = await discordClient.channels.fetch(data.discord_channel_id);
            const message = await channel.messages.fetch(data.discord_message_id);

            const newEmbed = EmbedBuilder.from(message.embeds[0])
                .setColor(0xf0b400);

            const fields = newEmbed.data.fields || [];
            const statusField = fields.find(f => f.name === "⏳ Статус");
            if (statusField) {
                statusField.value = "🟡 В работе";
            }

            newEmbed.addFields(
                { name: "🛠️ Модератор", value: `<@${interaction.user.id}>` }
            );

            await message.edit({
                embeds: [newEmbed]
            });

            await interaction.reply({
                content: "✅ Тикет взят в работу!",
                ephemeral: true
            });
        }

        if (action === "close") {
            const modal = new ModalBuilder()
                .setCustomId(`close_reason_${ticketId}`)
                .setTitle("Закрытие тикета");

            const input = new TextInputBuilder()
                .setCustomId("close_reason")
                .setLabel("Причина закрытия")
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder("Кратко опишите причину закрытия...")
                .setRequired(false);

            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        }

        if (action === "quick_reply") {
            const modal = new ModalBuilder()
                .setCustomId(`quick_reply_${ticketId}`)
                .setTitle("Быстрый ответ");

            const input = new TextInputBuilder()
                .setCustomId("reply_text")
                .setLabel("Текст ответа")
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder("Введите ответ на тикет...")
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        }

    } catch (error) {
        console.error(error);
    }
});

discordClient.on("interactionCreate", async (interaction) => {
    try {
        if (!interaction.isModalSubmit()) return;

        if (interaction.customId.startsWith("close_reason_")) {
            const ticketId = Number(interaction.customId.replace("close_reason_", ""));
            const reason = interaction.fields.getTextInputValue("close_reason") || "Причина не указана";

            const { data, error } = await supabase
                .from("tickets")
                .select("*")
                .eq("id", ticketId)
                .single();

            if (error || !data) {
                return interaction.reply({
                    content: "❌ Тикет не найден.",
                    ephemeral: true
                });
            }

            await supabase
                .from("tickets")
                .update({
                    status: "closed",
                    updated_at: new Date().toISOString(),
                    closed_at: new Date().toISOString()
                })
                .eq("id", ticketId);

            const channel = await discordClient.channels.fetch(data.discord_channel_id);
            const message = await channel.messages.fetch(data.discord_message_id);

            const newEmbed = EmbedBuilder.from(message.embeds[0])
                .setColor(0xED4245);

            const fields = newEmbed.data.fields || [];
            const statusField = fields.find(f => f.name === "⏳ Статус");
            if (statusField) {
                statusField.value = "🔴 Закрыт";
            }

            newEmbed.addFields(
                { name: "🔒 Причина закрытия", value: reason }
            );

            await message.edit({
                embeds: [newEmbed],
                components: []
            });

            await interaction.reply({
                content: "✅ Тикет закрыт!",
                ephemeral: true
            });
        }

        if (interaction.customId.startsWith("quick_reply_")) {
            const ticketId = Number(interaction.customId.replace("quick_reply_", ""));
            const reply = interaction.fields.getTextInputValue("reply_text");

            await interaction.reply({
                content: `✅ Быстрый ответ отправлен!\n\n📝 **Ответ:**\n${reply}`,
                ephemeral: true
            });
        }

    } catch (error) {
        console.error(error);
    }
});

// ============================
// ЗАПУСК
// ============================
app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ API запущен на порту ${PORT}`);
    console.log(`📊 Supabase URL: ${SUPABASE_URL}`);
});

// ============================
// ЗАПУСК БОТА И НАСТРОЙКА КАНАЛОВ
// ============================
if (DISCORD_TOKEN) {
    discordClient.login(DISCORD_TOKEN)
        .then(async () => {
            console.log("🤖 Discord бот запущен!");
            
            // Настраиваем каналы
            CHANNEL_MAP = await setupChannels();
            
            console.log("📋 ID каналов:");
            for (const [key, id] of Object.entries(CHANNEL_MAP)) {
                console.log(`   ${key}: ${id}`);
            }
        })
        .catch((error) => {
            console.error("❌ Ошибка запуска бота:", error.message);
        });
} else {
    console.log("⚠️ Discord бот не запущен (нет токена)");
}
