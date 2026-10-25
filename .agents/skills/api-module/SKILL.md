---
name: api-module
description: Add a new API endpoint module to packages/api-client from an OpenAPI schema. Use when adding new backend endpoints, creating API client modules, or when an openapi.yml is provided.
argument-hint: <path-to-openapi.yml>
---

Refer to the standard: @standards/frontend/ADDING_API_MODULES.md

## Steps

1. **Read the OpenAPI schema** at `$ARGUMENTS` — identify the endpoints, request/response shapes, and path parameters.
2. **Read the standard above** for naming conventions, type rules, and the module registration pattern.
3. **Determine the service and version** — the URL path prefix tells you which service directory and version namespace to use (e.g. `/v3/projects` → `labrinth/v3/`).
4. **Define types in `types.ts`** — types must match the API response 1:1. Use the OpenAPI schema as the source of truth. Do not reshape or rename fields.

   Example namespace structure:
   ```ts
   // modules/labrinth/types.ts
   export namespace Labrinth {
       export namespace MyDomain {
           export namespace v3 {
               export type Thing = {
                   id: string
                   name: string
                   created: string
                   // ... matches API response exactly
               }
               export type CreateThingRequest = {
                   name: string
               }
           }
       }
   }
   ```

5. **Create the module class** — extend `AbstractModule`, implement each endpoint as a method. Use `this.client.request()` (never `$fetch`/`fetch` directly). Use the correct HTTP verb and request options pattern from the standard.

   Example:
   ```ts
   // modules/labrinth/things/v3.ts
   import { AbstractModule } from '../../../core/abstract-module'
   import type { Labrinth } from '../types'

   export class LabrinthThingsV3Module extends AbstractModule {
       public getModuleID(): string {
           return 'labrinth_things_v3'
       }

       public async get(id: string): Promise<Labrinth.MyDomain.v3.Thing> {
           return this.client.request<Labrinth.MyDomain.v3.Thing>(`/thing/${id}`, {
               api: 'labrinth',
               version: 3,
               method: 'GET',
           })
       }

       public async create(data: Labrinth.MyDomain.v3.CreateThingRequest): Promise<Labrinth.MyDomain.v3.Thing> {
           return this.client.request<Labrinth.MyDomain.v3.Thing>(`/thing`, {
               api: 'labrinth',
               version: 3,
               method: 'POST',
               body: data,
           })
       }

       public async delete(id: string): Promise<void> {
           return this.client.request(`/thing/${id}`, {
               api: 'labrinth',
               version: 3,
               method: 'DELETE',
           })
       }
   }
   ```

   Request options:
   | Field | Values | Purpose |
   |-------|--------|---------|
   | `api` | `'labrinth'`, `'archon'`, or a full URL | Which base URL to use |
   | `version` | `2`, `3`, `'internal'`, `'modrinth/v0'`, etc. | URL version segment |
   | `method` | `'GET'`, `'POST'`, `'PUT'`, `'PATCH'`, `'DELETE'` | HTTP method |
   | `body` | object | JSON request body |
   | `params` | `Record<string, string>` | Query parameters |
   | `skipAuth` | `boolean` | Skip auth feature for this request |
   | `useNodeAuth` | `boolean` | Use node-level auth (kyros) |
   | `timeout` | `number` | Request timeout in ms |
   | `retry` | `boolean \| number` | Override retry behavior |

   For uploads, return an `UploadHandle` instead of a `Promise`:
   ```ts
   public uploadThing(id: string, file: File): UploadHandle<void> {
       return this.client.upload<void>(`/thing/${id}/file`, {
           api: 'labrinth',
           version: 3,
           file,
       })
   }
   ```

6. **Register in `MODULE_REGISTRY`** — add to `modules/index.ts`:

   ```ts
   import { LabrinthThingsV3Module } from './labrinth/things/v3'

   export const MODULE_REGISTRY = {
       // ... existing modules
       labrinth_things_v3: LabrinthThingsV3Module,
   } as const
   ```

   Naming convention is `<api>_<domain>_<version>`. This flat key gets transformed into nested access: `client.labrinth.things_v3`.

7. **Export types** — if you added to an existing namespace, types are already re-exported. If you created a new `types.ts`, add it to `modules/types.ts`:

   ```ts
   export * from './<service>/types'
   ```

8. **Verify** — check that the module compiles and the types are accessible from `@modrinth/api-client`.
