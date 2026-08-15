require('dotenv').config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

// ============================
// НАСТРОЙКИ
// ============================
const PORT = process.env.PORT || 10000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// ============================
// ПРОВЕРКА ПЕРЕМЕННЫХ
// ============================
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("❌ Ошибка: SUPABASE_URL или SUPABASE_SERVICE_KEY не заданы!");
    process.exit(1);
}

// ============================
// ПОДКЛЮЧЕНИЕ К БАЗЕ ДАННЫХ
// ============================
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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
// ЗАПУСК
// ============================
app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ API запущен на порту ${PORT}`);
    console.log(`📊 Supabase URL: ${SUPABASE_URL}`);
});
