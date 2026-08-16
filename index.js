require('dotenv').config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType } = require("discord.js");
const crypto = require('crypto');

// ============================
// НАСТРОЙКИ
// ============================
const PORT = process.env.PORT || 10000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID || "1538206195238572142";
const GUILD_ID = process.env.GUILD_ID;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "my-super-secret-key-32chars!!!";

// ============================
// ШИФРОВАНИЕ
// ============================
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

function encrypt(text) {
    if (!text) return text;
    try {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)), iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
        console.error('Ошибка шифрования:', error);
        return text;
    }
}

function decrypt(text) {
    if (!text || !text.includes(':')) return text;
    try {
        const parts = text.split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const encryptedText = parts[1];
        const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').slice(0, 32)), iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        console.error('Ошибка дешифрования:', error);
        return text;
    }
}

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
// ID КАНАЛОВ
// ============================
let TICKET_CHANNEL_ID = null;
let APPEAL_CHANNEL_ID = null;

// ============================
// НАСТРОЙКА КАНАЛОВ
// ============================
async function setupChannels() {
    if (!GUILD_ID) {
        console.log("⚠️ GUILD_ID не задан, пропускаем создание каналов");
        return;
    }

    try {
        const guild = await discordClient.guilds.fetch(GUILD_ID);
        if (!guild) {
            console.error("❌ Сервер не найден! Проверьте GUILD_ID");
            return;
        }

        console.log(`✅ Найден сервер: ${guild.name}`);
        console.log("🏗️ Настраиваю каналы...");

        // ===== КАНАЛ ДЛЯ ТИКЕТОВ =====
        let ticketChannel = guild.channels.cache.find(
            c => c.name === "тикеты" && c.type === ChannelType.GuildText
        );

        if (!ticketChannel) {
            const channels = await guild.channels.fetch();
            ticketChannel = channels.find(
                c => c.name === "тикеты" && c.type === ChannelType.GuildText
            );
        }

        if (!ticketChannel) {
            console.log("📢 Создаю канал #тикеты...");
            ticketChannel = await guild.channels.create({
                name: "тикеты",
                type: ChannelType.GuildText
            });
            console.log(`✅ Канал создан: #${ticketChannel.name} (ID: ${ticketChannel.id})`);
        } else {
            console.log(`✅ Канал уже существует: #${ticketChannel.name} (ID: ${ticketChannel.id})`);
        }

        TICKET_CHANNEL_ID = ticketChannel.id;

        // ===== КАНАЛ ДЛЯ АПЕЛЛЯЦИЙ =====
        let appealChannel = guild.channels.cache.find(
            c => c.name === "апелляции" && c.type === ChannelType.GuildText
        );

        if (!appealChannel) {
            const channels = await guild.channels.fetch();
            appealChannel = channels.find(
                c => c.name === "апелляции" && c.type === ChannelType.GuildText
            );
        }

        if (!appealChannel) {
            console.log("📢 Создаю канал #апелляции...");
            appealChannel = await guild.channels.create({
                name: "апелляции",
                type: ChannelType.GuildText
            });
            console.log(`✅ Канал создан: #${appealChannel.name} (ID: ${appealChannel.id})`);
        } else {
            console.log(`✅ Канал уже существует: #${appealChannel.name} (ID: ${appealChannel.id})`);
        }

        APPEAL_CHANNEL_ID = appealChannel.id;

        console.log("✅ Настройка каналов завершена!");
        console.log(`📋 ID каналов:`);
        console.log(`   Тикеты: ${TICKET_CHANNEL_ID}`);
        console.log(`   Апелляции: ${APPEAL_CHANNEL_ID}`);

    } catch (error) {
        console.error("❌ Ошибка при создании каналов:", error.message);
    }
}

// ============================
// ПРОВЕРКА РАБОТЫ
// ============================
app.get("/", (req, res) => {
    res.json({
        status: "online",
        message: "API is working",
        channels: {
            tickets: TICKET_CHANNEL_ID,
            appeals: APPEAL_CHANNEL_ID
        }
    });
});

