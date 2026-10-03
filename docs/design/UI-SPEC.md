# UI spec — mineK8s SPA

Implementation contract for the web SPA, derived from the Figma file `Minek8s`
(`mEfdKjgf5oCEHNejmZ8qtp`) and from `docs/reports/PESQUISA-DESIGN-UI.md`.
Visual source of truth: Figma pages **Design System** (`99:1601`) and **Telas** (`99:1602`).

## Stack

- Angular 22 (standalone components, signals, new control flow, zoneless where the CLI default allows), TypeScript strict.
- Tailwind CSS 4 with design tokens exposed as CSS custom properties (below). No component library.
- `socket.io-client` 4.8 for realtime. Vitest for unit tests (CLI default).
- Lives in `services/web`. Dev server proxies `/api`, `/socket.io`, `/join` to `http://localhost:3000` (control plane).
- UI strings in pt-BR; code identifiers in English.

## Tokens (CSS custom properties)

Primitives (hex) → semantic tokens. Use semantic tokens in components.

| Semantic | Value |
|---|---|
| `--color-bg-canvas` | `#1E1E1E` |
| `--color-bg-sunken` | `#141210` |
| `--color-surface-default` | `#3E3937` |
| `--color-surface-hover` | `#514D4B` |
| `--color-surface-input` | `#282828` |
| `--color-surface-overlay` | `#000000` (used at 70 % opacity) |
| `--color-border-strong` | `#141210` |
| `--color-border-default` | `#66615F` |
| `--color-border-focus` | `#F5CF5D` |
| `--color-text-primary` | `#FFFFFF` |
| `--color-text-muted` | `#B5B0AE` |
| `--color-text-disabled` | `#8A8582` |
| `--color-text-inverse` | `#000000` |
| `--color-action-neutral` | `#3E3937` |
| `--color-action-light` | `#CEC1C1` |
| `--color-action-primary` | `#477A4E` |
| `--color-action-danger` | `#A63D2B` |
| `--color-action-info` | `#4C6CC9` |
| `--color-action-warning` | `#F5CF5D` |
| `--color-action-accent` | `#A93AA6` |
| `--color-status-success` | `#7CC383` |
| `--color-status-warning` | `#F5CF5D` |
| `--color-status-danger` | `#F59A8F` |
| `--color-status-info` | `#8FA8F0` |
| `--color-status-accent` | `#D98FD6` |
| `--color-status-neutral` | `#B5B0AE` |
| `--color-scene-sky` / `-sky-light` | `#5B7FD6` / `#8FB0EE` |
| `--color-scene-grass` / `-grass-dark` | `#558C47` / `#3F6B35` |
| `--color-scene-dirt` / `-dirt-dark` | `#9A6A43` / `#7A5236` |

Spacing: 4 px grid (`4, 8, 12, 16, 24, 32, 48`). Border radius: **always 0**.

### Bevels (box-shadow, no blur)

Each "block" = 2 px outer border `--color-border-strong` + inset highlight/shade + hard drop shadow.
Pattern: `box-shadow: inset 4px 4px 0 <hi>, inset -4px -4px 0 <lo>, 0 8px 0 <drop>;`

| Style | hi (top-left) | lo (bottom-right) | drop |
|---|---|---|---|
| neutral | `#66615F` | `#514D4B` | `#252525` |
| light | `#AFA5A1` | `#C0B2AC` | `#6D6D6D` |
| primary | `#68926E` | `#58865E` | `#27432B` |
| danger | `#B66051` | `#AE4E3E` | `#5B2218` |
| info | `#6C86D3` | `#5C79CE` | `#2A3B6F` |
| warning | `#D4B760` | `#C5AA5A` | `#7A6A3E` |
| accent | `#B85DB6` | `#B14CAE` | `#5D205B` |
| panel | `#514D4B` | `#36322F` | `#141210` |
| sunken (inputs, wells) | inset `4px 4px 0 #141210`, inset `-4px -4px 0 #3A3634`, no drop |
| pressed (`:active`, disabled) | inset `4px 4px 0 #1E1E1E`, no drop |

Pressed buttons translate down 4 px and lose the drop shadow. A highlighted border (selected/active)
must **not** be combined with inset bevels: the inset covers the border.

## Typography

| Style | Font | Size / line-height |
|---|---|---|
| `display-xl` | Tiny5 | 48 / 56 |
| `display-lg` | Tiny5 | 32 / 40 |
| `title-md` | Tiny5 | 24 / 32 |
| `title-sm` | Tiny5 | 20 / 28 |
| `button-md` / `button-sm` | Tiny5 | 20 / 24 · 16 / 20 |
| `label-md` | Tiny5 | 16 / 24 |
| `body-lg` / `body-md` | Inter 400 | 16 / 24 · 14 / 20 |
| `body-strong` | Inter 600 | 14 / 20 |
| `caption` | Inter 500 | 12 / 16, letter-spacing 0.2 px |
| `mono-console` / `mono-sm` | VT323 | 20 / 24 · 18 / 20 |

