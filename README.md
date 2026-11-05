# DineOvo POS

Modern POS and restaurant operations platform built with Electron, React, Vite, Tailwind CSS, and local SQLite offline sync.

> **Notice:** Database schemas and SQL migration scripts are intentionally **not included** in this codebase repository.

---

## Features
- **Point of Sale (POS) & KDS:** Fast order creation, live kitchen display system, split payments, and customer management.
- **Thermal KOT & Bill Printing:** Automated 58mm ESC/POS thermal printing with margins and batch separation.
- **Offline-First Architecture:** Local SQLite mirroring for high-reliability offline trade with background cloud synchronization.
- **Revenue & Analytics:** Date-range financial summaries, day-wise aggregation, and CSV export.
- **Digital Menu & QR Ordering:** Customer-facing portal (`Cielo Cafe`).

---

## Setup & Running Locally

### 1. Install Dependencies
```bash
npm install
```

### 2. Run in Development Mode
```bash
# Web Dev Server
npm run dev

# Electron Desktop App Dev Server
npm run electron:dev
```

### 3. Build for Production
```bash
npm run build
npm run electron:build
```
