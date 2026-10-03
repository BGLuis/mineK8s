# mineK8s web

Angular 22 SPA (standalone, signals, zoneless) for the control plane in `services/control-plane`.
The contract lives in `docs/design/UI-SPEC.md`; the API inventory in `docs/reports/PESQUISA-DESIGN-UI.md`.

## Run

```bash
npm install
npm start                      # http://localhost:4200, proxies to the control plane on :3000
npm run build                  # production build in dist/web
npm test -- --watch=false      # Vitest
```

`proxy.conf.json` forwards `/api`, `/socket.io`, `/ws` and `/terminal` to `http://localhost:3000`
(WebSocket enabled). `/join` is an SPA route and is not proxied.

`/dev/ui` (development builds only, not linked in the navigation) shows every UI component and state.

## Layout

```
src/
  styles.css            Tailwind entry; imports styles/
  styles/tokens.css     the ONLY place with hex colours: tokens, bevels, typography, focus ring
  styles/table.css      dense table styles (`table[mc-table]`)
  app/
    ui/                 design system, one folder per component, exported from ui/index.ts
    core/api/           models.ts (typed from the backend), ApiClient, one service per backend area, MockApi
    core/auth/          TokenStore, AuthSession, authInterceptor, authGuard / adminGuard
    core/realtime/      TerminalSocket (/terminal), TasksSocket (/ws/tasks)
    shell/              authenticated layout (sidebar + main + legal footer)
    features/<name>/    one folder per screen; screens only edit inside their own folder
    dev/                ui-gallery
```

## Rules

- **Tokens only.** No hex colours outside `styles/tokens.css`. Use the Tailwind classes generated
  from the tokens (`bg-surface-default`, `text-status-success`, `border-border-focus`) or the
  `.bevel-*`, `.t-*` utility classes. Class names must appear literally in source (no
  `bg-${x}` string building) or Tailwind will not emit them.
- Radius is always 0. Spacing follows the 4 px grid. Components that cast the 8 px drop shadow
  reserve its space with `has-drop`.
- **Pixel fonts (Tiny5, VT323) never go in tables, long logs or form values.** Use Inter there.
  VT323 is only for the console. Pixel fonts have ligatures disabled.
- **Real vs mock API.** Everything under `core/api/*.api.ts` calls an endpoint that exists in the
  control plane. Features without an endpoint (design report section 2.6) come from `MockApi`,
  each method names the missing endpoint, and the screen must render `<mc-no-api-tag>` next to
  that data. Never add an `ApiClient` call to an endpoint that does not exist.
- UI strings are pt-BR with accents; identifiers and comments are English.
- Every interactive element needs a visible focus state (global 2 px gold ring) and a touch target
  of at least 40 px.
- Realtime sockets pause on `document.visibilitychange` (RF-ARQ-27); the terminal limits the
  client to 5 commands per second.
