## ⭐ Support the Project

If you find this WhatsApp AI Assistant useful:

- ⭐ Star this repository
- 🍴 Fork it if you want your own copy
- 🐛 Report bugs or suggest features
- 🔗 Share the project with other developers

Your support helps the project grow! 




# 🤖 WhatsApp AI Assistant & Moderation Bot

A powerful, feature-rich WhatsApp personal assistant and group moderation bot built with **Node.js, Baileys, and Termux**.

The assistant combines AI conversation, persistent memory, multilingual support, voice processing, image understanding, realistic human-like responses, business awareness, and automated group moderation.

---

## 🧪 Test the Assistant

To witness the project functioning, message **[+2348137031314](https://wa.me/2348137031314)** to test the assistant before deploying it.

---

## ✨ Features & Capabilities

### 🧠 Smart Contact & Memory Vault

The assistant maintains persistent contact and conversation memory.

- Automatically tracks people who message the bot
- Stores WhatsApp push names
- Saves nicknames and owner notes
- Records recent conversation history
- Tracks contact mood and familiarity
- Stores group membership activity
- Supports cross-channel conversation memory
- Keeps DM and group conversations separated unless the user gives consent

---

### 🌐 Universal Language Mode

The assistant supports multilingual conversations and can be configured to respond in a selected language.

Supported languages include:

- English
- Igbo
- Yoruba
- Hausa
- Nigerian Pidgin
- Swahili
- Zulu
- Amharic
- Russian
- Spanish
- French
- Portuguese
- German
- Italian
- Dutch
- Polish
- Greek
- Turkish
- Hindi
- Urdu
- Bengali
- Punjabi
- Tamil
- Arabic
- Hebrew
- Persian
- Chinese
- Japanese
- Korean
- Vietnamese
- Thai
- Indonesian
- Malay
- Tagalog

The assistant can also mirror the language used by the person messaging it.

---

### 🤖 AI Conversation Engine

Powered by **Groq AI** for fast, context-aware conversations.

The assistant can:

- Maintain conversation context
- Remember recent messages
- Adapt its response to the conversation
- Respond naturally to casual messages
- Adjust its tone based on the user's mood
- Keep responses short and conversational
- Understand whether it is replying in a DM or group
- Identify the configured owner

---

### 💗 Emotional Awareness

The assistant includes an emotion and tone detection system.

It can recognize tones such as:

- Happy
- Sad
- Angry
- Playful
- Sarcastic
- Stressed
- Excited
- Flirty
- Neutral

Its responses can adapt accordingly instead of using the same robotic tone every time.

---

### 🕒 Nigeria Time Awareness

The assistant uses **Africa/Lagos (WAT / UTC+1)** for its time context.

It can understand:

- Current time
- Day of the week
- Morning
- Afternoon
- Evening
- Late night
- Weekends
- Current date

---

### 🟢 Human-Like Presence

The assistant includes an automatic WhatsApp presence pattern.

It can periodically switch between:

- Online
- Offline

This creates a more natural WhatsApp presence pattern.

---

### ⌨️ Delayed & Human-Like Typing

The assistant doesn't instantly send every response.

It can simulate realistic response behavior by:

- Waiting before replying
- Randomizing response delays
- Showing "typing..." before responding
- Using longer delays occasionally
- Pausing during longer messages
- Resuming typing afterward
- Showing voice-recording presence when Voice Mode is enabled

Typing duration is influenced by response length.

---

### ✍️ Natural Typo Simulation

The assistant includes a low-frequency typo engine.

Occasionally it can:

1. Send a slightly mistyped word
2. Pause briefly
3. Correct the word

This is designed to make responses feel less robotic.

---

### 💬 Natural Message Splitting

Long private responses can occasionally be split into multiple messages with short pauses between them, rather than always sending one large block of text.

---

### 🎙️ Voice Notes

Voice Mode allows the assistant to communicate using audio messages.

#### Voice transcription

Incoming WhatsApp voice notes are:

- Downloaded
- Processed
- Transcribed using Groq Whisper

Model:

`whisper-large-v3-turbo`

#### Voice responses

When Voice Mode is enabled, AI responses can be converted into audio using:

- eSpeak
- FFmpeg

and sent as WhatsApp voice notes.

---

### 👁️ AI Vision

The assistant can analyze images sent through WhatsApp.

Powered by **OpenRouter Vision**.

It can:

- Understand images
- Describe images
- Process image captions
- Answer questions about images
- Respond in the configured AI language

---

### 🔗 Cross-Channel Memory

The assistant keeps conversations separated between:

- Private DMs
- Individual WhatsApp groups

If the same person appears in another channel, the assistant can ask whether they want the previous conversation connected.

The user can choose to:

- Link the conversation
- Keep it separate

This prevents conversations from being silently merged.

---

### 💼 Business Mode

Business Mode allows the owner to configure business information.

The assistant can reference:

- Business profile
- Products
- Services
- Pricing
- Business location

Business information is only intended to be brought up when the person explicitly asks about the business.

---

### 📍 Location Awareness

Configure a business or custom location that the assistant can reference when relevant.

---

### 📅 Daily Automatic WhatsApp Bio

The assistant can automatically update the WhatsApp About/Bio status once per day.

The status can contain:

- Current date
- Assistant status
- Owner information
- Daily system messages

---

## 👥 Group Features

### 🛡️ Automated Group Moderation

The assistant can monitor groups for unauthorized WhatsApp group links.

It can:

- Detect foreign WhatsApp group links
- Ignore the current group's own invite link
- Delete unauthorized links
- Issue warnings
- Track warnings per member
- Remove repeat offenders after 3 warnings

The bot requires the appropriate group permissions for moderation actions.

---

### 👥 Group Chat Mode

Group Chat Mode controls whether the AI responds inside groups.

When enabled, the assistant can respond when:

- Mentioned
- Tagged
- Replied to

When disabled, the AI remains silent in groups.

---

### 📢 Hidetag

### 📢 Hidetag

Mention all members of a group without displaying individual `@mentions` in the message body.

**Example:**

```text
!hidetag Attention everyone!
```

### 🟢 Online Member Detection

Check active or online members in a WhatsApp group.

**Command**

    !listonline

The assistant attempts to identify members currently showing activity in the group.

---

### 📇 Group Contact Export

Generate a `.vcf` contact file containing the group's participants.

**Command**

    !svcontact

The generated contact file can be saved to your device.

---

### 🚨 Deleted Message Detection

The assistant keeps a local message and media store.

When a message is deleted, the Termux console can report:

- Sender
- Time
- Deleted text
- Saved media location when applicable

---

### 💾 Automatic Media Handling

Incoming supported media can be downloaded locally.

Supported media includes:

- Images
- Videos
- Audio
- Stickers
- Documents
- Video notes

Voice messages can additionally be passed to the transcription system.

---

## 👑 Owner Command Suite

Owner commands can be triggered directly from WhatsApp.

---

### 🤖 Bot Control

Enable or disable the main AI auto-reply system.

**Commands**

    !bot
    !bot on
    !bot off

---

### 🎙️ Voice Mode

Enable or disable voice-note responses.

**Commands**

    !voice on
    !voice off

---

### 👥 Group Chat Mode

Control AI responses inside WhatsApp groups.

**Commands**

    !groupchat on
    !groupchat off

---

### 💼 Business Mode

Enable or disable Business Mode and configure the business profile.

**Commands**

    !business on
    !business off
    !business set

---

### 💰 Products & Pricing

Configure the products and pricing information used by Business Mode.

**Commands**

    !prices set
    !prices clear

---

### 📍 Business Location

Set or remove the configured business location.

**Commands**

    !location set
    !location clear

---

### 👑 Owner Name

Set or reset the owner's displayed name.

**Commands**

    !owner set
    !owner clear

---

### 🐍 Python / Termux Bridge

Execute configured Python commands through the Termux environment.

**Command**

    !py

---

### 🌐 Universal Language Mode

Change, view, or reset the assistant's configured language.

**Commands**

    !lang
    !lang list
    !lang reset

**Examples**

    !lang yoruba
    !lang igbo
    !lang french
    !lang japanese
    !lang pidgin

---

### 📢 Group Hidetag

Mention all group participants without displaying individual `@mentions` in the message body.

**Example**

    !hidetag Attention everyone!

---

### 🟢 Online Members

Display detected active or online group members.

**Command**

    !listonline

---

### 📇 Save Group Contacts

Generate a VCF file containing group participants.

**Command**

    !svcontact

---

## 🧠 Memory Vault

The assistant provides persistent memory features for contacts and conversations.

---

### 🧠 View Memories

View tracked contacts and their stored information.

**Command**

    !memories

---

### 📝 Remember Contact

Save information about a contact.

**Command**

    !remember

**Example**

    !remember 2348012345678 John | John's classmate

---

### 📜 Chat History

View recent conversation history stored for a contact.

**Command**

    !history

---

### 🧹 Wipe Memory

Clear saved contacts, group memory, and conversation history.

**Command**

    !wipe

---

## 📊 System Status

View information about the assistant and its current system state.

**Commands**

    !status
    !sys

The status information can include:

- Bot uptime
- RAM usage
- Saved contacts
- Bot status
- Voice Mode
- Group Chat Mode
- Business Mode
- Current language
- Assistant mood
- Nigeria time
- Daily bio update status

---

## 📋 Command Reference

| Command | Function |
|---|---|
| `!bot` | Enable or disable AI auto-replies |
| `!voice` | Enable or disable Voice Mode |
| `!groupchat` | Enable or disable group AI |
| `!business` | Manage Business Mode |
| `!prices` | Manage products and pricing |
| `!location` | Manage business location |
| `!owner` | Manage owner name |
| `!py` | Execute configured Python commands through Termux |
| `!lang` | Change assistant language |
| `!hidetag` | Mention all group members |
| `!listonline` | Detect active group members |
| `!svcontact` | Export group contacts |
| `!memories` | View Memory Vault |
| `!remember` | Save contact information |
| `!history` | View contact history |
| `!wipe` | Clear stored memory |
| `!status` / `!sys` | View system status |

---

## ⚙️ Installation

### 1. Install Termux Dependencies

Update and upgrade Termux packages.

    pkg update && pkg upgrade -y

Install the required dependencies.

    pkg install nodejs git python ffmpeg espeak zip -y

---

### 2. Enter the Project Directory

    cd ~/ai-assistant

---

### 3. Install Node.js Dependencies

    npm install

---

## 🔑 API Configuration

The assistant uses external AI services for:

- Text generation
- Voice transcription
- Vision and image analysis

Configure your own API keys securely.

**Example**

    const GROQ_API_KEY = "YOUR_GROQ_API_KEY";
    const OPENROUTER_API_KEY = "YOUR_OPENROUTER_API_KEY";

### Groq

Used for:

- AI text generation
- Whisper voice transcription

### OpenRouter

Used for:

- Vision
- Image analysis

---

## 🚀 Running the Bot

Start the assistant with:

    node index.js

On the first launch, the bot asks for your WhatsApp phone number and generates a pairing code.

Then open:

**WhatsApp → Linked Devices → Link with phone number**

Enter the generated pairing code.

---

## ☁️ Deployment

The assistant can also be deployed on compatible Node.js hosting platforms such as **Pterodactyl**.

### Startup Command

    node index.js

Make sure the hosting environment supports the required dependencies, especially:

- Node.js
- FFmpeg
- eSpeak

---
## 🛠️ Built With

- Node.js
- Baileys
- Termux
- Groq
- OpenRouter
- Llama / Groq AI
- Whisper
- FFmpeg
- eSpeak

---

## 🔐 Security

Never commit the following to a public repository:

- API keys
- WhatsApp authentication/session files
- Private credentials
- Personal configuration files

Use environment variables or a private configuration file instead.
