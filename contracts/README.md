# Protocol contracts

The server-side Pydantic models are the protocol source of truth. Running
`pnpm contracts:generate` exports their JSON Schema here and regenerates the
TypeScript declarations consumed by the web client.

Generated contracts are committed so protocol changes remain reviewable. CI
regenerates them and fails when the working tree changes.

