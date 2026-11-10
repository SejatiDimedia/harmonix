# Harmonix Design System & Style Direction

> **Product**: Harmonix — Autonomous Enterprise AI Data Analyst Agent  
> **Aesthetic Mood**: Executive, Deterministic, Focused, High-Signal, Calm Dark  
> **Antislop Dials**: **ENERGY 2** / **RHYTHM 2** / **MOTION 1**  
> **Governing Standards**: WCAG 2.1 AA Accessibility, Antislop Craftsmanship Standard (C-1 to C-5)

---

## 1. Identity & Visual Philosophy

Harmonix is an autonomous enterprise analytics engine designed for data teams, business analysts, and executives. It prioritizes **clarity over decoration**, **evidence over claims**, and **deterministic speed over flashy AI gimmicks**.

- **No Generic AI Slop**: No rainbow mesh gradients, floating neon orbs, fake terminal windows, decorative sparkle emojis, or ungrounded claims.
- **Executive Dark Baseline**: Optimized for long multi-screen monitoring, high-contrast chart legibility, and low eye fatigue.
- **Unified Capsules over "Box Soup"**: Controls sharing a common functional purpose (e.g. refresh + interval, view modes, window controls) are grouped into single cohesive capsules with subtle dividers rather than isolated adjacent boxes.

---

## 2. Color Palette & Token System

### 2.1 Canvas & Surfaces
| Token Name | Hex Code | Tailwind / CSS Variable | Usage |
|:---|:---|:---|:---|
| **Canvas Deep** | `#080f1d` | `bg-[#080f1d]` | Base app background, body background |
| **Nav / Header** | `#0b1424` | `bg-[#0b1424]` | Persistent sticky navbar, TV command center header |
| **Panel Surface** | `#0f1a2e` | `bg-[#0f1a2e]` | Main content cards, dashboard canvas container |
| **Elevated Surface** | `#14223b` | `bg-[#14223b]` | Interactive capsules, model popovers, active items |
| **Hover Surface** | `#1a2d4e` | `bg-[#1a2d4e]` | Hover states on interactive cards and buttons |
| **Default Border** | `rgba(255,255,255,0.06)` | `border-white/[0.06]` | Subtle structural panel borders |
| **Stronger Border** | `rgba(255,255,255,0.10)` | `border-white/[0.10]` | Focus rings, popover menus, active capsules |

### 2.2 Brand & Interactive Actions
| Token Name | Hex Code | Tailwind Token | Usage |
|:---|:---|:---|:---|
| **Primary Brand** | `#0277bd` | `clay-600` | Primary submit button (`Enter`), primary CTA |
| **Primary Hover** | `#0284c7` | `clay-500` | Hover state for primary action buttons |
| **Vibrant Accent** | `#38bdf8` | `sky-400` / `clay-400` | Active icons, loading spinners, focus visible outline |
| **Light Accent** | `#7dd3fc` | `sky-300` / `clay-300` | Inline code text, high-contrast links, active tags |
| **Deep Accent Glow** | `#0c4a6e` | `clay-900` | Subtle background tint behind active pill badges |

### 2.3 Semantic Status Colors & Borderless Badges
| State | Text & Icon | Background (Borderless) | Usage |
|:---|:---|:---|:---|
| **Success / Safe** | `#34d399` (`emerald-400` / `emerald-300`) | `bg-emerald-500/15` | Read-only verification, healthy DB, normal watchdog status |
| **Warning / Notice** | `#fbbf24` (`amber-400` / `amber-300`) | `bg-amber-500/15` | Degraded health, human approval required, pending rules |
| **Danger / Destructive** | `#f87171` (`rose-400` / `rose-300`) | `bg-rose-500/20` | Delete session, anomaly alert triggered, error log banner |
| **Info / Engine** | `#38bdf8` (`sky-400` / `sky-300`) | `bg-sky-500/15` | Model badge, orchestrator status, diagnostic capsule |

### 2.4 Typography Hierarchy
- **Brand Wordmark**: `Plus Jakarta Sans` (`font-sans font-bold tracking-tight text-slate-100`) — identitas resmi kata "Harmonix".
- **UI & Body Typeface**: `Plus Jakarta Sans`, system-ui, -apple-system, sans-serif (`font-sans`) — untuk teks antarmuka, tabel, form, dan kartu.
- **Mono Numeric Figures**: `Plus Jakarta Sans` with `font-mono` tracking for alignment in metrics, timestamps, and row counts
- **Focus Indicator**: `outline: 2px solid #38bdf8 !important; outline-offset: 2px !important;` (WCAG 2.1 AA SC 2.4.7)

---

## 3. Core Component Standards

### 3.1 Buttons
1. **Primary Button**: `bg-clay-600 hover:bg-clay-500 text-white font-sans font-medium rounded-xl shadow-sm transition active:scale-95`
2. **Secondary Button**: `bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 rounded-xl transition`
3. **Subtle / Ghost Button**: `bg-transparent hover:bg-[#14223b] text-slate-400 hover:text-white rounded-xl transition`
4. **Destructive Button**: `bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 font-sans font-medium rounded-xl transition` (Borderless — tanpa border kaku)
5. **Segmented TV Capsule**: `bg-[#14223b]/90 border border-white/[0.08] rounded-lg p-0.5 text-xs flex items-center`

### 3.2 Cards
1. **Container Card**: `bg-[#0f1a2e] border border-white/[0.06] rounded-2xl p-5 shadow-sm`
2. **Executive KPI Card**: `kpi-summary-card` (`bg-[#0f172a] border border-white/[0.08] rounded-xl p-4 hover:border-sky-400/30`)
3. **Interactive Widget**: Title bar with actions + Chart/Table body + footer indicators

### 3.3 Modals & Overlays
- **Backdrop**: `fixed inset-0 bg-black/60 backdrop-blur-sm z-50`
- **Container**: `bg-[#0f1b2d] border border-white/[0.08] rounded-2xl shadow-2xl p-6` (Tidak menggunakan border warna merah/kuning pada modal)
- **Dismissal**: Closes via top-right `X` button, backdrop click, or `Escape` key

### 3.4 Mandatory UI States (Antislop R-27)
Every data display component **MUST** implement:
- **Empty State**: Clear reason why it is empty + single primary call-to-action.
- **Loading State**: Contextual message explaining what is being fetched, with an accessible spinner or structured skeleton.
- **Error State**: Non-cryptic explanation of what failed + a clear Retry button.

### 3.5 Borderless Semantic Elements Principle (Anti-Wireframe)
Semua status badges, pill indicators, destructive buttons, dan diagnostic boxes menggunakan gaya **borderless**:
- **Tanpa border berwarna**: Dilarang menggunakan border kaku berwarna (seperti `border-rose-500/30`, `border-emerald-500/20`, dsb.) karena memicu kelelahan visual (*wireframe fatigue*) dan kesan desain AI slop yang murah (*box soup*).
- **Background Tinting**: Menggunakan saturasi latar belakang lembut `15% - 20%` (`bg-rose-500/20`, `bg-emerald-500/15`, `bg-sky-500/20`) dipadukan dengan tipografi berbobot medium berkontras tinggi (`text-rose-300`, `text-emerald-300`, `text-sky-300`).
- **Border Khusus Pembatas Struktur Netral**: Border hanya dipakai untuk mendefinisikan pembungkus kartu / modal secara netral (`border-white/[0.06]` s.d. `border-white/[0.08]`).

