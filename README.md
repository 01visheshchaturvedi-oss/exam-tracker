# ExamRigor — Personal Study OS

An intensive exam preparation tracker with real-time task timers, performance benchmarks, daily goals, study analytics, and negative reinforcement reminders.

## Features
- ⏱ **Task Timer** with Pause/Resume and session recovery across tab restarts
- 📊 **Analytics** — 7-day trend, 30-day history, subject distribution pie chart
- 🏆 **Benchmarks** — tracks best and last session times per task
- 🎯 **Daily Goal** — set a study hours target with live completion estimate
- 🔔 **Reminders** — per-task daily alarms using Web Audio API
- 🌓 **Light/Dark theme** toggle
- 💾 All data stored locally in your browser (no server, no sign-in)

## Prerequisites
- [Node.js](https://nodejs.org) (v18+)

## Run Locally

1. Install dependencies:
   ```
   npm install
   ```

2. Start the dev server:
   ```
   npm run dev
   ```

3. Open [http://localhost:3002](http://localhost:3002) in your browser.

> **Quick Launch:** Double-click `start-examrigor.bat` to start the server and open the browser automatically.

## No API Keys Required
This app is 100% client-side. All data is persisted in `localStorage`. No backend, no sign-in, no API keys needed.
