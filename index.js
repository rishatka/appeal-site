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
const APPEAL_CHANNEL_ID = process.env.APPEAL_CHANNEL_ID;
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID;

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

if (!APPEAL_CHANNEL_ID) {
    console.warn("⚠️ APPEAL_CHANNEL_ID не задан!");
}

if (!STAFF_ROLE_ID) {
    console.warn("⚠️ STAFF_ROLE_ID не задан!");
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
        message: "Appeal API is working"
    });
});

// ============================
// СОЗДАНИЕ АПЕЛЛЯЦИИ
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

        // Создаем запись
        const { data, error } = await supabase
            .from("appeals")
            .insert({
                discord_id: discord,
                discord_username: nickname,
                punishment: punishment,
                reason: reason,
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

        // Создаем номер апелляции
        const appealNumber = "AP-" + String(data.id).padStart(6, "0");

        await supabase
            .from("appeals")
            .update({ appeal_number: appealNumber })
            .eq("id", data.id);

        // ============================
        // ОТПРАВКА В DISCORD
        // ============================
        try {
            const channel = await discordClient.channels.fetch(APPEAL_CHANNEL_ID);
            
            if (channel) {
                const embed = new EmbedBuilder()
                    .setTitle("📝 Новая апелляция")
                    .setColor(0x5865F2)
                    .addFields(
                        { name: "Номер", value: `\`${appealNumber}\``, inline: true },
                        { name: "Discord", value: `<@${discord}>`, inline: true },
                        { name: "Ник", value: nickname, inline: true },
                        { name: "Наказание", value: punishment },
                        { name: "Причина", value: reason },
                        { name: "Статус", value: "🟡 На рассмотрении" }
                    )
                    .setTimestamp();

                const buttons = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`approve_${data.id}`)
                            .setLabel("Одобрить")
                            .setEmoji("✅")
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`reject_${data.id}`)
                            .setLabel("Отклонить")
                            .setEmoji("❌")
                            .setStyle(ButtonStyle.Danger)
                    );

                const message = await channel.send({
                    embeds: [embed],
                    components: [buttons]
                });

                await supabase
                    .from("appeals")
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
// ПОЛУЧЕНИЕ СТАТУСА
// ============================
app.get("/api/appeals/:number", async (req, res) => {
    try {
        const number = req.params.number.toUpperCase();

        const { data, error } = await supabase
            .from("appeals")
            .select("appeal_number, discord_username, punishment, status, decision_reason, moderator_username, created_at, decided_at")
            .eq("appeal_number", number)
            .single();

        if (error || !data) {
            return res.status(404).json({
                success: false,
                message: "Апелляция не найдена."
            });
        }

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
// BUTTON INTERACTIONS
// ============================
discordClient.on("interactionCreate", async (interaction) => {
    try {
        if (!interaction.isButton()) return;

        // Проверка прав
        if (!interaction.member || !interaction.member.roles.cache.has(STAFF_ROLE_ID)) {
            return interaction.reply({
                content: "❌ У вас нет прав для рассмотрения апелляций.",
                ephemeral: true
            });
        }

        const [action, id] = interaction.customId.split("_");

        if (action === "approve") {
            await decideAppeal(interaction, Number(id), "approved", "Одобрено администрацией.");
        } else if (action === "reject") {
            const modal = new ModalBuilder()
                .setCustomId(`reject_modal_${id}`)
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

// ============================
// MODAL SUBMIT
// ============================
discordClient.on("interactionCreate", async (interaction) => {
    try {
        if (!interaction.isModalSubmit()) return;
        if (!interaction.customId.startsWith("reject_modal_")) return;

        if (!interaction.member || !interaction.member.roles.cache.has(STAFF_ROLE_ID)) {
            return interaction.reply({
                content: "❌ У вас нет прав.",
                ephemeral: true
            });
        }

        const id = Number(interaction.customId.replace("reject_modal_", ""));
        const reason = interaction.fields.getTextInputValue("reject_reason");

        await decideAppeal(interaction, id, "rejected", reason);
    } catch (error) {
        console.error(error);
    }
});

// ============================
// DECIDE APPEAL
// ============================
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

    // Обновляем сообщение в Discord
    try {
        const channel = await discordClient.channels.fetch(data.discord_channel_id);
        const message = await channel.messages.fetch(data.discord_message_id);

        const newEmbed = EmbedBuilder.from(message.embeds[0])
            .setColor(status === "approved" ? 0x57F287 : 0xED4245);

        const fields = newEmbed.data.fields || [];
        const statusField = fields.find(field => field.name === "Статус");
        if (statusField) {
            statusField.value = status === "approved" ? "🟢 Одобрена" : "🔴 Отклонена";
        }

        newEmbed.addFields(
            { name: "Решение", value: decisionReason },
            { name: "Модератор", value: `<@${moderator.id}>` }
        );

        await message.edit({
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