Fonts are self-hosted via `@fontsource/tiny5`, `@fontsource/vt323`, `@fontsource-variable/inter`
(no Google Fonts CDN: the control plane serves Helmet's default CSP). Pixel fonts get
`font-variant-ligatures: none` and `-webkit-font-smoothing: none`. Never use pixel fonts in tables,
long logs or form values. VT323 lacks `▶`; use `>`.

## Components (Figma Design System page → Angular)

| Figma | Angular selector | API |
|---|---|---|
| Button `99:2144` | `mc-button` | `variant`: neutral·light·primary·danger·info·warning·accent; `size`: md(56px)·sm(40px); `disabled`; optional leading icon. Light & warning use inverse text. |
| StatusChip `99:2172` | `mc-status-chip` | `state`: ServerState \| 'MAINTENANCE'. Labels: PROVISIONANDO, INICIANDO, ONLINE, PARANDO, HIBERNANDO (=STOPPED), ATUALIZANDO, TRAVOU (CRASHED), FALHOU, MANUTENÇÃO. Square dot + text + 2 px border in status color. STARTING/STOPPING/UPDATING dot blinks (respect `prefers-reduced-motion`). |
| Tag/SemAPI `99:2173` | `mc-no-api-tag` | dashed warning border, caption "SEM API · …". Rendered next to every element backed by `MockApi`. |
| TextField `99:2259` | `mc-text-field` | label (Tiny5), value (Inter), help/error text, states default·focus(4px gold border)·error·disabled; works with Angular forms (ControlValueAccessor). |
| Panel `99:2260` | `mc-panel` | title + content slot, bevel panel. |
| Meter `100:1547` | `mc-meter` | 10 blocks of 18 px; level by %: <75 success, 75–89 warning, ≥90 danger; label + numeric value always shown. |
| ProgressBar `100:1593` | `mc-progress` | XP-bar, 10 segments; tone xp·info·danger; step text + percent. |
| Slider/RAM `100:1594` | `mc-ram-slider` | 1024–65536 MB; shows "heap + 1,5 GiB = container" (C-17). |
| NavItem `100:1755` / Sidebar `102:4226` | `mc-sidebar` | brand cube + "mineK8s", items Dashboard · Criar servidor · Convidados e acesso · Saúde do sistema; active = gold left bar + gold icon; Tailscale quota box; user (avatar, nick, role). |
| Tab `100:1761` | `mc-tabs` | Active tab: surface fill + 4 px green top bar. |
| Banner `100:1777` | `mc-banner` | tone warning·danger·info; 8 px left border. |
| TableCell `100:1784` | `mc-table` styles | dense Inter table, caption-uppercase header, 2 px row separators. |
| Toast `100:1797` | `mc-toast` + `ToastService` | bottom-right, 4–6 s, danger sticky. |
| StepperItem `100:1810` | `mc-stepper` | done (green ✓) · current (gold) · upcoming (sunken). |
| ConsolePanel `102:1648` | `mc-console` | toolbar (Logs/RCON segmented, level filters), VT323 output colored by level, prompt `>` + input + Enviar; ↑/↓ history. |
| Modal `102:1745` | `mc-dialog` | overlay 70 % black, 4 px border, destructive action right, focus starts on Cancel, Esc closes. |
| VoxelScene `102:1799` | `mc-voxel-scene` | inline SVG of 16 px blocks (sky, sun, clouds, stepped grass/dirt hills, 3 trees) using scene tokens; `shape-rendering: crispEdges`; scales to container. |
| ServerCard `102:2954` | `mc-server-card` | cover scene + status chip, name, subdomain, players/version/RAM, primary action by state (READY→Parar danger, STOPPED→Ligar primary, STARTING→disabled, CRASHED→Reiniciar warning) + "Abrir". |
| ModpackCard `102:4077` | `mc-modpack-card` | cover, name, author·source, summary, date/MC version/loader/downloads; selected = 4 px gold border without inset bevel. |
| StatTile `103:3558` | `mc-stat-tile` | panel + meter + detail + optional no-api tag. |
| ChoiceTile `107:9097` | `mc-choice-tile` | selectable block (radio semantics). |
| Icons `9:2212` | `mc-icon` | 32 px pixel icons exported as SVG from Figma (use the Figma MCP `get_design_context`/`download_assets` or redraw on a 16×16 grid), `currentColor`, names: grid, list, play, chevron(+down/left/up), more, edit, trash, time, pickaxe, sword, character, square, stats, LAN, settings, eye, eye-off, power, power-off, world, plant, hook. |

Every interactive element has a visible keyboard focus (2 px gold outline offset 2 px). Touch
targets ≥ 40 px. Legal footer on every screen: "Não é um produto oficial do Minecraft. Não aprovado
nem associado à Mojang ou à Microsoft."

## Screens (Figma Telas page)

| # | Route | Figma frame |
|---|---|---|
| 01 Login | `/login` | `110:11020` |
| 02 Dashboard | `/` | `103:1502` (mobile `112:11705`) |
| 03 Server details | `/servers/:id` (tab Visão geral) | `104:4485` |
| 04 Console | `/servers/:id/console` | `105:6236` |
| 05 Create wizard | `/servers/new` | `107:9098`, provisioning `107:11362` |
| 06 Guests & access | `/access` | `108:10256` |
| 07 Files | `/servers/:id/files` | `105:6694` |
| 08 Backups | `/servers/:id/backups` | `105:7152`, restore modal `107:6691` |
| 09 Publish modal | dialog from details | `107:6872` |
| 10 System health | `/health` | `110:10559` |
| 11 Join portal | `/join?token=` (public, no sidebar) | `110:11366`, mobile success `110:11543` |

Responsive: below 768 px the sidebar becomes a bottom tab bar (Mundos · Criar · Acesso · Saúde)
and a top bar (cube + name + avatar), as in `112:11705`.

## Data

API inventory and DTO shapes: `docs/reports/PESQUISA-DESIGN-UI.md` §1 and §2.5, plus the
control-plane source under `services/control-plane/src` (controllers and `dto/` folders are the
source of truth). Features without an endpoint (§2.6) read from `MockApi` and render
`mc-no-api-tag`. Never fake a call to a non-existent endpoint through `ApiClient`.
