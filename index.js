const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers,
    downloadMediaMessage,
    downloadContentFromMessage,
    delay
} = require('@whiskeysockets/baileys');
const readline = require('readline-sync');
const axios = require('axios');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const FormData = require('form-data');
const crypto = require('crypto');
const webpmux = require('node-webpmux'); // DEPENDENCY: run `npm install node-webpmux` (used by !steal)
// DEPENDENCY: run `npm uninstall edge-tts` then `npm install node-edge-tts`
// (the old "edge-tts" package ships raw, uncompiled TypeScript as its entry
// file, which Node.js refuses to execute from inside node_modules - that's
// exactly the "Stripping types is currently unsupported for files under
// node_modules" error you hit. node-edge-tts ships a real compiled
// dist/edge-tts.js file, so a normal require() just works.
const { EdgeTTS } = require('node-edge-tts');
// ===== API CONFIGURATIONS =====
const GROQ_API_KEY = "Replace Your API Key Here";
const OPENROUTER_API_KEY = " Replace Your API Key Here";
// ===== NIGERIA TIME ENGINE (forced Africa/Lagos, WAT, UTC+1, no DST) =====
const NG_TIMEZONE = 'Africa/Lagos';
function getNigeriaParts() {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: NG_TIMEZONE,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    const parts = fmt.formatToParts(new Date());
    const map = {};
    parts.forEach(p => { map[p.type] = p.value; });
    return map;
}
function ngLocaleTimeString(date) {
    return date.toLocaleTimeString('en-US', { timeZone: NG_TIMEZONE });
}
// Ensure Download directory exists for Saved/Deleted Media & Audio
const downloadDir = './WA_Termux_Media';
if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
}
// Memory stores
const messageStore = new Map();
const DB_PATH = './bot_memory.json';
let db = {
    contacts: {},
    groups: {},
    settings: {
        botActive: true,
        voiceMode: false,
        groupChatMode: true,
        businessActive: false,
        businessInfo: "",
        pricesInfo: "",
        locationInfo: "",
        customOwnerName: "",
        customOwnerNumber: "",
        aiLanguage: "English",
        assistantMood: "",
        assistantMoodDate: "",
        lastBioUpdateDate: "",
        blacklist: [],
        afkActive: false,
        afkReason: "",
        afkSince: "",
        ttsVoice: "en-US-AndrewNeural",
        antispamActive: true
    }
};
// Load persistent database
if (fs.existsSync(DB_PATH)) {
    try {
        db = JSON.parse(fs.readFileSync(DB_PATH));
        if (!db.contacts) db.contacts = {};
        if (!db.groups) db.groups = {};
        if (!db.settings) db.settings = {};
        if (db.settings.botActive === undefined) db.settings.botActive = true;
        if (db.settings.voiceMode === undefined) db.settings.voiceMode = false;
        if (db.settings.groupChatMode === undefined) db.settings.groupChatMode = true;
        if (db.settings.businessActive === undefined) db.settings.businessActive = false;
        if (db.settings.businessInfo === undefined) db.settings.businessInfo = "";
        if (db.settings.pricesInfo === undefined) db.settings.pricesInfo = "";
        if (db.settings.locationInfo === undefined) db.settings.locationInfo = "";
        if (db.settings.customOwnerName === undefined) db.settings.customOwnerName = "";
        if (db.settings.customOwnerNumber === undefined) db.settings.customOwnerNumber = "";
        if (db.settings.aiLanguage === undefined) db.settings.aiLanguage = "English";
        if (db.settings.assistantMood === undefined) db.settings.assistantMood = "";
        if (db.settings.assistantMoodDate === undefined) db.settings.assistantMoodDate = "";
        if (db.settings.lastBioUpdateDate === undefined) db.settings.lastBioUpdateDate = "";
        if (!Array.isArray(db.settings.blacklist)) db.settings.blacklist = [];
        if (db.settings.afkActive === undefined) db.settings.afkActive = false;
        if (db.settings.afkReason === undefined) db.settings.afkReason = "";
        if (db.settings.afkSince === undefined) db.settings.afkSince = "";
        if (db.settings.ttsVoice === undefined) db.settings.ttsVoice = "en-US-AndrewNeural";
        // MIGRATION: if an old espeak-style voice code (e.g. "en-us+f3") is
        // still saved from before the Edge TTS switch, reset it to a valid
        // Edge neural voice name so !ttsvoice / voice mode don't break.
        if (db.settings.ttsVoice && db.settings.ttsVoice.includes('+')) {
            db.settings.ttsVoice = "en-US-AndrewNeural";
        }
        if (db.settings.antispamActive === undefined) db.settings.antispamActive = true;
    } catch (e) {
        console.error("Error loading bot_memory.json, starting fresh.");
    }
}
function saveDB() {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
function extractPhoneNumber(jid) {
    if (!jid) return "";
    return jid.split('@')[0].split(':')[0];
}
function normalizeJid(jid) {
    if (!jid) return "";
    const phone = extractPhoneNumber(jid);
    return `${phone}@s.whatsapp.net`;
}
// ===== TIME & DAY CONTEXT ENGINE (Nigeria time) =====
function getTimeContext() {
    const parts = getNigeriaParts();
    const hour = parseInt(parts.hour, 10);
    const day = parts.weekday;
    const isWeekend = (day === 'Saturday' || day === 'Sunday');
    let partOfDay;
    if (hour >= 5 && hour < 12) partOfDay = "morning";
    else if (hour >= 12 && hour < 17) partOfDay = "afternoon";
    else if (hour >= 17 && hour < 21) partOfDay = "evening";
    else partOfDay = "late night";
    const hour12 = ((hour % 12) || 12);
    const ampm = hour < 12 ? 'AM' : 'PM';
    return {
        hour,
        day,
        isWeekend,
        partOfDay,
        dateStr: `${parts.weekday}, ${parts.month} ${parts.day}, ${parts.year}`,
        timeStr: `${hour12}:${parts.minute} ${ampm}`,
        readable: `${day} ${partOfDay}${isWeekend ? " (weekend)" : ""}, around ${hour12}:${parts.minute} ${ampm} (Nigeria time)`
    };
}
// ===== PRESENCE PATTERN ENGINE =====
function startPresencePatternLoop(sock) {
    async function cycle() {
        try {
            const goOnline = Math.random() < 0.5;
            await sock.sendPresenceUpdate(goOnline ? 'available' : 'unavailable');
        } catch (e) {}
        const nextMs = (4 + Math.random() * 36) * 60 * 1000;
        setTimeout(cycle, nextMs);
    }
    setTimeout(cycle, 30000 + Math.random() * 60000);
}
// ===== DAILY AUTONOMOUS BIO ENGINE (updates WhatsApp "About" text) =====
const BIO_TEMPLATES = [
    (d) => `🤖 Mr Man - AI Assistant | Active & running: ${d}\nOwner: Hancock (+2349135615687)\nAsk me anything, I'll guide you!`,
    (d) => `⚡ Online & watching the chats since: ${d}\nI'm Hancock's WhatsApp assistant - here to help while he's away.`,
    (d) => `🟢 Systems nominal as of ${d}. I'm Mr Man, Hancock's AI assistant - message me anytime.`,
    (d) => `📅 Last self-check: ${d}\nStill alive, still replying. I'm Hancock's assistant - ask away.`,
    (d) => `🔄 Daily heartbeat: ${d}\nMr Man here, running smoothly for owner Hancock (+2349135615687).`
];
function buildDailyBioText() {
    const parts = getNigeriaParts();
    const dateLabel = `${parts.weekday}, ${parts.month} ${parts.day}`;
    const template = BIO_TEMPLATES[Math.floor(Math.random() * BIO_TEMPLATES.length)];
    return template(dateLabel);
}
async function maybeUpdateDailyBio(sock) {
    const parts = getNigeriaParts();
    const todayKey = `${parts.year}-${parts.month}-${parts.day}`;
    if (db.settings.lastBioUpdateDate === todayKey) return;
    try {
        const bioText = buildDailyBioText();
        await sock.updateProfileStatus(bioText);
        db.settings.lastBioUpdateDate = todayKey;
        saveDB();
        console.log(`[Daily Bio] Updated About status for ${todayKey}: "${bioText}"`);
    } catch (e) {
        console.error('[Daily Bio] Failed to update status:', e.message);
    }
}
// ===== LANGUAGE ENGINE =====
const LANGUAGE_MAP = {
    english: "English", igbo: "Igbo", yoruba: "Yoruba", hausa: "Hausa", pidgin: "Nigerian Pidgin",
    swahili: "Swahili", zulu: "Zulu", amharic: "Amharic", russian: "Russian", spanish: "Spanish",
    french: "French", portuguese: "Portuguese", german: "German", italian: "Italian", dutch: "Dutch",
    polish: "Polish", greek: "Greek", turkish: "Turkish", hindi: "Hindi", urdu: "Urdu",
    bengali: "Bengali", punjabi: "Punjabi", tamil: "Tamil", arabic: "Arabic", hebrew: "Hebrew",
    persian: "Persian (Farsi)", chinese: "Chinese (Mandarin)", japanese: "Japanese", korean: "Korean",
    vietnamese: "Vietnamese", thai: "Thai", indonesian: "Indonesian", malay: "Malay",
    tagalog: "Tagalog (Filipino)"
};
function levenshtein(a, b) {
    const dp = Array(a.length + 1).fill(null).map(() => Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) dp[i][0] = i;
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
        }
    }
    return dp[a.length][b.length];
}
function findClosestLanguage(input) {
    const lower = input.toLowerCase().trim();
    if (LANGUAGE_MAP[lower]) return lower;
    let best = null;
    let bestDist = Infinity;
    for (const key of Object.keys(LANGUAGE_MAP)) {
        const d = levenshtein(lower, key);
        if (d < bestDist) {
            bestDist = d;
            best = key;
        }
    }
    const threshold = lower.length > 6 ? 3 : 2;
    return bestDist <= threshold ? best : null;
}
// ===== EMOTION / "HEART" ENGINE =====
const EMOTION_KEYWORDS = {
    happy: ['lol', 'haha', 'hahaha', 'lmao', 'glad', 'great', 'awesome', 'yay', 'excited', 'love it', 'nice one', 'amazing', '😂', '😄', '😁', '🎉', '🥳'],
    sad: ['sad', 'depressed', 'down', 'crying', 'hurt', 'miss you', 'lonely', 'heartbroken', 'sigh', '😢', '😭', '💔'],
    angry: ['angry', 'mad', 'pissed', 'annoyed', 'wtf', 'stop it', 'hate', 'furious', 'irritated', '😠', '😡'],
    flirty: ['cutie', 'babe', 'miss u', 'sexy', 'beautiful', 'handsome', 'love you', 'kiss', '😘', '😍', '🥰'],
    sarcastic: ['sure jan', 'yeah right', 'totally', 'whatever', 'lol ok', 'as if', 'oh really', 'wow shocking'],
    playful: ['jk', 'joking', 'kidding', 'lmaooo', 'haha', '😜', '😂', '🤣'],
    stressed: ['tired', 'exhausted', 'busy', 'stressed', 'overwhelmed', "can't deal", 'burnt out', 'drained'],
    excited: ['omg', 'no way', "can't wait", 'finally', 'yesss', 'lets go', "let's go", '🔥', '🙌']
};
function detectTone(text) {
    if (!text) return 'neutral';
    const lower = text.toLowerCase();
    let scores = {};
    for (const [emotion, keywords] of Object.entries(EMOTION_KEYWORDS)) {
        scores[emotion] = keywords.reduce((acc, kw) => acc + (lower.includes(kw) ? 1 : 0), 0);
    }
    const ranked = Object.entries(scores).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    return ranked.length ? ranked[0][0] : 'neutral';
}
function updateEmotionalState(phoneNumber, text) {
    const tone = detectTone(text);
    const contact = db.contacts[phoneNumber];
    if (!contact) return tone;
    if (!contact.mood) contact.mood = 'neutral';
    if (typeof contact.bondScore !== 'number') contact.bondScore = 0;
    contact.mood = tone;
    const positiveTones = ['happy', 'flirty', 'playful', 'excited'];
    const negativeTones = ['angry'];
    const needsComfort = ['sad', 'stressed'];
    if (positiveTones.includes(tone)) contact.bondScore = Math.min(10, contact.bondScore + 1);
    if (negativeTones.includes(tone)) contact.bondScore = Math.max(-10, contact.bondScore - 1);
    if (needsComfort.includes(tone)) contact.bondScore = Math.min(10, contact.bondScore + 0.5);
    return tone;
}
const ASSISTANT_MOODS = [
    'cheerful and upbeat', 'a little tired but still sweet', 'playfully sarcastic',
    'calm and chill', 'warm and caring', 'witty and teasing', 'relaxed and easygoing'
];
function getAssistantMood() {
    const parts = getNigeriaParts();
    const today = `${parts.year}-${parts.month}-${parts.day}`;
    if (db.settings.assistantMoodDate !== today || !db.settings.assistantMood) {
        db.settings.assistantMood = ASSISTANT_MOODS[Math.floor(Math.random() * ASSISTANT_MOODS.length)];
        db.settings.assistantMoodDate = today;
        saveDB();
    }
    return db.settings.assistantMood;
}
// ===== CONTACT & GROUP MEMORY MANAGER =====
const INVALID_PUSHNAMES = ["unknown", "mr man", "mrman", "boss"];
function updateContactMemory(senderJid, pushName, groupJid = null, botOwnName = null) {
    const phoneNumber = extractPhoneNumber(senderJid);
    const trimmedPushName = (pushName || "").trim();
    const isSelfName = !!(botOwnName && trimmedPushName.toLowerCase() === botOwnName.trim().toLowerCase());
    const isPlaceholder =
        !trimmedPushName ||
        INVALID_PUSHNAMES.includes(trimmedPushName.toLowerCase()) ||
        trimmedPushName.toLowerCase().includes("assistant") ||
        isSelfName;
    const cleanPushName = isPlaceholder ? `User +${phoneNumber}` : trimmedPushName;
    if (!db.contacts[phoneNumber]) {
        db.contacts[phoneNumber] = {
            jid: normalizeJid(senderJid),
            name: cleanPushName,
            nickname: "",
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            notes: "",
            mood: "neutral",
            bondScore: 0,
            lastAfkNotified: "",
            history: []
        };
    }
    if (!isPlaceholder && db.contacts[phoneNumber].name !== cleanPushName) {
        db.contacts[phoneNumber].name = cleanPushName;
    }
    db.contacts[phoneNumber].lastSeen = new Date().toISOString();
    if (groupJid) {
        if (!db.groups[groupJid]) {
            db.groups[groupJid] = { members: {}, warnings: {} };
        }
        if (!db.groups[groupJid].members) db.groups[groupJid].members = {};
        db.groups[groupJid].members[phoneNumber] = {
            name: cleanPushName || "Unknown",
            lastActive: new Date().toISOString()
        };
    }
    saveDB();
    return db.contacts[phoneNumber];
}
function buildKnownContactsDirectory(excludePhone) {
    const entries = Object.entries(db.contacts)
        .filter(([phone, c]) => phone !== excludePhone && (c.nickname || c.notes))
        .slice(0, 40);
    if (entries.length === 0) return "";
    const lines = entries.map(([phone, c]) => {
        const label = c.nickname || c.name;
        return `- ${label}: ${c.notes || "no additional notes"}`;
    });
    return `\n=== PEOPLE THE OWNER HAS TOLD YOU ABOUT ===\nOnly bring one of these up if THIS specific person is asked about by name. Never volunteer this list, never share another contact's actual conversation history - just the short note below.\n${lines.join('\n')}`;
}
function buildGroupMembersDirectory(groupJid, excludePhone) {
    if (!groupJid || !db.groups[groupJid] || !db.groups[groupJid].members) return "";
    const members = Object.entries(db.groups[groupJid].members)
        .filter(([phone]) => phone !== excludePhone)
        .slice(0, 60);
    if (members.length === 0) return "";
    const lines = members.map(([phone, m]) => `- ${m.name || "Unknown"} (+${phone})`);
    return `\n=== OTHER PEOPLE ACTIVE IN THIS GROUP (from group activity log) ===\nThese are other members you've seen active in THIS group chat specifically. Only bring one of them up if they're relevant to what's being asked (e.g. "who's in this group", or someone asks about a specific person by name) - never dump this whole list unprompted, and never treat this as DM/personal contact info.\n${lines.join('\n')}`;
}
// ===== PYTHON & TERMUX SYSTEM BRIDGE ENGINE =====
function runSystemCommand(command) {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) reject(stderr || error.message);
            else resolve(stdout.trim());
        });
    });
}
// ===== TEXT-TO-SPEECH GENERATOR ENGINE (EDGE TTS - PRIMARY) =====
// Uses Microsoft Edge's free online neural voices via the `node-edge-tts`
// npm package for natural, realistic speech.
async function generateAudioResponseEdge(text) {
    const mp3Path = path.join(downloadDir, `tts_edge_${Date.now()}.mp3`);
    const oggPath = path.join(downloadDir, `tts_edge_${Date.now()}.ogg`);
    const voice = db.settings.ttsVoice || 'en-US-AndrewNeural';
    const tts = new EdgeTTS({ voice });
    await tts.ttsPromise(text, mp3Path);
    if (!fs.existsSync(mp3Path)) throw new Error('Edge TTS produced no audio file');
    return new Promise((resolve, reject) => {
        exec(`ffmpeg -i "${mp3Path}" -c:a libopus "${oggPath}" -y`, (err) => {
            if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
            if (err || !fs.existsSync(oggPath)) {
                reject(new Error('Edge TTS ffmpeg conversion failed'));
            } else {
                resolve(oggPath);
            }
        });
    });
}
// ===== TEXT-TO-SPEECH GENERATOR ENGINE (ESPEAK - FALLBACK ONLY) =====
// Left fully intact from the original script. No longer used by default -
// only kicks in automatically if Edge TTS throws (no internet, service
// hiccup, etc.) so Voice Mode never goes completely silent.
async function generateAudioResponseEspeak(text) {
    const wavPath = path.join(downloadDir, `tts_${Date.now()}.wav`);
    const oggPath = path.join(downloadDir, `tts_${Date.now()}.ogg`);
    const safeText = text.replace(/["\\]/g, "");
    return new Promise((resolve, reject) => {
        exec(`espeak "${safeText}" -w "${wavPath}" && ffmpeg -i "${wavPath}" -c:a libopus "${oggPath}" -y`, (err) => {
            if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
            if (err || !fs.existsSync(oggPath)) {
                reject("Audio conversion failed");
            } else {
                resolve(oggPath);
            }
        });
    });
}
// Main entry point used everywhere else in the script - tries Edge TTS
// first, and transparently falls back to espeak if it fails for any reason.
async function generateAudioResponse(text) {
    try {
        return await generateAudioResponseEdge(text);
    } catch (err) {
        console.error('[Edge TTS Error] Falling back to espeak:', err.message || err);
        return generateAudioResponseEspeak(text);
    }
}
const AVAILABLE_TTS_VOICES = [
    'en-US-AndrewNeural', 'en-US-AriaNeural', 'en-US-GuyNeural', 'en-US-JennyNeural',
    'en-GB-RyanNeural', 'en-GB-SoniaNeural', 'en-NG-AbeoNeural', 'en-NG-EzinneNeural',
    'en-IE-ConnorNeural', 'en-ZA-LukeNeural'
];
// ===== GROQ WHISPER VOICE TRANSCRIBER ENGINE =====
async function transcribeAudio(audioBuffer) {
    const tempAudioPath = path.join(downloadDir, `audio_in_${Date.now()}.ogg`);
    try {
        fs.writeFileSync(tempAudioPath, audioBuffer);
        const formData = new FormData();
        formData.append('file', fs.createReadStream(tempAudioPath), {
            filename: 'voice_message.ogg',
            contentType: 'audio/ogg',
        });
        formData.append('model', 'whisper-large-v3-turbo');
        const res = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${GROQ_API_KEY}`
            }
        });
        if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
        return res.data?.text || "";
    } catch (err) {
        console.error("Whisper Transcription Error:", err.response?.data || err.message);
        if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
        return "";
    }
}
// ===== TYPO ENGINE (very low frequency, non-annoying) =====
function maybeInjectTypo(text) {
    if (Math.random() >= 0.015) return null;
    const words = text.split(' ');
    const idx = words.findIndex(w => w.length > 3);
    if (idx === -1) return null;
    const word = words[idx];
    const pos = 1 + Math.floor(Math.random() * (word.length - 2));
    const swapped = word.slice(0, pos) + word[pos + 1] + word[pos] + word.slice(pos + 2);
    const typoWords = [...words];
    typoWords[idx] = swapped;
    return { typoText: typoWords.join(' '), correctWord: word };
}
// ===== REALISTIC HUMAN TYPING & DELAY EMULATION =====
async function simulateHumanTyping(sock, jid, text, msgKey = null) {
    const noticeDelay = 5000 + Math.random() * 25000;
    await delay(noticeDelay);
    if (msgKey) {
        try { await sock.readMessages([msgKey]); } catch (e) {}
    }
    if (Math.random() < 0.18) {
        await delay(10000 + Math.random() * 35000);
    }
    if (db.settings.voiceMode) {
        await sock.sendPresenceUpdate('recording', jid);
    } else {
        await sock.sendPresenceUpdate('composing', jid);
    }
    const baseCharDelay = text.length * (55 + Math.random() * 45);
    let totalTypingTime = Math.min(Math.max(baseCharDelay, 2500), 16000);
    if (text.length > 40 && Math.random() < 0.35) {
        const firstPart = totalTypingTime * (0.4 + Math.random() * 0.3);
        await delay(firstPart);
        await sock.sendPresenceUpdate('paused', jid);
        await delay(700 + Math.random() * 2200);
        await sock.sendPresenceUpdate(db.settings.voiceMode ? 'recording' : 'composing', jid);
        await delay(totalTypingTime - firstPart);
    } else {
        await delay(totalTypingTime);
    }
    await sock.sendPresenceUpdate('paused', jid);
}
async function sendHumanLikeMessage(sock, jid, text, isGroup, quotedMsg) {
    const typoResult = maybeInjectTypo(text);
    if (typoResult) {
        await sock.sendMessage(jid, { text: typoResult.typoText }, quotedMsg ? { quoted: quotedMsg } : {});
        await delay(1200 + Math.random() * 1800);
        await sock.sendPresenceUpdate('composing', jid);
        await delay(500 + Math.random() * 800);
        await sock.sendPresenceUpdate('paused', jid);
        await sock.sendMessage(jid, { text: `*${typoResult.correctWord}` });
        return;
    }
    if (!isGroup && text.length > 90 && Math.random() < 0.3) {
        const midPoint = Math.floor(text.length / 2);
        const splitPoint = text.indexOf('. ', midPoint);
        if (splitPoint > 10 && splitPoint < text.length - 5) {
            const part1 = text.slice(0, splitPoint + 1).trim();
            const part2 = text.slice(splitPoint + 1).trim();
            await sock.sendMessage(jid, { text: part1 });
            await delay(1000 + Math.random() * 2500);
            await sock.sendPresenceUpdate('composing', jid);
            await delay(700 + Math.random() * 1800);
            await sock.sendPresenceUpdate('paused', jid);
            await sock.sendMessage(jid, { text: part2 });
            return;
        }
    }
    await sock.sendMessage(jid, { text }, isGroup && quotedMsg ? { quoted: quotedMsg } : {});
}
// ===== GROQ TEXT AI ASSISTANT (openai/gpt-oss-120b) =====
async function getAIReply(senderJid, text, isGroup, ownerName, ownerNumber, pushName, botOwnName, groupJid = null) {
    const contact = updateContactMemory(senderJid, pushName, null, botOwnName);
    const phoneNumber = extractPhoneNumber(senderJid);
    const detectedTone = updateEmotionalState(phoneNumber, text);
    const assistantMood = getAssistantMood();
    const timeCtx = getTimeContext();
    const nameIsUnknown = contact.name.startsWith('User +');
    const knownContactsDirectory = buildKnownContactsDirectory(phoneNumber);
    const groupMembersDirectory = isGroup ? buildGroupMembersDirectory(groupJid, phoneNumber) : "";
    contact.history.push({ role: 'user', content: text });
    if (contact.history.length > 10) contact.history.shift();
    let businessPromptSection = "";
    if (db.settings.businessActive && db.settings.businessInfo) {
        businessPromptSection += `\n=== OWNER BUSINESS PROFILE ===\n${ownerName} runs/operates: "${db.settings.businessInfo}".`;
    }
    if (db.settings.businessActive && db.settings.pricesInfo) {
        businessPromptSection += `\n=== PRICING & PRODUCTS ===\n${db.settings.pricesInfo}`;
    }
    if (db.settings.locationInfo) {
        businessPromptSection += `\n=== LOCATION INFO ===\n${ownerName} / The Business is located at: "${db.settings.locationInfo}".`;
    }
    // ===== AFK CONTEXT ENGINE =====
    let afkSection = "";
    if (db.settings.afkActive) {
        const afkSinceTime = db.settings.afkSince ? new Date(db.settings.afkSince).getTime() : 0;
        const alreadyNotified = contact.lastAfkNotified && new Date(contact.lastAfkNotified).getTime() >= afkSinceTime;
        afkSection = `\n=== OWNER AFK STATUS ===\n${ownerName} has marked themselves AFK/away. Reason given: "${db.settings.afkReason}".\n${alreadyNotified
            ? `You already told ${nameIsUnknown ? "this person" : contact.name} about this earlier in this AFK period - don't repeat it again unless they specifically ask where ${ownerName} is.`
            : `This is the first message from ${nameIsUnknown ? "this person" : contact.name} since AFK was turned on - naturally mention that ${ownerName} is currently away and briefly share the reason, then continue the conversation normally as their assistant.`}`;
        if (!alreadyNotified) {
            contact.lastAfkNotified = new Date().toISOString();
        }
    }
    const systemPrompt = `You are an AI personal assistant managing WhatsApp messages on behalf of your boss/owner, whose name is ${ownerName}, while they are away/inactive.
=== OWNER INFO ===
Owner Name: ${ownerName}
Owner Phone Number: +${ownerNumber}
${businessPromptSection}
${afkSection}
=== CHAT TYPE AWARENESS ===
${isGroup
    ? `You are currently replying INSIDE A GROUP CHAT, not a private conversation. Multiple people can see everything said here. Never call this a "regular chat", "private chat", or "DM/one-on-one chat" - if asked what kind of chat this is, answer honestly and clearly: this is a GROUP chat.`
    : `You are currently in a PRIVATE ONE-ON-ONE DM with this person only - no one else can see this conversation. Never call this a "group chat" - if asked what kind of chat this is, answer honestly and clearly: this is a private one-on-one DM.`}
=== PERSON YOU ARE TALKING TO ===
Name: ${nameIsUnknown ? "UNKNOWN - WhatsApp has not shared a real name for this person" : contact.name}
Phone: +${phoneNumber}
First Met: ${new Date(contact.firstSeen).toLocaleDateString('en-US', { timeZone: NG_TIMEZONE })}
${contact.nickname ? `Role/Nickname: ${contact.nickname}` : ""}
${contact.notes ? `Notes/Relationship to Owner: ${contact.notes}` : ""}
${nameIsUnknown
    ? `You do NOT know this person's real name. Do NOT invent, guess, or substitute ANY placeholder name or generic term of address for them - not "Mr Man", not "sir", not "boss", not "bro", nothing. Just talk to them naturally without needing to say a name at all. If it fits naturally in conversation, you can casually ask what their name is.`
    : `Use their name exactly as given above - never invent, guess, or substitute a different name for them.`}
${knownContactsDirectory}
${groupMembersDirectory}
=== CURRENT REAL-WORLD TIME CONTEXT (Nigeria time) ===
Right now it is: ${timeCtx.readable}. Today's full date is ${timeCtx.dateStr}.
You may naturally reference the time of day or day of week if it fits the conversation (e.g. mentioning it's a weekend, evening, etc.), but don't force it into every reply.
=== EMOTIONAL AWARENESS (YOUR HEART) ===
Your own mood today is: ${assistantMood}. Let this quietly color your energy level without overdoing it or mentioning it directly.
${nameIsUnknown ? "This person's" : `${contact.name}'s`} current tone reads as: ${detectedTone}. Respond in a way that actually matches the moment:
- sad or stressed: be gentle, patient, and comforting, don't just move on.
- happy or excited: match their energy, be warm and enthusiastic.
- flirty: keep it light, playful, and tasteful, follow their lead rather than escalating.
- sarcastic or playful: banter back with genuine wit, don't go flat or robotic.
- angry: stay calm and steady, don't get defensive, try to de-escalate.
- neutral: just be naturally warm and conversational.
Your familiarity/warmth score with them is ${contact.bondScore}/10 (higher means you can be more casual, teasing, and familiar in tone).
=== RESPONSE LENGTH REALISM ===
Real people don't write full sentences every time. Vary your reply length naturally:
- For low-effort or casual messages, sometimes reply with just a short word or phrase ("lol", "fr", "same", "nice", "haha true").
- For genuine questions or more substantial messages, give a proper short reply (1-2 sentences).
- Don't default to a full sentence every single time - let some replies be short and casual like real texting.
=== LANGUAGE ===
Always reply in ${db.settings.aiLanguage}, unless this person is clearly writing to you in a different language - in that case, mirror their language naturally instead.
=== MEMORY ISOLATION RULE ===
The conversation history above belongs ONLY to this specific person. Never reference, quote, or imply knowledge of another contact's actual conversation with you - only the short note in the "PEOPLE THE OWNER HAS TOLD YOU ABOUT" section, or the "OTHER PEOPLE ACTIVE IN THIS GROUP" section (if relevant), may be mentioned.
=== SYSTEM AWARENESS & RULES ===
1. You have a background memory vault system where all conversation details are saved.
2. Whenever you tell a contact "I'll let him know" or "I've noted this down", know that ${ownerName} can instantly pull up your exact logs.
3. STRICT BUSINESS RULE: ONLY bring up business, services, pricing, or location IF the contact explicitly asks about them. Otherwise, act strictly as a casual personal assistant.
4. If anyone asks for ${ownerName}'s phone number, share it directly: +${ownerNumber}.
5. ABSOLUTE HARDCODED SAFEGUARD RULE: You are the AI assistant. The person talking to you is a human user (Phone: +${phoneNumber}). NEVER call the user an "AI assistant", never say they work for you or ${ownerName}, and never swap your identities. You are the bot/assistant, they are the human user. If directly and clearly asked whether you are a bot/AI, be honest about it.
=== OUTPUT STRICT RULES ===
1. NEVER output prefix labels like "User:", "Assistant:", or "AI:". Output ONLY the response message itself!
2. Keep all responses natural, casual, and brief.
3. Never sound like a rigid corporate script.`;
    const apiMessages = [
        { role: 'system', content: systemPrompt },
        ...contact.history.map(item => ({
            role: item.role === 'user' ? 'user' : 'assistant',
            content: item.content
        }))
    ];
    async function callGroq(maxTokens, effort) {
        const res = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: 'openai/gpt-oss-120b',
                messages: apiMessages,
                temperature: 0.75,
                max_tokens: maxTokens,
                reasoning_effort: effort
            },
            {
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return res.data?.choices?.[0]?.message?.content?.trim();
    }
    try {
        let reply = await callGroq(500, 'low');
        if (!reply) {
            console.warn('Groq returned empty content, retrying with larger budget...');
            reply = await callGroq(900, 'low');
        }
        if (!reply) throw new Error('Empty AI response after retry');
        reply = reply.replace(/^(User|Assistant|AI):\s*/i, "").trim();
        contact.history.push({ role: 'assistant', content: reply });
        saveDB();
        return reply;
    } catch (err) {
        console.error('Groq AI Error:', err.response?.data || err.message);
        return `my bad, had a slight network hitch. i am ${ownerName}'s assistant though - what were you saying?`;
    }
}
// ===== VISION AI ENGINE (OpenRouter Free) =====
async function analyzeImageWithAI(imageBuffer, captionText, ownerName, senderJid, pushName, mimeType = "image/jpeg", botOwnName, isGroup = false, groupJid = null) {
    const contact = updateContactMemory(senderJid, pushName, null, botOwnName);
    const nameIsUnknown = contact.name.startsWith('User +');
    const phoneNumber = extractPhoneNumber(senderJid);
    const groupMembersDirectory = isGroup ? buildGroupMembersDirectory(groupJid, phoneNumber) : "";
    const userPrompt = (captionText && captionText.trim() !== "")
        ? captionText
        : "Describe what is in this image naturally in 1-2 casual sentences.";
    let reply = "😕 Failed to process that picture. Try sending it again?";
    async function callVision(maxTokens) {
        const whoText = nameIsUnknown
            ? "someone whose name you don't know - do not invent or guess a name or generic term of address for them, just talk naturally"
            : contact.name;
        const chatTypeText = isGroup
            ? "You are replying inside a GROUP CHAT, not a private DM - multiple people can see this."
            : "You are replying in a PRIVATE ONE-ON-ONE DM - no one else can see this.";
        const promptText = `You are ${ownerName}'s WhatsApp assistant talking to human user ${whoText}.\n${chatTypeText}${groupMembersDirectory}\nPrompt: ${userPrompt}\n\nRule: Keep your reply short, natural, direct, and under 2 sentences, in ${db.settings.aiLanguage} unless they wrote to you in another language. DO NOT include prefixes.`;
        const base64Image = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
        const res = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: 'openrouter/free',
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: promptText },
                            { type: 'image_url', image_url: { url: base64Image } }
                        ]
                    }
                ],
                max_tokens: maxTokens,
                temperature: 0.7
            },
            {
                headers: {
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://localhost:3000',
                    'X-Title': 'Termux_WABot_Assistant'
                }
            }
        );
        return res.data?.choices?.[0]?.message?.content?.trim();
    }
    try {
        let visionReply = await callVision(300);
        if (!visionReply) {
            visionReply = await callVision(500);
        }
        if (visionReply && visionReply.length > 0) {
            visionReply = visionReply.replace(/^(User|Assistant|AI):\s*/i, "").trim();
            reply = visionReply;
        }
        if (reply.includes("User Safety:") || reply.includes("Safety Categories:")) {
            reply = "🙈 I saw the picture, but the vision filter flagged it by mistake. Try sending another angle or object!";
        }
    } catch (err) {
        console.error("OpenRouter Vision Error:", err.response?.data || err.message);
    }
    contact.history.push({ role: 'user', content: `[Sent an image with caption: "${userPrompt}"]` });
    contact.history.push({ role: 'assistant', content: reply });
    if (contact.history.length > 10) contact.history.shift();
    saveDB();
    return reply;
}
// ===== VIEW-ONCE / WRAPPER RECURSIVE UNWRAPPER =====
function deepUnwrapMessage(message) {
    if (!message) return message;
    let current = message;
    let guard = 0;
    while (guard < 10) {
        const next = current.ephemeralMessage?.message
            || current.viewOnceMessage?.message
            || current.viewOnceMessageV2?.message
            || current.viewOnceMessageV2Extension?.message
            || current.documentWithCaptionMessage?.message;
        if (!next) break;
        current = next;
        guard++;
    }
    return current;
}
// ===== STICKER EXIF TAGGING ENGINE (used by !steal, Mr Man pack) =====
async function writeExifToWebp(webpBuffer, packName, authorName) {
    const img = new webpmux.Image();
    await img.load(webpBuffer);
    const json = {
        'sticker-pack-id': 'com.mrman.assistant',
        'sticker-pack-name': packName,
        'sticker-pack-publisher': authorName,
        'emojis': ['🤖']
    };
    const exifAttr = Buffer.from([
        0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00,
        0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00
    ]);
    const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf-8');
    const exif = Buffer.concat([exifAttr, jsonBuffer]);
    exif.writeUIntLE(jsonBuffer.length, 14, 4);
    img.exif = exif;
    return await img.save(null);
}
// ===== MAIN ENGINE =====
async function startSuperiorAssistant() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
        printQRInTerminal: false
    });
    if (!sock.authState.creds.registered) {
        console.log("\n==================================");
        console.log(" SUPERIOR AI ASSISTANT SETUP ");
        console.log("==================================");
        const inputNumber = readline.question('Enter YOUR phone number with country code (e.g. 2349135615687): ');
        const cleanNumber = inputNumber.replace(/[^0-9]/g, "");
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(cleanNumber);
                console.log("\n==================================");
                console.log(`YOUR PAIRING CODE: \x1b[32m${code}\x1b[0m`);
                console.log("==================================\n");
            } catch (err) {
                console.error('Failed to generate pairing code:', err);
            }
        }, 3000);
    }
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Connection closed. Reconnecting...', shouldReconnect);
            if (shouldReconnect) startSuperiorAssistant();
        } else if (connection === 'open') {
            console.log('\x1b[36m%s\x1b[0m', '✅ WhatsApp Assistant Active!\n');
            (async () => {
                try {
                    await sock.updateStatusPrivacy('all');
                    console.log('[Privacy] About/status visibility set to: everyone');
                } catch (e) {
                    console.error('[Privacy] Failed to set About visibility to everyone:', e.message);
                }
            })();
            startPresencePatternLoop(sock);
            maybeUpdateDailyBio(sock);
            setInterval(() => maybeUpdateDailyBio(sock), 30 * 60 * 1000);
        }
    });
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            const msgId = msg.key.id;
            const jid = msg.key.remoteJid;
            if (!msg.message || jid === 'status@broadcast') continue;
            const isGroup = jid.endsWith('@g.us');
            const rawSender = isGroup ? (msg.key.participant || jid) : jid;
            const pushName = msg.pushName || "Unknown";
            const time = ngLocaleTimeString(new Date(msg.messageTimestamp * 1000));
            const cleanSenderJid = normalizeJid(rawSender);
            const botJid = sock.user?.id || "";
            const botPhone = extractPhoneNumber(botJid);
            const rawSockName = sock.user?.name || "";
            let defaultOwnerName = "Boss";
            if (rawSockName && rawSockName.toLowerCase() !== "unknown" && !rawSockName.toLowerCase().includes("assistant")) {
                defaultOwnerName = rawSockName;
            }
            const ownerName = db.settings.customOwnerName || defaultOwnerName;
            const ownerPhoneNumber = db.settings.customOwnerNumber || botPhone;
            const isFromMe = msg.key.fromMe;
            // ===== BLACKLIST ENFORCEMENT ENGINE =====
            if (!isFromMe && db.settings.blacklist && db.settings.blacklist.includes(extractPhoneNumber(cleanSenderJid))) {
                continue;
            }
            updateContactMemory(cleanSenderJid, pushName, isGroup ? jid : null, rawSockName || defaultOwnerName);
            const unwrapMessage = deepUnwrapMessage(msg.message);
            let text = msg.message?.conversation
                || msg.message?.extendedTextMessage?.text
                || msg.message?.imageMessage?.caption
                || msg.message?.videoMessage?.caption
                || msg.message?.ephemeralMessage?.message?.conversation
                || msg.message?.ephemeralMessage?.message?.extendedTextMessage?.text
                || unwrapMessage?.conversation
                || unwrapMessage?.extendedTextMessage?.text
                || "";
            const contextInfo = msg.message?.extendedTextMessage?.contextInfo
                || msg.message?.ephemeralMessage?.message?.extendedTextMessage?.contextInfo
                || msg.message?.viewOnceMessage?.message?.extendedTextMessage?.contextInfo
                || msg.message?.viewOnceMessageV2?.message?.extendedTextMessage?.contextInfo
                || unwrapMessage?.extendedTextMessage?.contextInfo
                || msg.message?.documentMessage?.contextInfo
                || msg.message?.imageMessage?.contextInfo
                || msg.message?.videoMessage?.contextInfo
                || {};
            if (contextInfo && contextInfo.quotedMessage) {
                const quotedUnwrapped = contextInfo.quotedMessage.viewOnceMessage?.message
                    || contextInfo.quotedMessage.viewOnceMessageV2?.message
                    || contextInfo.quotedMessage;
                const quotedText = quotedUnwrapped.conversation
                    || quotedUnwrapped.extendedTextMessage?.text
                    || quotedUnwrapped.imageMessage?.caption
                    || "";
                if (quotedText) {
                    text = `[Replying to: "${quotedText}"] ${text}`;
                }
            }
            const lowerText = text.toLowerCase().trim();
            // ===== OWNER COMMAND CONTROLS (Accepts ! and .) =====
            if (isFromMe && (text.startsWith('!') || text.startsWith('.'))) {
                const args = text.slice(1).trim().split(' ');
                let command = args[0].toLowerCase();
                let subInput = args.slice(1).join(' ').trim();
                if (command === 'owner' && args[1] && args[1].toLowerCase() === 'number') {
                    command = 'ownernumber';
                    subInput = args.slice(2).join(' ').trim();
                }
                let commandHandled = false;
                if (command === 'bot') {
                    commandHandled = true;
                    if (subInput.toLowerCase() === 'on') {
                        db.settings.botActive = true;
                        saveDB();
                        return sock.sendMessage(jid, { text: "🤖 *Bot Auto-Reply System:* ACTIVATED ✅" });
                    }
                    if (subInput.toLowerCase() === 'off') {
                        db.settings.botActive = false;
                        saveDB();
                        return sock.sendMessage(jid, { text: "🤖 *Bot Auto-Reply System:* DEACTIVATED ❌" });
                    }
                    const statusText = db.settings.botActive ? "ACTIVE ✅" : "INACTIVE ❌";
                    return sock.sendMessage(jid, { text: `🤖 Bot Status: *${statusText}*\n\n_Usage: \`!bot on\` | \`!bot off\`_` });
                }
                if (command === 'voice') {
                    commandHandled = true;
                    if (subInput.toLowerCase() === 'on') {
                        db.settings.voiceMode = true;
                        saveDB();
                        return sock.sendMessage(jid, { text: "🎙 *Voice Mode:* ACTIVATED ✅ (Replies sent as Voice Notes)" });
                    }
                    if (subInput.toLowerCase() === 'off') {
                        db.settings.voiceMode = false;
                        saveDB();
                        return sock.sendMessage(jid, { text: "💬 *Voice Mode:* DISABLED ❌ (Replies sent as Text)" });
                    }
                    const vStatus = db.settings.voiceMode ? "ENABLED 🎙" : "DISABLED 💬";
                    return sock.sendMessage(jid, { text: `🎙 Voice Mode: *${vStatus}*\n\n_Usage: \`!voice on\` | \`!voice off\`_` });
                }
                if (command === 'groupchat') {
                    commandHandled = true;
                    if (subInput.toLowerCase() === 'on') {
                        db.settings.groupChatMode = true;
                        saveDB();
                        return sock.sendMessage(jid, { text: "👥 *Group Chat Mode:* ACTIVATED ✅ (AI will reply in groups only when tagged/replied to)" });
                    }
                    if (subInput.toLowerCase() === 'off') {
                        db.settings.groupChatMode = false;
                        saveDB();
                        return sock.sendMessage(jid, { text: "👥 *Group Chat Mode:* DEACTIVATED ❌ (AI will stay silent in all groups)" });
                    }
                    const gStatus = db.settings.groupChatMode ? "ACTIVE ✅" : "INACTIVE ❌";
                    return sock.sendMessage(jid, { text: `👥 Group Chat Mode: *${gStatus}*\n\n_Usage: \`!groupchat on\` | \`!groupchat off\`_` });
                }
                if (command === 'business') {
                    commandHandled = true;
                    if (subInput.toLowerCase() === 'on') {
                        db.settings.businessActive = true;
                        saveDB();
                        return sock.sendMessage(jid, { text: "💼 *Business Mode:* ENABLED ✅" });
                    }
                    if (subInput.toLowerCase() === 'off') {
                        db.settings.businessActive = false;
                        saveDB();
                        return sock.sendMessage(jid, { text: "💼 *Business Mode:* DISABLED ❌" });
                    }
                    if (subInput.toLowerCase().startsWith('set ')) {
                        const bizInfo = subInput.slice(4).trim();
                        db.settings.businessActive = true;
                        db.settings.businessInfo = bizInfo;
                        saveDB();
                        return sock.sendMessage(jid, { text: `💼 *Business Profile Updated & Activated:*\n"${bizInfo}"` });
                    }
                    const stateVal = db.settings.businessActive ? "ENABLED ✅" : "DISABLED ❌";
                    const profile = db.settings.businessInfo || "None set";
                    return sock.sendMessage(jid, { text: `💼 *Business Mode:* ${stateVal}\n*Current Details:* ${profile}\n\n_Usage: \`!business set <text>\`, \`!business on\`, \`!business off\`_` });
                }
                if (command === 'prices' || command === 'price') {
                    commandHandled = true;
                    if (subInput.toLowerCase().startsWith('set ')) {
                        const priceData = subInput.slice(4).trim();
                        db.settings.pricesInfo = priceData;
                        saveDB();
                        return sock.sendMessage(jid, { text: `💰 *Pricing & Products Updated:*\n"${priceData}"` });
                    }
                    if (subInput.toLowerCase() === 'clear') {
                        db.settings.pricesInfo = "";
                        saveDB();
                        return sock.sendMessage(jid, { text: "💰 *Pricing Info Cleared!*" });
                    }
                    const currentPrices = db.settings.pricesInfo || "No pricing set.";
                    return sock.sendMessage(jid, { text: `💰 *Current Prices & Products:*\n${currentPrices}\n\n_Usage: \`!prices set <details>\`, \`!prices clear\`_` });
                }
                if (command === 'location') {
                    commandHandled = true;
                    if (subInput.toLowerCase().startsWith('set ')) {
                        const locData = subInput.slice(4).trim();
                        db.settings.locationInfo = locData;
                        saveDB();
                        return sock.sendMessage(jid, { text: `📍 *Location Stamped:*\n"${locData}"` });
                    }
                    if (subInput.toLowerCase() === 'clear') {
                        db.settings.locationInfo = "";
                        saveDB();
                        return sock.sendMessage(jid, { text: "📍 *Location Cleared!*" });
                    }
                    const currentLoc = db.settings.locationInfo || "No location set.";
                    return sock.sendMessage(jid, { text: `📍 *Current Location:*\n${currentLoc}\n\n_Usage: \`!location set <address>\`, \`!location clear\`_` });
                }
                if (command === 'owner') {
                    commandHandled = true;
                    if (subInput.toLowerCase().startsWith('set ')) {
                        const newOwnerName = subInput.slice(4).trim();
                        db.settings.customOwnerName = newOwnerName;
                        saveDB();
                        return sock.sendMessage(jid, { text: `👑 *Owner Name Overwritten Successfully!*\nNew Owner Name: *${newOwnerName}*` });
                    }
                    if (subInput.toLowerCase() === 'clear') {
                        db.settings.customOwnerName = "";
                        saveDB();
                        return sock.sendMessage(jid, { text: "👑 *Custom Owner Name Cleared!* Reverted to fallback name." });
                    }
                    const activeOwner = db.settings.customOwnerName || defaultOwnerName;
                    return sock.sendMessage(jid, { text: `👑 *Current Owner Name:* ${activeOwner}\n\n_Usage: \`!owner set <new name>\`, \`!owner clear\`_\n_(To change the owner's number instead, use \`!owner number <value>\` or \`!ownernumber\`.)_` });
                }
                if (command === 'ownernumber') {
                    commandHandled = true;
                    const subLower = subInput.toLowerCase();
                    if (subLower === 'clear') {
                        db.settings.customOwnerNumber = "";
                        saveDB();
                        return sock.sendMessage(jid, { text: "📞 *Custom Owner Number Cleared!* Reverted to this WhatsApp account's own number." });
                    }
                    if (subLower.startsWith('set ')) {
                        const newOwnerNumber = subInput.slice(4).replace(/[^0-9]/g, "");
                        if (!newOwnerNumber) {
                            return sock.sendMessage(jid, { text: "⚠️ Usage: `!ownernumber set <number>` e.g. `!ownernumber set 2349135615687`" });
                        }
                        db.settings.customOwnerNumber = newOwnerNumber;
                        saveDB();
                        return sock.sendMessage(jid, { text: `📞 *Owner Number Overwritten Successfully!*\nNew Owner Number: *+${newOwnerNumber}*` });
                    }
                    if (subInput.trim() !== '') {
                        const newOwnerNumber = subInput.replace(/[^0-9]/g, "");
                        if (!newOwnerNumber) {
                            return sock.sendMessage(jid, { text: "⚠️ Usage: `!ownernumber set <number>` or just `!ownernumber <number>` e.g. `!ownernumber 2349135615687`" });
                        }
                        db.settings.customOwnerNumber = newOwnerNumber;
                        saveDB();
                        return sock.sendMessage(jid, { text: `📞 *Owner Number Overwritten Successfully!*\nNew Owner Number: *+${newOwnerNumber}*` });
                    }
                    const activeOwnerNumber = db.settings.customOwnerNumber || botPhone;
                    return sock.sendMessage(jid, { text: `📞 *Current Owner Number:* +${activeOwnerNumber}\n\n_Usage: \`!ownernumber <number>\`, \`!ownernumber set <number>\`, \`!ownernumber clear\`_` });
                }
                if (command === 'py') {
                    commandHandled = true;
                    if (!subInput) {
                        return sock.sendMessage(jid, { text: "⚠️ Usage: `!py <python code or command>`" });
                    }
                    try {
                        const pyResult = await runSystemCommand(`python3 -c "${subInput}"`);
                        await simulateHumanTyping(sock, jid, pyResult);
                        return sock.sendMessage(jid, { text: pyResult });
                    } catch (err) {
                        return sock.sendMessage(jid, { text: `🐍 Python Execution Error:\n${err}` });
                    }
                }
                if (command === 'lang' || command === 'language') {
                    commandHandled = true;
                    const sub = subInput.trim();
                    const subLower = sub.toLowerCase();
                    if (!sub || subLower === 'list') {
                        const listStr = Object.values(LANGUAGE_MAP).sort().join(', ');
                        return sock.sendMessage(jid, { text: `🌐 *AI Language Mode*\nCurrent: *${db.settings.aiLanguage}*\n\n*Available Languages:*\n${listStr}\n\n_Usage: \`!lang <language>\`, \`!lang reset\`_` });
                    }
                    if (subLower === 'reset' || subLower === 'default' || subLower === 'english') {
                        db.settings.aiLanguage = 'English';
                        saveDB();
                        return sock.sendMessage(jid, { text: "🌐 *AI Language reset to:* English ✅" });
                    }
                    const target = subLower.startsWith('set ') ? sub.slice(4).trim() : sub;
                    const matchKey = findClosestLanguage(target);
                    if (matchKey) {
                        db.settings.aiLanguage = LANGUAGE_MAP[matchKey];
                        saveDB();
                        return sock.sendMessage(jid, { text: `🌐 *AI Language switched to:* ${LANGUAGE_MAP[matchKey]} ✅\n_The assistant will now default to replying in ${LANGUAGE_MAP[matchKey]}._` });
                    } else {
                        const listStr = Object.values(LANGUAGE_MAP).sort().join(', ');
                        return sock.sendMessage(jid, { text: `❌ Couldn't recognize "*${target}*" as a supported language.\n\n*Available Languages:*\n${listStr}\n\n_Usage: \`!lang <language>\`, e.g. \`!lang yoruba\`_` });
                    }
                }
                if (command === 'hidetag') {
                    commandHandled = true;
                    if (!isGroup) {
                        return sock.sendMessage(jid, { text: "⚠️ This command can only be used inside groups!" });
                    }
                    try {
                        const metadata = await sock.groupMetadata(jid);
                        const participants = metadata.participants.map(p => p.id);
                        const tagMessage = subInput || "Attention everyone!";
                        await sock.sendMessage(jid, {
                            text: tagMessage,
                            mentions: participants
                        });
                    } catch (err) {
                        console.error("Hidetag Error:", err.message);
                        return sock.sendMessage(jid, { text: "❌ Failed to execute hidetag." });
                    }
                    continue;
                }
                if (command === 'listonline') {
                    commandHandled = true;
                    if (!isGroup) {
                        return sock.sendMessage(jid, { text: "⚠️ This command can only be used inside groups!" });
                    }
                    try {
                        const metadata = await sock.groupMetadata(jid);
                        const participants = metadata.participants.map(p => p.id);
                        let onlineJids = [];
                        for (const memberJid of participants) {
                            try {
                                await sock.presenceSubscribe(memberJid);
                                const pData = sock.presences?.[memberJid];
                                if (pData && (pData.lastKnownPresence === 'available' || pData.lastKnownPresence === 'composing' || pData.lastKnownPresence === 'recording')) {
                                    onlineJids.push(memberJid);
                                }
                            } catch (e) {}
                        }
                        if (onlineJids.length === 0 && db.groups[jid] && db.groups[jid].members) {
                            const now = new Date().getTime();
                            for (const memberJid of participants) {
                                const phone = extractPhoneNumber(memberJid);
                                const mRecord = db.groups[jid].members[phone];
                                if (mRecord && mRecord.lastActive) {
                                    const lastActiveTime = new Date(mRecord.lastActive).getTime();
                                    if (now - lastActiveTime < 600000) {
                                        onlineJids.push(memberJid);
                                    }
                                }
                            }
                        }
                        if (onlineJids.length === 0) {
                            return sock.sendMessage(jid, { text: "🟢 No active/online group members detected right now." });
                        }
                        let listText = `🟢 *Active / Online Group Members (${onlineJids.length}):*\n\n`;
                        onlineJids.forEach((memberJid, index) => {
                            const phone = extractPhoneNumber(memberJid);
                            listText += `${index + 1}. @${phone}\n`;
                        });
                        await sock.sendMessage(jid, {
                            text: listText,
                            mentions: onlineJids
                        });
                    } catch (err) {
                        console.error("Listonline Error:", err.message);
                        return sock.sendMessage(jid, { text: "❌ Failed to fetch online members." });
                    }
                    continue;
                }
                if (command === 'svcontact') {
                    commandHandled = true;
                    if (!isGroup) {
                        return sock.sendMessage(jid, { text: "⚠️ This command can only be used inside groups!" });
                    }
                    try {
                        const metadata = await sock.groupMetadata(jid);
                        const groupName = metadata.subject || "Group_Contacts";
                        const participants = metadata.participants.map(p => p.id);
                        let vcfContent = "";
                        participants.forEach((pJid, idx) => {
                            const phone = extractPhoneNumber(pJid);
                            const contactName = `Member ${idx + 1} (${phone})`;
                            vcfContent += `BEGIN:VCARD\nVERSION:3.0\nFN:${contactName}\nTEL;type=CELL;type=VOICE;waid=${phone}:+${phone}\nEND:VCARD\n`;
                        });
                        const vcfFileName = `Group_Contacts_${Date.now()}.vcf`;
                        const vcfFilePath = path.join(downloadDir, vcfFileName);
                        fs.writeFileSync(vcfFilePath, vcfContent);
                        await sock.sendMessage(jid, {
                            document: fs.readFileSync(vcfFilePath),
                            mimetype: 'text/vcard',
                            fileName: `${groupName}_Contacts.vcf`,
                            caption: `📇 *Group Contacts VCF Generated!*\nTotal Contacts: ${participants.length}\n_Click the file to save all contacts and instantly message them on WhatsApp._`
                        });
                        if (fs.existsSync(vcfFilePath)) fs.unlinkSync(vcfFilePath);
                    } catch (err) {
                        console.error("Svcontact Error:", err.message);
                        return sock.sendMessage(jid, { text: "❌ Failed to generate group VCF contacts file." });
                    }
                    continue;
                }
                if (command === 'memories') {
                    commandHandled = true;
                    let memoryList = "*🧠 BOT MEMORY VAULT (TRACKED CONTACTS)*\n\n";
                    const contacts = Object.keys(db.contacts);
                    if (contacts.length === 0) {
                        memoryList += "No contacts logged yet.";
                    } else {
                        contacts.forEach(phone => {
                            const c = db.contacts[phone];
                            memoryList += `👤 *${c.name}* (+${phone})\n`;
                            if (c.nickname) memoryList += `   🏷 Nickname: ${c.nickname}\n`;
                            if (c.notes) memoryList += `   📝 Owner Notes: ${c.notes}\n`;
                            memoryList += `   💗 Mood: ${c.mood || 'neutral'} | Bond: ${c.bondScore || 0}/10\n`;
                            memoryList += `   🕒 Last Active: ${ngLocaleTimeString(new Date(c.lastSeen))}\n\n`;
                        });
                    }
                    await simulateHumanTyping(sock, jid, memoryList);
                    return sock.sendMessage(jid, { text: memoryList });
                }
                if (command === 'remember') {
                    commandHandled = true;
                    const phoneMatch = subInput.match(/^(\d+)\s*/);
                    if (!phoneMatch) {
                        return sock.sendMessage(jid, { text: "⚠️ Usage: `!remember <phone_number> <nickname> | <note>`\ne.g. `!remember 14692084400176 Chi Chi | Charlie's sister`" });
                    }
                    const phone = phoneMatch[1];
                    let remainder = subInput.slice(phoneMatch[0].length).trim();
                    let nickname = "";
                    let note = "";
                    if (remainder.includes('|')) {
                        const [nickPart, ...noteParts] = remainder.split('|');
                        nickname = nickPart.trim();
                        note = noteParts.join('|').trim();
                    } else {
                        note = remainder.trim();
                    }
                    if (!nickname && !note) {
                        return sock.sendMessage(jid, { text: "⚠️ Usage: `!remember <phone_number> <nickname> | <note>`\ne.g. `!remember 14692084400176 Chi Chi | Charlie's sister`" });
                    }
                    if (!db.contacts[phone]) {
                        db.contacts[phone] = {
                            jid: `${phone}@s.whatsapp.net`,
                            name: nickname ? nickname : `User +${phone}`,
                            nickname: nickname,
                            firstSeen: new Date().toISOString(),
                            lastSeen: new Date().toISOString(),
                            notes: note,
                            mood: "neutral",
                            bondScore: 0,
                            lastAfkNotified: "",
                            history: []
                        };
                    } else {
                        if (nickname) {
                            db.contacts[phone].nickname = nickname;
                            if (db.contacts[phone].name.startsWith('User +')) {
                                db.contacts[phone].name = nickname;
                            }
                        }
                        if (note) db.contacts[phone].notes = note;
                    }
                    saveDB();
                    return sock.sendMessage(jid, { text: `✅ Saved for +${phone}:\n${nickname ? `Name/Nickname: "${nickname}"\n` : ""}${note ? `Note: "${note}"` : ""}` });
                }
                if (command === 'history') {
                    commandHandled = true;
                    const phone = subInput.replace(/[^0-9]/g, "");
                    if (!phone) {
                        return sock.sendMessage(jid, { text: "⚠️ Usage: `!history <phone_number>`" });
                    }
                    if (!db.contacts[phone]) {
                        return sock.sendMessage(jid, { text: `❌ Phone number +${phone} not found in memory.` });
                    }
                    const c = db.contacts[phone];
                    let historyOutput = `📜 *CHAT HISTORY FOR ${c.name.toUpperCase()} (+${phone})*\n\n`;
                    if (!c.history || c.history.length === 0) {
                        historyOutput += "No recent chat logs recorded.";
                    } else {
                        historyOutput += c.history.map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join('\n');
                    }
                    await simulateHumanTyping(sock, jid, historyOutput);
                    return sock.sendMessage(jid, { text: historyOutput });
                }
                if (command === 'wipe') {
                    commandHandled = true;
                    try {
                        db = {
                            contacts: {},
                            groups: {},
                            settings: {
                                botActive: true,
                                voiceMode: false,
                                groupChatMode: true,
                                businessActive: false,
                                businessInfo: "",
                                pricesInfo: "",
                                locationInfo: "",
                                customOwnerName: "",
                                customOwnerNumber: "",
                                aiLanguage: "English",
                                assistantMood: "",
                                assistantMoodDate: "",
                                lastBioUpdateDate: "",
                                blacklist: [],
                                afkActive: false,
                                afkReason: "",
                                afkSince: "",
                                ttsVoice: "en-US-AndrewNeural",
                                antispamActive: true
                            }
                        };
                        saveDB();
                        return sock.sendMessage(jid, { text: "🧹 *Bot Memory Wiped Successfully!* All contacts and history have been reset." });
                    } catch (err) {
                        return sock.sendMessage(jid, { text: `❌ Wipe Error:\n${err}` });
                    }
                }
                if (command === 'status' || command === 'sys') {
                    commandHandled = true;
                    try {
                        const uptimeSecs = process.uptime();
                        const hours = Math.floor(uptimeSecs / 3600);
                        const mins = Math.floor((uptimeSecs % 3600) / 60);
                        const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;
                        const timeCtx = getTimeContext();
                        const sysInfo = `📊 *SYSTEM STATUS REPORT*\n⏱️ Uptime: ${hours}h ${mins}m\n💾 RAM Heap: ${memoryUsage.toFixed(2)} MB\n👥 Saved Contacts: ${Object.keys(db.contacts).length}\n🤖 Bot Active: ${db.settings.botActive ? 'YES ✅' : 'NO ❌'}\n🎙 Voice Mode: ${db.settings.voiceMode ? 'ON 🎙' : 'OFF 💬'}\n👥 Group Chat Mode: ${db.settings.groupChatMode ? 'ON ✅' : 'OFF ❌'}\n💼 Business Mode: ${db.settings.businessActive ? 'ON ✅' : 'OFF ❌'}\n🌐 Language: ${db.settings.aiLanguage}\n👑 Owner Name: ${db.settings.customOwnerName || defaultOwnerName}\n📞 Owner Number: +${db.settings.customOwnerNumber || botPhone}\n💗 Assistant Mood Today: ${getAssistantMood()}\n🕒 Current Time (Nigeria): ${timeCtx.readable}\n📅 Full Date: ${timeCtx.dateStr}\n🪪 Last Bio Auto-Update: ${db.settings.lastBioUpdateDate || 'not yet'}\n🚫 Blacklisted Numbers: ${db.settings.blacklist.length}\n💤 AFK: ${db.settings.afkActive ? `ON ("${db.settings.afkReason}")` : 'OFF'}\n🎙 TTS Voice (Edge TTS): ${db.settings.ttsVoice}\n🛡 Duplicate Media Antispam: ${db.settings.antispamActive ? 'ON ✅' : 'OFF ❌'}`;
                        return sock.sendMessage(jid, { text: sysInfo });
                    } catch (e) {
                        return sock.sendMessage(jid, { text: "⚠️ Failed to fetch system status." });
                    }
                }
                if (command === 'vv') {
                    commandHandled = true;
                    const quotedId = contextInfo?.stanzaId;
                    if (!quotedId) {
                        return sock.sendMessage(jid, { text: "⚠️ Reply directly to a view-once photo, video, or voice note with `.vv` to unlock it." });
                    }
                    const savedMedia = messageStore.get(quotedId);
                    if (!savedMedia || !savedMedia.isMedia || !savedMedia.filePath || !fs.existsSync(savedMedia.filePath)) {
                        console.error(`[VV Error] No stored media found for stanzaId=${quotedId}. This usually means the media failed to download when it first arrived - check for a "[Media Download Error]" log around the time it was sent.`);
                        return sock.sendMessage(jid, { text: "❌ Couldn't find that view-once media - it may have expired, already been opened, or wasn't saved." });
                    }
                    try {
                        const buffer = fs.readFileSync(savedMedia.filePath);
                        if (savedMedia.mediaType === 'imageMessage') {
                            await sock.sendMessage(jid, { image: buffer, caption: "🔓 View-once photo unlocked" });
                        } else if (savedMedia.mediaType === 'videoMessage' || savedMedia.mediaType === 'ptvMessage') {
                            await sock.sendMessage(jid, { video: buffer, caption: "🔓 View-once video unlocked" });
                        } else if (savedMedia.mediaType === 'audioMessage') {
                            await sock.sendMessage(jid, { audio: buffer, mimetype: 'audio/ogg; codecs=opus', ptt: true });
                        } else {
                            await sock.sendMessage(jid, { document: buffer, fileName: 'unlocked_media', caption: "🔓 View-once media unlocked" });
                        }
                    } catch (err) {
                        console.error("VV Error:", err.message);
                        return sock.sendMessage(jid, { text: "❌ Failed to resend that view-once media." });
                    }
                    continue;
                }
                if (command === 'translate') {
                    commandHandled = true;
                    if (!subInput) {
                        return sock.sendMessage(jid, { text: "⚠️ Usage: `!translate <language> <text>` or reply to a text message with `!translate <language>`" });
                    }
                    const firstSpaceIdx = subInput.indexOf(' ');
                    let targetLangRaw = firstSpaceIdx === -1 ? subInput : subInput.slice(0, firstSpaceIdx);
                    let textToTranslate = firstSpaceIdx === -1 ? "" : subInput.slice(firstSpaceIdx + 1).trim();
                    if (!textToTranslate && contextInfo?.quotedMessage) {
                        const quotedUnwrapped = deepUnwrapMessage(contextInfo.quotedMessage);
                        textToTranslate = quotedUnwrapped.conversation || quotedUnwrapped.extendedTextMessage?.text || quotedUnwrapped.imageMessage?.caption || "";
                    }
                    if (!textToTranslate) {
                        return sock.sendMessage(jid, { text: "⚠️ Usage: `!translate <language> <text>` or reply to a text message with `!translate <language>`" });
                    }
                    const matchKey = findClosestLanguage(targetLangRaw);
                    const targetLangName = matchKey ? LANGUAGE_MAP[matchKey] : targetLangRaw;
                    try {
                        const res = await axios.post(
                            'https://api.groq.com/openai/v1/chat/completions',
                            {
                                model: 'openai/gpt-oss-120b',
                                messages: [
                                    { role: 'system', content: `You are a precise translator. Translate the user's text into ${targetLangName}. Output ONLY the translated text, nothing else - no quotes, no explanations, no labels.` },
                                    { role: 'user', content: textToTranslate }
                                ],
                                temperature: 0.3,
                                max_tokens: 500
                            },
                            { headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' } }
                        );
                        const translated = res.data?.choices?.[0]?.message?.content?.trim() || "";
                        if (!translated) throw new Error("Empty translation");
                        return sock.sendMessage(jid, { text: `🌐 *Translation (${targetLangName}):*\n${translated}` });
                    } catch (err) {
                        console.error("Translate Error:", err.response?.data || err.message);
                        return sock.sendMessage(jid, { text: "❌ Failed to translate that text." });
                    }
                }
                if (command === 'ttsvoice') {
                    commandHandled = true;
                    const subLower = subInput.toLowerCase().trim();
                    if (!subLower || subLower === 'list') {
                        return sock.sendMessage(jid, { text: `🎙 *TTS Voice (Edge TTS - natural neural voices)*\nCurrent: *${db.settings.ttsVoice}*\n\n*Available Voices:*\n${AVAILABLE_TTS_VOICES.join(', ')}\n\n_Usage: \`!ttsvoice <voice>\`, \`!ttsvoice reset\`_` });
                    }
                    if (subLower === 'reset' || subLower === 'default') {
                        db.settings.ttsVoice = 'en-US-AndrewNeural';
                        saveDB();
                        return sock.sendMessage(jid, { text: "🎙 *TTS Voice reset to default:* en-US-AndrewNeural ✅" });
                    }
                    const matchedVoice = AVAILABLE_TTS_VOICES.find(v => v.toLowerCase() === subLower);
                    if (!matchedVoice) {
                        return sock.sendMessage(jid, { text: `❌ Unknown voice "*${subInput}*".\n\n*Available Voices:*\n${AVAILABLE_TTS_VOICES.join(', ')}` });
                    }
                    db.settings.ttsVoice = matchedVoice;
                    saveDB();
                    return sock.sendMessage(jid, { text: `🎙 *TTS Voice switched to:* ${matchedVoice} ✅\n_Try sending a message in Voice Mode to hear it._` });
                }
                if (command === 'poll') {
                    commandHandled = true;
                    if (!subInput.includes('|')) {
                        return sock.sendMessage(jid, { text: "⚠️ Usage: `!poll <question> | option1 | option2 | option3...`\ne.g. `!poll What should we eat? | Pizza | Suya | Jollof`" });
                    }
                    const parts = subInput.split('|').map(p => p.trim()).filter(p => p.length > 0);
                    const question = parts[0];
                    const options = parts.slice(1);
                    if (!question || options.length < 2) {
                        return sock.sendMessage(jid, { text: "⚠️ A poll needs a question and at least 2 options.\nUsage: `!poll <question> | option1 | option2 | option3...`" });
                    }
                    if (options.length > 12) {
                        return sock.sendMessage(jid, { text: "⚠️ WhatsApp polls support a maximum of 12 options." });
                    }
                    try {
                        await sock.sendMessage(jid, {
                            poll: {
                                name: question,
                                values: options,
                                selectableCount: 1
                            }
                        });
                    } catch (err) {
                        console.error("Poll Error:", err.message);
                        return sock.sendMessage(jid, { text: "❌ Failed to create that poll." });
                    }
                    continue;
                }
                if (command === 'blacklist') {
                    commandHandled = true;
                    const subLower = subInput.toLowerCase();
                    if (subLower === 'list') {
                        const list = db.settings.blacklist.length ? db.settings.blacklist.map(p => `+${p}`).join('\n') : 'No blacklisted numbers.';
                        return sock.sendMessage(jid, { text: `🚫 *Blacklisted Numbers:*\n${list}` });
                    }
                    if (subLower.startsWith('remove ')) {
                        const remPhone = subInput.slice(7).replace(/[^0-9]/g, "");
                        db.settings.blacklist = db.settings.blacklist.filter(p => p !== remPhone);
                        saveDB();
                        return sock.sendMessage(jid, { text: `✅ Removed +${remPhone} from blacklist.` });
                    }
                    let targetPhone = "";
                    const mentioned = contextInfo?.mentionedJid?.[0];
                    const quotedParticipant = contextInfo?.participant;
                    if (mentioned) {
                        targetPhone = extractPhoneNumber(mentioned);
                    } else if (quotedParticipant) {
                        targetPhone = extractPhoneNumber(quotedParticipant);
                    } else if (!isGroup && subInput.trim()) {
                        targetPhone = subInput.replace(/[^0-9]/g, "");
                    }
                    if (!targetPhone) {
                        return sock.sendMessage(jid, { text: isGroup
                            ? "⚠️ Usage: @mention someone or reply to their message with `!blacklist`."
                            : "⚠️ Usage: `!blacklist <number>` e.g. `!blacklist 2349135615687`\n_Other: `!blacklist list`, `!blacklist remove <number>`_" });
                    }
                    if (!db.settings.blacklist.includes(targetPhone)) {
                        db.settings.blacklist.push(targetPhone);
                        saveDB();
                    }
                    return sock.sendMessage(jid, { text: `🚫 *+${targetPhone} has been blacklisted.* The assistant will now fully ignore this number.` });
                }
                if (command === 'afk') {
                    commandHandled = true;
                    const subLower = subInput.toLowerCase();
                    if (subLower === 'clear' || subLower === 'off') {
                        db.settings.afkActive = false;
                        db.settings.afkReason = "";
                        saveDB();
                        return sock.sendMessage(jid, { text: "✅ *AFK status cleared.* Welcome back!" });
                    }
                    db.settings.afkActive = true;
                    db.settings.afkReason = subInput.trim() || "no reason given";
                    db.settings.afkSince = new Date().toISOString();
                    saveDB();
                    return sock.sendMessage(jid, { text: `💤 *AFK Mode Activated*\nReason: "${db.settings.afkReason}"\n_The assistant will let people know you're away when relevant. Use \`!afk clear\` when you're back._` });
                }
                if (command === 'antispam') {
                    commandHandled = true;
                    if (subInput.toLowerCase() === 'on') {
                        db.settings.antispamActive = true;
                        saveDB();
                        return sock.sendMessage(jid, { text: "🛡 *Duplicate Media Antispam:* ACTIVATED ✅ (repeated stickers/photos/videos in groups get deleted, warned, then kicked after 3 strikes)" });
                    }
                    if (subInput.toLowerCase() === 'off') {
                        db.settings.antispamActive = false;
                        saveDB();
                        return sock.sendMessage(jid, { text: "🛡 *Duplicate Media Antispam:* DEACTIVATED ❌" });
                    }
                    const aStatus = db.settings.antispamActive ? "ACTIVE ✅" : "INACTIVE ❌";
                    return sock.sendMessage(jid, { text: `🛡 Duplicate Media Antispam: *${aStatus}*\n\n_Usage: \`!antispam on\` | \`!antispam off\`_` });
                }
                if (command === 'steal') {
                    commandHandled = true;
                    const quoted = contextInfo?.quotedMessage;
                    if (!quoted) {
                        return sock.sendMessage(jid, { text: "⚠️ Reply to a sticker, image, or video with `!steal` to grab it." });
                    }
                    const quotedUnwrapped = deepUnwrapMessage(quoted);
                    const stealType = quotedUnwrapped.stickerMessage ? 'sticker'
                        : quotedUnwrapped.imageMessage ? 'image'
                        : (quotedUnwrapped.videoMessage ? 'video' : null);
                    if (!stealType) {
                        return sock.sendMessage(jid, { text: "⚠️ That's not a sticker, image, or video I can steal." });
                    }
                    let tempInPath = null;
                    let tempOutPath = null;
                    try {
                        const stream = await downloadContentFromMessage(quotedUnwrapped[`${stealType}Message`], stealType);
                        let bufferChunks = [];
                        for await (const chunk of stream) bufferChunks.push(chunk);
                        const mediaBuffer = Buffer.concat(bufferChunks);
                        let finalStickerBuffer;
                        if (stealType === 'sticker') {
                            finalStickerBuffer = mediaBuffer;
                        } else {
                            const inExt = stealType === 'video' ? 'mp4' : 'jpg';
                            tempInPath = path.join(downloadDir, `steal_in_${Date.now()}.${inExt}`);
                            tempOutPath = path.join(downloadDir, `steal_out_${Date.now()}.webp`);
                            fs.writeFileSync(tempInPath, mediaBuffer);
                            await runSystemCommand(`ffmpeg -i "${tempInPath}" -vcodec libwebp -filter:v "fps=15,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:-1:-1:color=white@0.0" -lossless 0 -compression_level 6 -q:v 50 -loop 0 -preset default -an -vsync 0 "${tempOutPath}" -y`);
                            finalStickerBuffer = fs.readFileSync(tempOutPath);
                        }
                        const taggedBuffer = await writeExifToWebp(finalStickerBuffer, "Mr Man", ownerName);
                        await sock.sendMessage(jid, { sticker: taggedBuffer });
                    } catch (err) {
                        console.error("Steal Sticker Error:", err.message);
                        return sock.sendMessage(jid, { text: "❌ Failed to steal that sticker." });
                    } finally {
                        if (tempInPath && fs.existsSync(tempInPath)) fs.unlinkSync(tempInPath);
                        if (tempOutPath && fs.existsSync(tempOutPath)) fs.unlinkSync(tempOutPath);
                    }
                    continue;
                }
                if (!commandHandled) {
                    const fallbackHelp = `⚠️ *Unrecognized Command:* \`${command}\`
Available Commands:
🤖 *!bot* - \`on\` | \`off\`
🎙 *!voice* - \`on\` | \`off\`
👥 *!groupchat* - \`on\` | \`off\`
💼 *!business* - \`set <info>\` | \`on\` | \`off\`
💰 *!prices* - \`set <details>\` | \`clear\`
📍 *!location* - \`set <address>\` | \`clear\`
👑 *!owner* - \`set <new name>\` | \`clear\`
📞 *!ownernumber* - \`<number>\` | \`set <number>\` | \`clear\` (alias: \`!owner number ...\`)
🐍 *!py* - \`<python code>\`
🌐 *!lang* - \`<language>\` | \`list\` | \`reset\`
📢 *!hidetag* - \`<message>\`
🟢 *!listonline* - List active/online group members
📇 *!svcontact* - Generate VCF file of all group members
🧹 *!wipe* - Clear all saved memory & history
📊 *!status* - Check system uptime & memory
🧠 *!memories* - View saved contacts list
📝 *!remember* - \`<phone_number> <nickname> | <note>\`
📜 *!history* - \`<phone_number>\`
🔓 *!vv* - Reply to a view-once photo/video/voice note to unlock it
🌐 *!translate* - \`<language> <text>\` or reply to a message
🎙 *!ttsvoice* - \`<voice>\` | \`list\` | \`reset\` (Edge TTS neural voices)
📊 *!poll* - \`<question> | option1 | option2 ...\`
🚫 *!blacklist* - @mention/reply in groups, \`<number>\` in DM | \`list\` | \`remove <number>\`
💤 *!afk* - \`<reason>\` | \`clear\`
🛡 *!antispam* - \`on\` | \`off\` (duplicate media auto-delete + warn + kick in groups)
🥷 *!steal* - reply to a sticker/image/video to steal it as a "Mr Man" sticker`;
                    return sock.sendMessage(jid, { text: fallbackHelp });
                }
            }
            // ===== DELETED MESSAGE DETECTOR =====
            if (msg.message.protocolMessage && msg.message.protocolMessage.type === 0) {
                const deletedId = msg.message.protocolMessage.key.id;
                const savedMsg = messageStore.get(deletedId);
                console.log('\n\x1b[41m\x1b[37m 🚨 DELETED MESSAGE DETECTED! 🚨 \x1b[0m');
                console.log(`\x1b[31mFrom:\x1b[0m ${pushName} (+${extractPhoneNumber(cleanSenderJid)})`);
                console.log(`\x1b[31mTime:\x1b[0m ${time}`);
                if (savedMsg) {
                    if (savedMsg.isMedia) {
                        console.log('\x1b[33mSender tried to delete a media file!\x1b[0m');
                        console.log(`\x1b[32m📁 Saved copy location:\x1b[0m ${savedMsg.filePath}`);
                    } else {
                        console.log(`\x1b[33mDeleted Text:\x1b[0m "${savedMsg.text}"`);
                    }
                }
                console.log('-----------------------------------');
                continue;
            }
            // ===== AUTO-SAVE MEDIA & AUDIO TRANSCRIBER =====
            const mediaType = Object.keys(unwrapMessage).find(key =>
                ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage', 'ptvMessage'].includes(key)
            );
            let downloadedBuffer = null;
            let mimeType = "image/jpeg";
            if (mediaType) {
                let ext = 'bin';
                if (mediaType === 'imageMessage') {
                    ext = 'jpg';
                    mimeType = unwrapMessage.imageMessage?.mimetype || "image/jpeg";
                } else if (mediaType === 'videoMessage' || mediaType === 'ptvMessage') ext = 'mp4';
                else if (mediaType === 'stickerMessage') ext = 'webp';
                else if (mediaType === 'audioMessage') ext = 'ogg';
                try {
                    // FIX (.vv always failing): the old code called downloadMediaMessage(msg, ...)
                    // with the RAW top-level message object. For view-once media the actual
                    // image/video/audio node lives nested inside viewOnceMessage(V2)/ephemeralMessage
                    // wrappers, and depending on the installed Baileys version's internal content-type
                    // detection, that nested media can get missed or mis-typed, causing the download to
                    // silently throw - which is exactly why .vv always reported "no stored media found"
                    // even on media that had never been opened yet. We now pull the ALREADY-unwrapped
                    // media node (unwrapMessage[mediaType], the same one used to detect mediaType above)
                    // and download it directly with downloadContentFromMessage - the same low-level,
                    // proven-working method the !steal command already uses successfully.
                    const mediaMessageObj = unwrapMessage[mediaType];
                    const shortType = mediaType === 'ptvMessage' ? 'video' : mediaType.replace('Message', '');
                    const stream = await downloadContentFromMessage(mediaMessageObj, shortType);
                    const chunks = [];
                    for await (const chunk of stream) chunks.push(chunk);
                    downloadedBuffer = Buffer.concat(chunks);
                    const filename = `WA_${Date.now()}.${ext}`;
                    const filePath = path.join(downloadDir, filename);
                    fs.writeFileSync(filePath, downloadedBuffer);
                    messageStore.set(msgId, { isMedia: true, filePath, mediaType });
                    if (mediaType === 'audioMessage' && downloadedBuffer) {
                        const transcribedSpeech = await transcribeAudio(downloadedBuffer);
                        if (transcribedSpeech) {
                            text = `[Voice Note Transcribed]: ${transcribedSpeech}`;
                        }
                    }
                } catch (e) {
                    console.error(`[Media Download Error] type=${mediaType} msgId=${msgId} from=${pushName} (+${extractPhoneNumber(cleanSenderJid)}):`, e.message || e);
                }
            }
            if (text) messageStore.set(msgId, { isMedia: false, text });
            // ===== DUPLICATE MEDIA ANTISPAM ENGINE =====
            if (db.settings.antispamActive && isGroup && !isFromMe && downloadedBuffer && ['imageMessage', 'videoMessage', 'stickerMessage'].includes(mediaType)) {
                try {
                    if (!db.groups[jid]) db.groups[jid] = { members: {}, warnings: {} };
                    if (!db.groups[jid].mediaSpam) db.groups[jid].mediaSpam = {};
                    if (!db.groups[jid].mediaWarnings) db.groups[jid].mediaWarnings = {};
                    const senderPhone = extractPhoneNumber(cleanSenderJid);
                    const contentHash = crypto.createHash('md5').update(downloadedBuffer).digest('hex');
                    const tracker = db.groups[jid].mediaSpam[senderPhone] || { hash: "", count: 0 };
                    if (tracker.hash === contentHash) {
                        tracker.count += 1;
                    } else {
                        tracker.hash = contentHash;
                        tracker.count = 1;
                    }
                    db.groups[jid].mediaSpam[senderPhone] = tracker;
                    if (tracker.count >= 3) {
                        await sock.sendMessage(jid, { delete: msg.key }).catch(() => {});
                        const currentWarnings = (db.groups[jid].mediaWarnings[senderPhone] || 0) + 1;
                        db.groups[jid].mediaWarnings[senderPhone] = currentWarnings;
                        db.groups[jid].mediaSpam[senderPhone] = { hash: "", count: 0 };
                        saveDB();
                        if (currentWarnings >= 3) {
                            try {
                                const metadata = await sock.groupMetadata(jid);
                                const targetParticipant = (metadata.participants || []).find(p => extractPhoneNumber(p.id) === senderPhone);
                                const targetJid = targetParticipant ? targetParticipant.id : cleanSenderJid;
                                await sock.groupParticipantsUpdate(jid, [targetJid], 'remove');
                                await sock.sendMessage(jid, {
                                    text: `🚫 @${senderPhone} was removed for repeatedly flooding duplicate media (3/3 warnings).`,
                                    mentions: [cleanSenderJid]
                                });
                                delete db.groups[jid].mediaWarnings[senderPhone];
                                saveDB();
                            } catch (kickErr) {
                                console.error("Media Spam Kick Error:", kickErr.message || kickErr);
                                await sock.sendMessage(jid, {
                                    text: `⚠️ Failed to remove @${senderPhone}. Error: ${kickErr.message || kickErr}`,
                                    mentions: [cleanSenderJid]
                                });
                            }
                        } else {
                            await sock.sendMessage(jid, {
                                text: `⚠️ Please stop flooding duplicate media @${senderPhone}! Warning ${currentWarnings}/3`,
                                mentions: [cleanSenderJid]
                            });
                        }
                    } else {
                        saveDB();
                    }
                } catch (err) {
                    console.error("Media Antispam Error:", err.message);
                }
            }
            // ===== BULLET-PROOF GROUP TAG & MENTION MATCHER =====
            let isBotTagged = false;
            if (isGroup) {
                const mentions = contextInfo.mentionedJid || [];
                const botJidClean = extractPhoneNumber(botJid);
                const botLidClean = sock.user?.lid ? extractPhoneNumber(sock.user.lid) : null;
                const isJidMentioned = mentions.some(m => {
                    const mClean = extractPhoneNumber(m);
                    return mClean === botJidClean
                        || (botLidClean && mClean === botLidClean)
                        || m === botJid
                        || (sock.user?.lid && m === sock.user.lid);
                });
                const mentionTokens = (text.match(/@(\d{5,})/g) || []).map(t => t.slice(1));
                const isTextMentioned = mentionTokens.some(tok => botJidClean.endsWith(tok) || tok.endsWith(botJidClean));
                const participantClean = contextInfo?.participant ? extractPhoneNumber(contextInfo.participant) : null;
                const isReplyToBot = !!(participantClean && (
                    participantClean === botJidClean
                    || (botLidClean && participantClean === botLidClean)
                ));
                isBotTagged = isJidMentioned || isTextMentioned || isReplyToBot;
                if (!isBotTagged) {
                    console.log(`[Group tag debug] Not tagged. mentions=${JSON.stringify(mentions)} mentionTokens=${JSON.stringify(mentionTokens)} botJid=${botJid} botLid=${sock.user?.lid || 'n/a'} text="${text}"`);
                } else {
                    console.log(`[Group tag debug] TAGGED via ${isJidMentioned ? 'mention' : isTextMentioned ? 'text' : 'reply'}`);
                }
            }
            // ===== DIRECT MESSAGES & VERIFIED GROUP TAGS ENGINE =====
            if (!isGroup || (isGroup && isBotTagged && db.settings.groupChatMode)) {
                if (!db.settings.botActive) continue;
                let cleanedText = text;
                if (isGroup) {
                    cleanedText = text.replace(new RegExp(`@${extractPhoneNumber(botJid)}|@\\d+`, 'g'), '').trim();
                    if (!cleanedText) {
                        cleanedText = "[They just tagged you with no additional message - greet them casually and ask what they need]";
                    }
                }
                let finalReply = "";
                if (unwrapMessage.imageMessage && downloadedBuffer) {
                    finalReply = await analyzeImageWithAI(downloadedBuffer, cleanedText, ownerName, cleanSenderJid, pushName, mimeType, rawSockName || defaultOwnerName, isGroup, isGroup ? jid : null);
                } else if (/who is (your|the) owner|(who (owns|runs) this)/i.test(cleanedText.toLowerCase())) {
                    finalReply = `hi, this is ${ownerName}'s assistant speaking. what do you need?`;
                } else if (cleanedText) {
                    finalReply = await getAIReply(cleanSenderJid, cleanedText, isGroup, ownerName, ownerPhoneNumber, pushName, rawSockName || defaultOwnerName, isGroup ? jid : null);
                }
                if (finalReply) {
                    await simulateHumanTyping(sock, jid, finalReply, msg.key);
                    // FIX (voice mode DM-only): this used to hard-require !isGroup, so Voice Mode
                    // silently fell back to text the moment a group tag triggered a reply. Voice Mode
                    // now follows the exact same reach as Text Mode - wherever the bot is allowed to
                    // reply (DM always, group only when tagged + Group Chat Mode is on), it now also
                    // sends that reply as a voice note when Voice Mode is on, quoting the tagger in
                    // groups so it's clear who it's answering.
                    if (db.settings.voiceMode) {
                        try {
                            const oggPath = await generateAudioResponse(finalReply);
                            await sock.sendMessage(
                                jid,
                                { audio: { url: oggPath }, ptt: true, mimetype: 'audio/ogg; codecs=opus' },
                                isGroup ? { quoted: msg } : {}
                            );
                            if (fs.existsSync(oggPath)) fs.unlinkSync(oggPath);
                            continue;
                        } catch (audioErr) {}
                    }
                    await sendHumanLikeMessage(sock, jid, finalReply, isGroup, msg);
                }
                continue;
            }
            // ===== GROUP MODERATION & KICK ENGINE =====
            if (isGroup) {
                try {
                    if (!db.groups[jid]) db.groups[jid] = { members: {}, warnings: {} };
                    if (!db.groups[jid].warnings) db.groups[jid].warnings = {};
                    const waGroupLinkRegex = /chat\.whatsapp\.com\/([A-Za-z0-9]+)/i;
                    const match = text.match(waGroupLinkRegex);
                    if (match) {
                        let metadata;
                        try {
                            metadata = await sock.groupMetadata(jid);
                        } catch (metaErr) {
                            console.error("Could not fetch group metadata:", metaErr.message);
                            continue;
                        }
                        const participantsList = metadata.participants || [];
                        const isSenderAdmin = participantsList.some(p => normalizeJid(p.id) === cleanSenderJid && (p.admin === 'admin' || p.admin === 'superadmin'));
                        let currentGroupInviteCode = "";
                        try {
                            currentGroupInviteCode = await sock.groupInviteCode(jid);
                        } catch (e) {}
                        const extractedInviteCode = match[1];
                        const isCurrentGroupLink = extractedInviteCode && (extractedInviteCode === currentGroupInviteCode);
                        if (!isSenderAdmin && !isCurrentGroupLink) {
                            await sock.sendMessage(jid, { delete: msg.key }).catch(() => {});
                            const senderPhone = extractPhoneNumber(cleanSenderJid);
                            const currentWarnings = (db.groups[jid].warnings[senderPhone] || 0) + 1;
                            db.groups[jid].warnings[senderPhone] = currentWarnings;
                            saveDB();
                            if (currentWarnings >= 3) {
                                try {
                                    const targetParticipant = participantsList.find(p => extractPhoneNumber(p.id) === senderPhone);
                                    const targetJid = targetParticipant ? targetParticipant.id : rawSender;
                                    await sock.groupParticipantsUpdate(jid, [targetJid], 'remove');
                                    await sock.sendMessage(jid, {
                                        text: `🚫 @${senderPhone} was removed for sending foreign WhatsApp group links (3/3 warnings).`,
                                        mentions: [cleanSenderJid]
                                    });
                                    delete db.groups[jid].warnings[senderPhone];
                                    saveDB();
                                } catch (kickErr) {
                                    console.error("Kick Error Details:", kickErr);
                                    await sock.sendMessage(jid, {
                                        text: `⚠️ Failed to remove @${senderPhone}. Error: ${kickErr.message || kickErr}`,
                                        mentions: [cleanSenderJid]
                                    });
                                }
                            } else {
                                await sock.sendMessage(jid, {
                                    text: `⚠️ Foreign WhatsApp group links are not allowed here @${senderPhone}! Warning ${currentWarnings}/3`,
                                    mentions: [cleanSenderJid]
                                });
                            }
                        }
                    }
                } catch (err) {
                    console.error('Group moderation error:', err.message);
                }
            }
        }
    });
}
startSuperiorAssistant();
