require('dotenv').config(); // MUST BE LINE 1
const { Telegraf } = require('telegraf');
const { google } = require('googleapis');

// --- DEBUGGING: Check if env variables are loading ---
console.log("Checking Environment Variables...");
console.log("BOT_TOKEN:", process.env.BOT_TOKEN ? "✅ Loaded" : "❌ MISSING");
console.log("SHEET_ID:", process.env.SHEET_ID ? "✅ Loaded" : "❌ MISSING");

if (!process.env.BOT_TOKEN || !process.env.SHEET_ID) {
    console.error("FATAL ERROR: Check your .env file. Bot cannot start without credentials.");
    process.exit(1);
}

// 1. Configuration
const bot = new Telegraf(process.env.BOT_TOKEN);
const SPREADSHEET_ID = process.env.SHEET_ID;
const DEPARTMENTS = ['Tech', 'HR', 'Marketing', 'Sales', 'Finance']; 

// 2. Setup Google Auth (Using Environment Variable for Security)
const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_CREDS), 
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

/**
 * FEATURE: LOG ATTENDANCE (HIT/MISS)
 * Triggered manually via /report
 */
async function generateDailyReport() {
    const sheets = google.sheets({ version: 'v4', auth });
    const today = new Date().toLocaleDateString(); 

    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!A:D', 
        });

        const rows = res.data.values || [];
        
        const submittedToday = rows
            .filter(row => row[2] && row[2].includes(today)) 
            .map(row => row[3]); 

        const attendanceData = DEPARTMENTS.map(dept => {
            const status = submittedToday.includes(dept) ? 'Hit' : 'Miss';
            return [dept, today, status];
        });

        // Check for Attendance headers
        const attendRes = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Attendance!A1:C1',
        }).catch(() => ({ data: { values: null } }));

        if (!attendRes.data.values) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: 'Attendance!A1',
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [['Department', 'Date', 'Status']] },
            });
        }

        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Attendance!A:C',
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: attendanceData },
        });

        console.log(`✅ Daily Report Generated for ${today}`);
    } catch (error) {
        console.error("Error generating report:", error.message);
    }
}

/**
 * FEATURE: LOG PHOTO TO SHEET
 */
async function appendToSheet(imageUrl, sender, caption) {
    const sheets = google.sheets({ version: 'v4', auth });
    
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!A1:E1',
        });

        if (!res.data.values || res.data.values.length === 0) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: 'Sheet1!A1',
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                    values: [['Name', 'Message', 'Timestamp', 'Department', 'Image Link']],
                },
            });
        }
    } catch (err) {
        console.log("Header check failed, proceeding...");
    }

    let dept = "General";
    let msg = caption || "No caption provided";

    if (caption && caption.includes(" Department ")) {
        const parts = caption.split(" Department ");
        dept = parts[0].trim(); 
        msg = parts[1].trim();  
    }

    const timestamp = new Date().toLocaleString();
    
    await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Sheet1!A:E',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values: [[sender, msg, timestamp, dept, imageUrl]],
        },
    });
}

// 3. Bot Listeners
bot.on('photo', async (ctx) => {
    try {
        const photo = ctx.message.photo.pop();
        const caption = ctx.message.caption; 
        const fileId = photo.file_id;
        const fileLink = await ctx.telegram.getFileLink(fileId);
        const senderName = ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : '');
        
        await appendToSheet(fileLink.href, senderName, caption);
        ctx.reply('✅ Logged to Google Sheets!');
    } catch (error) {
        console.error("Error Detail:", error.message);
        ctx.reply('❌ Error processing photo.');
    }
});

// Manual command to trigger report for testing: /report
bot.command('report', async (ctx) => {
    ctx.reply('📊 Generating attendance report...');
    await generateDailyReport();
    ctx.reply('✅ Report finished! Check the Attendance tab.');
});

// 4. Launch
bot.launch().then(() => {
    console.log("🚀 Bot is running...");
}).catch((err) => {
    console.error("Failed to launch bot:", err.message);
});

// 5. Deployment Health Check (Crucial for Render)
const http = require('http');

// Render automatically provides the PORT variable
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is active and running!\n');
}).listen(PORT, () => {
    console.log(`✅ Health check server is listening on port ${PORT}`);
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));