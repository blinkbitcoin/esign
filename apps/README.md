# apps/

Deployable services.

| App | What it is |
|-----|------------|
| [`api/`](api/README.md) | 🖥️ The e-sign GraphQL service (Express + Apollo + Knex/PostgreSQL) |

`make help` here fans common targets (`test`, `coverage`, `typecheck`) out to
every app; apps with a `Makefile` are discovered automatically.
