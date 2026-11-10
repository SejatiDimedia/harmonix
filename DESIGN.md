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

### 2.3 Semantic Status Colors
| State | Text & Icon | Background & Border | Usage |
|:---|:---|:---|:---|
| **Success / Safe** | `#34d399` (`emerald-400`) | `bg-emerald-950/40 border-emerald-800/40` | Read-only verification, healthy DB, completed jobs |
| **Warning / Notice** | `#fbbf24` (`amber-400`) | `bg-amber-950/40 border-amber-800/40` | Degraded health, human approval required |
| **Danger / Destructive** | `#f87171` (`rose-400`) | `bg-rose-950/40 border-rose-800/40` | Delete session, abort stream, error toasts |
| **Info / Engine** | `#38bdf8` (`sky-400`) | `bg-sky-950/60 border-sky-800/60` | Model badge, orchestrator status |

### 2.4 Typography Hierarchy
- **Typeface**: `Plus Jakarta Sans`, system-ui, -apple-system, sans-serif
- **Mono Numeric Figures**: `Plus Jakarta Sans` with `font-mono` tracking for alignment in metrics, timestamps, and row counts
- **Focus Indicator**: `outline: 2px solid #38bdf8 !important; outline-offset: 2px !important;` (WCAG 2.1 AA SC 2.4.7)

---

## 3. Core Component Standards

### 3.1 Buttons
1. **Primary Button**: `bg-clay-600 hover:bg-clay-500 text-white font-sans font-medium rounded-xl shadow-sm transition active:scale-95`
2. **Secondary Button**: `bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 rounded-xl transition`
3. **Subtle / Ghost Button**: `bg-transparent hover:bg-[#14223b] text-slate-400 hover:text-white rounded-xl transition border border-transparent hover:border-slate-800/80`
4. **Destructive Button**: `bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border border-rose-800/40 rounded-xl transition`
5. **Segmented TV Capsule**: `bg-[#14223b]/90 border border-white/[0.08] rounded-lg p-0.5 text-xs flex items-center`

### 3.2 Cards
1. **Container Card**: `bg-[#0f1a2e] border border-white/[0.06] rounded-2xl p-5 shadow-sm`
2. **Executive KPI Card**: `kpi-summary-card` (`bg-[#0f172a] border border-white/[0.08] rounded-xl p-4 hover:border-sky-400/30`)
3. **Interactive Widget**: Title bar with actions + Chart/Table body + footer indicators

### 3.3 Modals & Overlays
- **Backdrop**: `fixed inset-0 bg-black/60 backdrop-blur-sm z-50`
- **Container**: `bg-[#0f1b2d] border border-white/[0.10] rounded-2xl shadow-2xl p-6`
- **Dismissal**: Closes via top-right `X` button, backdrop click, or `Escape` key

### 3.4 Mandatory UI States (Antislop R-27)
Every data display component **MUST** implement:
- **Empty State**: Clear reason why it is empty + single primary call-to-action.
- **Loading State**: Contextual message explaining what is being fetched, with an accessible spinner or structured skeleton.
- **Error State**: Non-cryptic explanation of what failed + a clear Retry button.