// ============================
// 1. АПЕЛЛЯЦИИ
// ============================
app.post("/api/appeals", async (req, res) => {
    try {
        const { discord, nickname, punishment, reason } = req.body;

        if (!discord || !nickname || !punishment || !reason) {
            return res.status(400).json({
                success: false,
                message: "Заполните все поля."
            });
        }

        const encryptedNickname = encrypt(nickname);
        const encryptedPunishment = encrypt(punishment);
        const encryptedReason = encrypt(reason);

        const { data, error } = await supabase
            .from("appeals")
            .insert({
                discord_id: discord,
                discord_username: encryptedNickname,
                punishment: encryptedPunishment,
                reason: encryptedReason,
                status: "pending"
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

        const appealNumber = "AP-" + String(data.id).padStart(6, "0");

        await supabase
            .from("appeals")
            .update({ appeal_number: appealNumber })
            .eq("id", data.id);

        try {
            if (APPEAL_CHANNEL_ID) {
                const channel = await discordClient.channels.fetch(APPEAL_CHANNEL_ID);
                
                if (channel) {
                    const embed = new EmbedBuilder()
                        .setTitle('📝 Новая апелляция')
                        .setColor(0x5865F2)
                        .addFields(
                            { name: '📌 Номер', value: `\`${appealNumber}\``, inline: true },
                            { name: '👤 Пользователь', value: `<@${discord}>`, inline: true },
                            { name: '📛 Ник', value: nickname, inline: true },
                            { name: '⚖️ Наказание', value: punishment },
                            { name: '💬 Причина', value: reason },
                            { name: '⏳ Статус', value: '🟡 На рассмотрении', inline: true }
                        )
                        .setFooter({ text: '🔐 Защищённая система' })
                        .setTimestamp();

                    const buttons = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`appeal_approve_${data.id}`)
                                .setLabel("Одобрить")
                                .setEmoji("✅")
                                .setStyle(ButtonStyle.Success),
                            new ButtonBuilder()
                                .setCustomId(`appeal_reject_${data.id}`)
                                .setLabel("Отклонить")
                                .setEmoji("❌")
                                .setStyle(ButtonStyle.Danger)
                        );

                    const content = `<@&${STAFF_ROLE_ID}> 📝 Новая апелляция!`;

                    const sentMessage = await channel.send({
                        content: content,
                        embeds: [embed],
                        components: [buttons]
                    });

                    await supabase
                        .from("appeals")
                        .update({
                            discord_message_id: sentMessage.id,
                            discord_channel_id: channel.id
                        })
                        .eq("id", data.id);
                }
            }
        } catch (discordError) {
            console.error("Ошибка отправки в Discord:", discordError.message);
        }

        res.json({
            success: true,
            appealNumber: appealNumber
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
// ПОЛУЧЕНИЕ АПЕЛЛЯЦИИ
// ============================
app.get("/api/appeals/:number", async (req, res) => {
    try {
        const number = req.params.number.toUpperCase();

        const { data, error } = await supabase
            .from("appeals")
            .select("*")
            .eq("appeal_number", number)
            .single();

        if (error || !data) {
            return res.status(404).json({
                success: false,
                message: "Апелляция не найдена."
            });
        }

        if (data.discord_username) data.discord_username = decrypt(data.discord_username);
        if (data.punishment) data.punishment = decrypt(data.punishment);
        if (data.reason) data.reason = decrypt(data.reason);

        res.json({
            success: true,
            appeal: data
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
// ПОЛУЧЕНИЕ АПЕЛЛЯЦИЙ ПОЛЬЗОВАТЕЛЯ
// ============================
app.get("/api/appeals/user/:userId", async (req, res) => {
    try {
        const userId = req.params.userId;

        const { data, error } = await supabase
            .from("appeals")
            .select("*")
            .eq("discord_id", userId)
            .order("created_at", { ascending: false });

        if (error) {
            return res.status(500).json({
                success: false,
                message: "Ошибка базы данных."
            });
        }

        data.forEach(appeal => {
            if (appeal.discord_username) appeal.discord_username = decrypt(appeal.discord_username);
            if (appeal.punishment) appeal.punishment = decrypt(appeal.punishment);
            if (appeal.reason) appeal.reason = decrypt(appeal.reason);
        });

        res.json({
            success: true,
            appeals: data
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
// 2. ТИКЕТЫ
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

        const encryptedUserName = encrypt(userName);
        const encryptedSubject = encrypt(subject);
        const encryptedMessage = encrypt(message);

        const { data, error } = await supabase
            .from("tickets")
            .insert({
                user_id: userId,
                user_name: encryptedUserName,
                subject: encryptedSubject,
                message: encryptedMessage,
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

        try {
            if (TICKET_CHANNEL_ID) {
                const channel = await discordClient.channels.fetch(TICKET_CHANNEL_ID);
                
                if (channel) {
                    const priorityEmoji = { low: '🟢', medium: '🟡', high: '🔴' }[priority] || '🟡';
                    const catNames = {
                        'technical': '🖥️ Техническая проблема',
                        'financial': '💳 Финансовый вопрос',
                        'gameplay': '🎮 Игровой вопрос',
                        'moderation': '🛡️ Модерация',
                        'other': '📌 Другое'
                    };
                    const categoryName = catNames[category] || category;

                    const embed = new EmbedBuilder()
                        .setTitle('🎫 Новый тикет')
                        .setColor(0x5865F2)
                        .setDescription(`**${userName}** создал(а) обращение.`)
                        .addFields(
                            { name: '📌 Номер', value: `\`${ticketNumber}\``, inline: true },
                            { name: '👤 Пользователь', value: `<@${userId}>`, inline: true },
                            { name: '🏷️ Категория', value: categoryName, inline: true },
                            { name: '📊 Приоритет', value: `${priorityEmoji} ${priority || 'medium'}`, inline: true },
                            { name: '📝 Тема', value: subject },
                            { name: '💬 Сообщение', value: message.length > 500 ? message.slice(0, 500) + '…' : message },
                            { name: '⏳ Статус', value: '🟢 Открыт', inline: true }
                        )
                        .setFooter({ text: '🔐 Защищённая система' })
                        .setTimestamp();

                    const buttons = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(`ticket_take_${data.id}`)
                                .setLabel("Взять в работу")
                                .setEmoji("🛠️")
                                .setStyle(ButtonStyle.Primary),
                            new ButtonBuilder()
                                .setCustomId(`ticket_close_${data.id}`)
                                .setLabel("Закрыть тикет")
                                .setEmoji("🔒")
                                .setStyle(ButtonStyle.Danger),
                            new ButtonBuilder()
                                .setCustomId(`ticket_reply_${data.id}`)
                                .setLabel("Быстрый ответ")
                                .setEmoji("⚡")
                                .setStyle(ButtonStyle.Success)
                        );

                    const content = `<@&${STAFF_ROLE_ID}> 🆕 Новый тикет!`;

                    const sentMessage = await channel.send({
                        content: content,
                        embeds: [embed],
                        components: [buttons]
                    });

                    await supabase
                        .from("tickets")
                        .update({
                            discord_message_id: sentMessage.id,
                            discord_channel_id: channel.id
                        })
                        .eq("id", data.id);
                }
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
// ПОЛУЧЕНИЕ ТИКЕТА
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

        if (data.user_name) data.user_name = decrypt(data.user_name);
        if (data.subject) data.subject = decrypt(data.subject);
        if (data.message) data.message = decrypt(data.message);

        const repliesResponse = await supabase
            .from("ticket_replies")
            .select("*")
            .eq("ticket_id", data.id)
            .order("created_at", { ascending: true });

        let replies = [];
        if (repliesResponse.data) {
            replies = repliesResponse.data.map(reply => {
                if (reply.content) reply.content = decrypt(reply.content);
                if (reply.author_name) reply.author_name = decrypt(reply.author_name);
                return reply;
            });
        }

        res.json({
            success: true,
            ticket: data,
            replies: replies
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

        data.forEach(ticket => {
            if (ticket.user_name) ticket.user_name = decrypt(ticket.user_name);
            if (ticket.subject) ticket.subject = decrypt(ticket.subject);
            if (ticket.message) ticket.message = decrypt(ticket.message);
        });

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
// ОТВЕТЫ НА ТИКЕТЫ
// ============================
app.post("/api/tickets/:ticketId/replies", async (req, res) => {
    try {
        const ticketId = parseInt(req.params.ticketId);
        const { authorId, authorName, content, isModerator } = req.body;

        if (!content) {
            return res.status(400).json({
                success: false,
                message: "Введите текст ответа."
            });
        }

        const encryptedContent = encrypt(content);
        const encryptedAuthorName = encrypt(authorName || 'Система');

        const { data, error } = await supabase
            .from("ticket_replies")
            .insert({
                ticket_id: ticketId,
                author_id: authorId || 'system',
                author_name: encryptedAuthorName,
                content: encryptedContent,
                is_moderator: isModerator || false
            })
            .select()
            .single();

        if (error) {
            console.error(error);
            return res.status(500).json({
                success: false,
                message: "Ошибка сохранения ответа."
            });
        }

        if (data.content) data.content = decrypt(data.content);
        if (data.author_name) data.author_name = decrypt(data.author_name);

        res.json({
            success: true,
            reply: data
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
// 3. ОБРАБОТКА КНОПОК В DISCORD
// ============================

// ===== АПЕЛЛЯЦИИ =====
discordClient.on("interactionCreate", async (interaction) => {
    try {
        if (!interaction.isButton()) return;
        if (!interaction.customId.startsWith("appeal_")) return;

        if (!interaction.member || !interaction.member.roles.cache.has(STAFF_ROLE_ID)) {
            return interaction.reply({
                content: "❌ У вас нет прав для рассмотрения апелляций.",
                ephemeral: true
            });
        }

        const [_, action, id] = interaction.customId.split("_");
        const appealId = Number(id);

        if (action === "approve") {
            await decideAppeal(interaction, appealId, "approved", "Одобрено администрацией.");
        } else if (action === "reject") {
            const modal = new ModalBuilder()
                .setCustomId(`appeal_reject_modal_${appealId}`)
                .setTitle("Причина отклонения");

            const input = new TextInputBuilder()
                .setCustomId("reject_reason")
                .setLabel("Причина")
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder("Напишите причину отклонения...")
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        }

    } catch (error) {
        console.error(error);
    }
});

// ===== МОДАЛКА АПЕЛЛЯЦИИ =====
discordClient.on("interactionCreate", async (interaction) => {
    try {
        if (!interaction.isModalSubmit()) return;
        if (!interaction.customId.startsWith("appeal_reject_modal_")) return;

        const appealId = Number(interaction.customId.replace("appeal_reject_modal_", ""));
        const reason = interaction.fields.getTextInputValue("reject_reason");

        await decideAppeal(interaction, appealId, "rejected", reason);

    } catch (error) {
        console.error(error);
    }
});

async function decideAppeal(interaction, id, status, decisionReason) {
    const { data, error } = await supabase
        .from("appeals")
        .select("*")
        .eq("id", id)
        .single();

    if (error || !data) {
        return interaction.reply({
            content: "❌ Апелляция не найдена.",
            ephemeral: true
        });
    }

    if (data.status !== "pending") {
        return interaction.reply({
            content: "⚠️ Эта апелляция уже рассмотрена.",
            ephemeral: true
        });
    }

    const moderator = interaction.user;

    await supabase
        .from("appeals")
        .update({
            status: status,
            decision_reason: decisionReason,
            moderator_id: moderator.id,
            moderator_username: moderator.username,
            decided_at: new Date().toISOString()
        })
        .eq("id", id);

    try {
        const channel = await discordClient.channels.fetch(data.discord_channel_id);
        const msg = await channel.messages.fetch(data.discord_message_id);

        const newEmbed = EmbedBuilder.from(msg.embeds[0])
            .setColor(status === "approved" ? 0x57F287 : 0xED4245);

        const fields = newEmbed.data.fields || [];
        const statusField = fields.find(f => f.name === "⏳ Статус");
        if (statusField) {
            statusField.value = status === "approved" ? "🟢 Одобрена" : "🔴 Отклонена";
        }

        newEmbed.addFields(
            { name: "📌 Решение", value: decisionReason },
            { name: "👤 Модератор", value: `<@${moderator.id}>` }
        );

        await msg.edit({
            embeds: [newEmbed],
            components: []
        });
    } catch (discordError) {
        console.error("Ошибка обновления сообщения:", discordError.message);
    }

    await interaction.reply({
        content: status === "approved" ? "✅ Апелляция одобрена." : "❌ Апелляция отклонена.",
        ephemeral: true
    });
}

// ===== ТИКЕТЫ =====
discordClient.on("interactionCreate", async (interaction) => {
    try {
        if (!interaction.isButton()) return;
        if (!interaction.customId.startsWith("ticket_")) return;

        if (!interaction.member || !interaction.member.roles.cache.has(STAFF_ROLE_ID)) {
            return interaction.reply({
                content: "❌ У вас нет прав для работы с тикетами.",
                ephemeral: true
            });
        }

        const [_, action, id] = interaction.customId.split("_");
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
                    content: "⚠️ Тикет уже закрыт или взят в работу.",
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
            const msg = await channel.messages.fetch(data.discord_message_id);

            const newEmbed = EmbedBuilder.from(msg.embeds[0])
                .setColor(0xf0b400);

            const fields = newEmbed.data.fields || [];
            const statusField = fields.find(f => f.name === "⏳ Статус");
            if (statusField) {
                statusField.value = "🟡 В работе";
            }

            newEmbed.addFields(
                { name: "🛠️ Модератор", value: `<@${interaction.user.id}>` }
            );

            await msg.edit({
                embeds: [newEmbed]
            });

            await interaction.reply({
                content: "✅ Тикет взят в работу!",
                ephemeral: true
            });
        }

        if (action === "close") {
            const modal = new ModalBuilder()
                .setCustomId(`ticket_close_modal_${ticketId}`)
                .setTitle("Закрытие тикета");

            const input = new TextInputBuilder()
                .setCustomId("close_reason")
                .setLabel("Причина закрытия")
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder("Кратко опишите причину...")
                .setRequired(false);

            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        }

        if (action === "reply") {
            const modal = new ModalBuilder()
                .setCustomId(`ticket_reply_modal_${ticketId}`)
                .setTitle("Быстрый ответ");

            const input = new TextInputBuilder()
                .setCustomId("reply_text")
                .setLabel("Текст ответа")
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder("Введите ответ...")
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
        }

    } catch (error) {
        console.error(error);
    }
});

// ===== МОДАЛКИ ТИКЕТОВ =====
discordClient.on("interactionCreate", async (interaction) => {
    try {
        if (!interaction.isModalSubmit()) return;

        if (interaction.customId.startsWith("ticket_close_modal_")) {
            const ticketId = Number(interaction.customId.replace("ticket_close_modal_", ""));
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
            const msg = await channel.messages.fetch(data.discord_message_id);

            const newEmbed = EmbedBuilder.from(msg.embeds[0])
                .setColor(0xED4245);

            const fields = newEmbed.data.fields || [];
            const statusField = fields.find(f => f.name === "⏳ Статус");
            if (statusField) {
                statusField.value = "🔴 Закрыт";
            }

            newEmbed.addFields(
                { name: "🔒 Причина закрытия", value: reason }
            );

            await msg.edit({
                embeds: [newEmbed],
                components: []
            });

            await interaction.reply({
                content: "✅ Тикет закрыт!",
                ephemeral: true
            });
        }

        if (interaction.customId.startsWith("ticket_reply_modal_")) {
            const ticketId = Number(interaction.customId.replace("ticket_reply_modal_", ""));
            const reply = interaction.fields.getTextInputValue("reply_text");

            try {
                const { data: ticketData, error: ticketError } = await supabase
                    .from("tickets")
                    .select("*")
                    .eq("id", ticketId)
                    .single();

                if (ticketError || !ticketData) {
                    return interaction.reply({
                        content: "❌ Тикет не найден.",
                        ephemeral: true
                    });
                }

                const encryptedReply = encrypt(reply);
                const encryptedAuthorName = encrypt(interaction.user.username);

                await supabase
                    .from("ticket_replies")
                    .insert({
                        ticket_id: ticketId,
                        author_id: interaction.user.id,
                        author_name: encryptedAuthorName,
                        content: encryptedReply,
                        is_moderator: true
                    });

                const channel = await discordClient.channels.fetch(ticketData.discord_channel_id);
                const msg = await channel.messages.fetch(ticketData.discord_message_id);

                const embed = EmbedBuilder.from(msg.embeds[0]);
                embed.addFields(
                    { name: `💬 Ответ от ${interaction.user.username}`, value: reply }
                );

                await msg.edit({
                    embeds: [embed]
                });

                await interaction.reply({
                    content: `✅ Ответ сохранён в БД и отправлен в канал!`,
                    ephemeral: true
                });

            } catch (error) {
                console.error(error);
                await interaction.reply({
                    content: "❌ Ошибка при сохранении ответа.",
                    ephemeral: true
                });
            }
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
    console.log(`🔐 Шифрование включено`);
});

// ============================
// ЗАПУСК БОТА
// ============================
if (DISCORD_TOKEN) {
    discordClient.login(DISCORD_TOKEN)
        .then(async () => {
            console.log("🤖 Discord бот запущен!");
            await setupChannels();
        })
        .catch((error) => {
            console.error("❌ Ошибка запуска бота:", error.message);
        });
} else {
    console.log("⚠️ Discord бот не запущен (нет токена)");
}
