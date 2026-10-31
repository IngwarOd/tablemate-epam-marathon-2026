# Tablemate on ChatGPT Sites

Cloudflare Worker adapter for the Tablemate EPAM marathon project. It serves the same Ukrainian UI and REST API as the standalone Node.js app in `../../tablemate/`.

Each group is a JSON object in the Sites R2 bucket. Updates use ETag conditions so concurrent changes cannot silently overwrite one another; conflicting requests return HTTP 409. Owner, guest and kitchen credentials are stored only as SHA-256 hashes. The invitation code grants guest entry, while the separate kitchen credential grants read-only access to the ticket.

`public/`, `menu.json`, and `worker/core.js` are synchronized copies of the standalone app. After changing the standalone app, copy these files here before building. `npm run build` embeds text assets into one Worker ESM file in `dist/server/index.js`. No npm dependencies are needed.

```powershell
npm run build
npm run validate
node --test test/worker.test.js
```

The deployed Site uses the project ID and R2 binding declared in `.openai/hosting.json`. This repository contains no group data or access tokens.
