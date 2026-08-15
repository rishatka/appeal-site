require('dotenv').config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");

// ============================
// НАСТРОЙКИ
// ============================
const PORT = process.env.PORT || 10000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const TICKET_CHANNEL_ID = process.env.TICKET_CHANNEL_ID || process.env.APPEAL_CHANNEL_ID;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID || "1538206195238572142";

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
// ПРОВЕРКА РАБОТЫ
// ============================
app.get("/", (req, res) => {
    res.json({
        status: "online",
        message: "Ticket API is working"
    });
});

// ============================
// СОЗДАНИЕ ТИКЕТА
// ============================
app.post("/api/tickets", async (req, res) => {
    try {
        const { userId, userName, subject, message, priority } = req.body;

        if (!userId || !userName || !subject || !message) {
            return res.status(400).json({
                success: false,
                message: "Заполните все поля."
            });
        }

        // Создаем тикет
        const { data, error } = await supabase
            .from("tickets")
            .insert({
                user_id: userId,
                user_name: userName,
                subject: subject,
                message: message,
                priority: priority || 'medium',
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

        // Создаем номер тикета
        const ticketNumber = "TK-" + String(data.id).padStart(6, "0");

        await supabase
            .from("tickets")
            .update({ ticket_number: ticketNumber })
            .eq("id", data.id);

        // ============================
        // ОТПРАВКА В DISCORD
        // ============================
        try {
            const channel = await discordClient.channels.fetch(TICKET_CHANNEL_ID);
            
            if (channel) {
                const priorityEmoji = {
                    low: '🟢',
                    medium: '🟡',
                    high: '🔴'
                }[priority] || '🟡';

                const embed = new EmbedBuilder()
                    .setTitle('🎫 Новый тикет')
                    .setColor(0x5865F2)
                    .setDescription(`**${userName}** создал(а) обращение.`)
                    .addFields(
                        { name: '📌 Номер', value: `\`${ticketNumber}\``, inline: true },
                        { name: '👤 Пользователь', value: `<@${userId}>`, inline: true },
                        { name: '📊 Приоритет', value: `${priorityEmoji} ${priority || 'medium'}`, inline: true },
                        { name: '📝 Тема', value: subject },
                        { name: '💬 Сообщение', value: message.length > 500 ? message.slice(0, 500) + '…' : message },
                        { name: '⏳ Статус', value: '🟢 Открыт', inline: true }
                    )
                    .setFooter({ text: 'Ticket System • Защищённая система' })
                    .setTimestamp();

                // Кнопки для тикета
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

                // Пинг роли саппорта
                const content = `<@&${STAFF_ROLE_ID}> 🆕 Новый тикет!`;

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
// ПОЛУЧЕНИЕ ТИКЕТА ПО НОМЕРУ
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

// ============================
// ПОЛУЧЕНИЕ ТИКЕТОВ ПОЛЬЗОВАТЕЛЯ
// ============================
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
// BUTTON INTERACTIONS (Discord)
// ============================
discordClient.on("interactionCreate", async (interaction) => {
    try {
        if (!interaction.isButton()) return;

        // Проверка прав (только для саппортов)
        if (!interaction.member || !interaction.member.roles.cache.has(STAFF_ROLE_ID)) {
            return interaction.reply({
                content: "❌ У вас нет прав для работы с тикетами.",
                ephemeral: true
            });
        }

        const [action, id] = interaction.customId.split("_");
        const ticketId = Number(id);

        // ============================
        // ВЗЯТЬ ТИКЕТ
        // ============================
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

            // Обновляем сообщение в Discord
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

        // ============================
        // ЗАКРЫТЬ ТИКЕТ
        // ============================
        if (action === "close") {
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

            if (data.status === "closed") {
                return interaction.reply({
                    content: "⚠️ Тикет уже закрыт.",
                    ephemeral: true
                });
            }

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

        // ============================
        // БЫСТРЫЙ ОТВЕТ
        // ============================
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

// ============================
// MODAL SUBMIT (Discord)
// ============================
discordClient.on("interactionCreate", async (interaction) => {
    try {
        if (!interaction.isModalSubmit()) return;

        // Закрытие тикета
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

            // Обновляем сообщение в Discord
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

        // Быстрый ответ
        if (interaction.customId.startsWith("quick_reply_")) {
            const ticketId = Number(interaction.customId.replace("quick_reply_", ""));
            const reply = interaction.fields.getTextInputValue("reply_text");

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
// ЗАПУСК БОТА
// ============================
if (DISCORD_TOKEN) {
    discordClient.login(DISCORD_TOKEN)
        .then(() => {
            console.log("🤖 Discord бот запущен!");
        })
        .catch((error) => {
            console.error("❌ Ошибка запуска бота:", error.message);
        });
} else {
    console.log("⚠️ Discord бот не запущен (нет токена)");
}
