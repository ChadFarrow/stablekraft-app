# Pending Major Upgrades

Last reviewed: 2026-09-26

## Summary

These packages have major version updates available that require careful migration planning.

"Range" is the constraint in `package.json`; "Resolves to" is what that range installs today.
Re-check with `npm outdated` rather than trusting the numbers below — they drift within days.

| Package | Range | Resolves to | Latest | Priority |
|---------|-------|-------------|--------|----------|
| Prisma / @prisma/client | `6.19.3` / `6.19.3` (both pinned) | 6.19.3 | 7.10.0 | Medium |
| React / React DOM | `^18` | 18.3.1 | 19.3.0 | Low |
| Next.js | `^15.5.26` | 15.5.26 | 16.3.6 | Low — blocked by next-pwa (below) |
| next-pwa | `^5.6.0` | 5.6.0 | 5.6.0 (unmaintained) | Medium — webpack-only, blocks Next 16 |
| TailwindCSS | `^3.4.19` | 3.4.19 | 4.3.3 | Low |
| ESLint | `^8` | 8.57.1 | 10.x | Low — `next lint` is removed in Next 16 |
| eslint-config-next | `15.5.26` | 15.5.26 | 16.x | Low — tracks Next |
| TypeScript | `^5` | 5.9.3 | 7.0.2 | Low |
| lucide-react | `^0.294.0` | 0.294.0 | 1.48.0 | Low |
| node-fetch | `^2.7.0` | 2.7.0 | 3.3.2 | Low |

**Node is pinned at 22** (`.nvmrc`, `node:22-alpine` in the Dockerfile, CI, `engines`), moved from
Node 20 (end-of-life 2026-04-30) on 2026-09-26. **Node 22 is end-of-life 2027-04-30** — plan Node 24
before then. Whatever the version, the server's relay sockets must stay on `ws`
(`lib/nostr/node-websocket.ts`): Node's own `WebSocket` is undici's, which recurses with
nostr-tools >= 2.25.2 on a failed connect.

### Advisories left open on purpose (`npm audit`, 2026-09-26: 0 critical, 13 high — from 2 and 43)

Everything with a non-major fix was taken. What remains needs a major, and none of it runs on
the production server:

- **next-pwa → workbox-build → rollup-plugin-terser → serialize-javascript.** Build-time only.
  `npm audit`'s "fix" is next-pwa 2.0.2, a downgrade. Goes away with the next-pwa replacement.
- **prisma → @prisma/config → effect, deepmerge-ts.** The CLI, not the client. The "fix" is
  another downgrade; Prisma 7 is the real one.
- **lighthouse → puppeteer-core → @puppeteer/browsers, extract-zip.** Dev-only, local perf runs.
- **next's own nested `postcss@8.4.31`.** Build-time CSS only; clears with Next 16.

---

## Prisma 6 → 7

**Migration Guide:** https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7

### Breaking Changes
- Node.js 18.18+ required
- Removed deprecated features
- Schema changes may be required

### Upgrade Steps
```bash
npm install prisma@7 @prisma/client@7
npx prisma generate
npx prisma migrate dev
```

---

## React 18 → 19

**Migration Guide:** https://react.dev/blog/2024/04/25/react-19-upgrade-guide

### Breaking Changes
- New JSX transform required
- Removed deprecated APIs (propTypes, defaultProps on functions)
- `forwardRef` no longer needed (ref is a regular prop)
- Context as provider directly (`<Context>` instead of `<Context.Provider>`)
- Cleanup functions in refs

### Upgrade Steps
```bash
npm install react@19 react-dom@19
npm install @types/react@19 @types/react-dom@19
```

### Notes
- Wait for ecosystem compatibility (many libraries still React 18)
- Test thoroughly - behavior changes in Suspense/concurrent features

---

## Next.js 15 → 16

**Migration Guide:** https://nextjs.org/docs/app/building-your-application/upgrading/version-16

### Breaking Changes
- React 19 required
- New App Router features
- Turbopack changes

### Upgrade Steps
```bash
npm install next@16 react@19 react-dom@19
```

### Notes
- Upgrade React first
- Check middleware compatibility
- next-pwa may need updates

---

## TailwindCSS 3 → 4

**Migration Guide:** https://tailwindcss.com/docs/upgrade-guide

### Breaking Changes
- New configuration format (CSS-based instead of JS)
- PostCSS plugin changes
- Some utility class renames
- New color palette system

### Upgrade Steps
```bash
npm install tailwindcss@4
npx @tailwindcss/upgrade
```

### Notes
- Significant config rewrite required
- `tailwind.config.js` → `tailwind.config.ts` or CSS-based
- Consider waiting for ecosystem maturity

---

## ESLint 8 → 9

**Migration Guide:** https://eslint.org/docs/latest/use/migrate-to-9.0.0

### Breaking Changes
- Flat config format required (`.eslintrc` → `eslint.config.js`)
- Dropped Node.js 18.18 below support
- Removed formatters

### Upgrade Steps
```bash
npm install eslint@9 eslint-config-next@16
npx @eslint/migrate-config .eslintrc.json
```

### Notes
- Major config rewrite required
- Wait for eslint-config-next compatibility

---

## lucide-react 0.294 → 0.556

**Changelog:** https://github.com/lucide-icons/lucide/releases

### Breaking Changes
- Some icon names changed/removed
- New icon naming conventions

### Upgrade Steps
```bash
npm install lucide-react@latest
```

### Notes
- Check for renamed icons in your components
- Run build to find any broken imports

---

## node-fetch 2 → 3

**Migration Guide:** https://github.com/node-fetch/node-fetch/blob/main/docs/v3-UPGRADE-GUIDE.md

### Breaking Changes
- ESM only (no CommonJS)
- Node.js 12.20+ required
- Different import syntax

### Notes
- May not be needed - Next.js has built-in fetch
- Consider removing dependency entirely

---

## Recommended Upgrade Order

1. **lucide-react** - Low risk, just icon changes
2. **Prisma 7** - Independent of React ecosystem
3. **React 19 + Next.js 16** - Do together
4. **TailwindCSS 4** - After React/Next stable
5. **ESLint 9** - Last, after eslint-config-next updates

---

## Commands Reference

Check outdated packages:
```bash
npm outdated
```

Update within semver ranges (safe):
```bash
npm update
```

Check for vulnerabilities:
```bash
npm audit
```
