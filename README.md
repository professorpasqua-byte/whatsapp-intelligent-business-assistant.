# WhatsApp AI Assistant & Moderation Bot

> A powerful, feature-rich WhatsApp personal assistant and group moderation bot built with **Node.js, Baileys, and Termux**.

## 🧪 Test the Assistant

To witness this project functioning, message **[+2348137031314](https://wa.me/2348137031314)** to test the assistant before deploying it.

---

## 🤖 Overview

This WhatsApp AI Assistant acts as an autonomous assistant for managing chats with advanced AI capabilities. It supports memory, voice processing, image analysis, business awareness, and automated group moderation.

---

## ✨ Features & Capabilities

### 🧠 Smart Contact & Chat Memory Vault

Automatically tracks every person who messages you.

- Stores their push names
- Records conversation history (up to the last 10 messages)
- Saves custom notes and relationship context
- Maintains contact information in the memory vault

### 🤖 Groq AI Text Assistant

Powered by **Llama 3.1 8B Instant** for fast, natural, context-aware conversations.

- Understands conversational context
- Adapts to user emotions
- Supports casual conversations
- Maintains defined assistant boundaries

### 👁️ OpenRouter Vision Integration

Analyzes and describes images sent to you in private chats.

- Image understanding
- Image descriptions
- Vision model integration
- Responds when an image is captioned or specifically requested

### 🎙️ Voice Note Transcription & Generation

Automatically processes incoming WhatsApp voice messages.

- Transcribes voice messages using **Groq Whisper**
- Uses `whisper-large-v3-turbo`
- Supports AI-generated voice responses
- Uses **eSpeak** and **FFmpeg** for voice generation

### 💼 Business & Location Awareness

Enable business mode to allow the assistant to reference your configured business information.

- Business profile
- Products and services
- Pricing information
- Business location
- Information is referenced when a contact explicitly asks about it

### 🛡️ Automated Group Moderation

Helps keep WhatsApp groups clean and controlled.

- Detects unauthorized external links
- Detects `chat.whatsapp.com` links
- Detects general web links
- Automatically deletes detected links
- Issues warnings
- Supports a 3-strike system
- Can remove repeat link-spammers when granted the required admin permissions

### 🚨 Deleted Message Detector

Locally logs messages and media so deleted content can be detected through the Termux console.

### 👑 Remote Owner Command Suite

Control the assistant directly from WhatsApp without constantly returning to Termux.

Commands can be triggered using the configured command prefix.

---

# 📋 Complete Command List

| Command | Usage / Example | Description |
|---|---|---|
| `!bot` | `!bot on` / `!bot off` | Activates or deactivates the master auto-reply system. |
| `!voice` | `!voice on` / `!voice off` | Toggles voice responses. |
| `!business` | `!business on` / `!business set` | Manages the business profile and awareness system. |
| `!prices` | `!prices set` / `!prices clear` | Sets or clears product and pricing information. |
| `!location` | `!location set` / `!location clear` | Sets or clears the business location. |
| `!owner` | `!owner set` / `!owner clear` | Sets or resets the assistant's owner name. |
| `!py` | `!py print("Hello")` | Executes configured Python commands through Termux. |
| `!wipe` | `!wipe` | Completely resets saved contacts, group memory, and history. |
| `!status` | `!status` / `!sys` | Displays system status, RAM usage, uptime, and feature states. |
| `!memories` | `!memories` | Displays tracked contacts stored in the memory vault. |
| `!remember` | `!remember` | Saves a relationship note or context tag for a contact. |
| `!history` | `!history` | Retrieves recent chat history for a contact. |

---

# 📱 Termux Installation Guide

Run the assistant natively on your Android device using **Termux**.

## 1. Update Packages & Install Dependencies

Open Termux and run:

```bash
pkg update && pkg upgrade -y
pkg install nodejs git python ffmpeg espeak zip -y

Navigate to the Project
cd ~/ai-assistant


Install Node.js Dependencies
npm install

API Keys Configuration
The assistant requires API keys from Groq and OpenRouter for its AI, voice, and vision capabilities.
Add your keys to the appropriate configuration file:
const GROQ_API_KEY = "YOUR_GROQ_API_KEY_HERE";
const OPENROUTER_API_KEY = "YOUR_OPENROUTER_API_KEY_HERE";


Groq API
Used for:
Llama text generation
Whisper voice transcription
OpenRouter API
Used for:
Image and vision analysis

Running the Assistant
Running Locally in Termux
Start the assistant with:
node index.js



On the first launch, the assistant will prompt you to enter your phone number with the appropriate country code to generate a secure pairing code.
Then go to:
WhatsApp → Linked Devices → Link with phone number
and complete the pairing process.
☁️ Deploying on a Hosting Panel
The assistant can also be deployed on hosting platforms such as Pterodactyl or other Node.js hosting panels.
1. Create a Node.js Server
Create a new Node.js server instance on your hosting panel.
2. Upload the Project
Upload your project files.
Do not upload:
node_modules
Authentication/session files
Private API keys
These should be generated or configured on the server.



Built With
Node.js
Baileys
Termux
Groq
Llama 3.1
Whisper
OpenRouter
FFmpeg
eSpeak
