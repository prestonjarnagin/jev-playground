# Jev bench

A small playground for TypeSafe's [Jev](https://docs.typesafe.ai/introduction) model, served at https://jev.prestonj.com.

TypeSafe's own API is invite-only, but Cloudflare Workers AI hosts the same model as `typesafe/jev`. This Worker wraps that binding so you can build Noul, Choice, and Score questions, see the exact input sent to the model, and read the answers with latency, token, and cost stats.

## How it works

- `public/` is static assets: a no-build ES module front end. `builder.js` turns the form into the Jev input and is unit tested.
- `src/index.ts` handles `POST /api/run`, forwards the body to `env.AI.run("typesafe/jev", input)`, and returns `{ result, stats }`.
- Cost is an estimate from `JEV_USD_PER_MILLION_INPUT_TOKENS` / `JEV_USD_PER_MILLION_OUTPUT_TOKENS` in `wrangler.jsonc`. Check them against the price shown for Jev in the Cloudflare dashboard (AI → Models → Jev).
- Access is gated by a Cloudflare Access application on `jev.prestonj.com`. The `workers.dev` and preview URLs are turned off so nothing bypasses it.

## Commands

```bash
npm install
npm test           # builder + worker unit tests
npm run typecheck
npm run dev        # needs `npx wrangler login`; the AI binding always runs remotely and bills
npm run deploy
```

Run `npm run types` after changing bindings or vars in `wrangler.jsonc`.
