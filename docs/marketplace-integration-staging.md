# Marketplace integration staging

This deployment is separate from production and the Google-auth staging service. Both staging services use demandpoint-staging, but marketplace Chat uses only marketplace_chat_users, marketplace_chat_artisanprofiles, marketplace_chat_bookings, marketplace_chat_conversations and marketplace_chat_messages. Auth staging continues to use users and its existing indexes. It uses the existing MongoDB driver without importing Express production routes, Mongoose models, dotenv, or external integrations. It cannot boot until the database identity, scoped role, required indexes and transaction support are verified.

## Owner setup

1. In Atlas, verify the existing SCRAM user **demandpoint_staging_user** has only **readWrite@demandpoint-staging** on the intended transaction-capable cluster. The services share database-level access by owner decision. Collection isolation is enforced by the marketplace application and fixture tooling. Do not change the existing auth service or its environment.
2. Allow only the operator's IP for preparation and the new Render service's documented outbound ranges for deployment. Use an expiring operator entry where possible. If the safe network configuration requires a paid plan, stop for approval.
3. Supply the variables below through an approved secret manager or the process environment. Use the existing TLS-enabled Atlas target with explicit path /demandpoint-staging and the staging username. Reuse only its MongoDB configuration. Provision a new marketplace JWT secret and do not reuse the auth staging JWT secret. Generate an independent random signing secret. Never use either existing service's database or secrets. This entry point never loads .env.
4. From the backend checkout, run the following only with the new staging configuration. **prepare** creates the five collections and required indexes. **seed** requires those collections to be empty. To repeat a run, first stop the staging app, run **cleanup**, then run **seed**. Cleanup rejects unexpected records in the marketplace collections and only deletes records carrying the designated marketplace fixture marker. It never touches the auth users collection or its email and Google subject indexes. Every command verifies the effective role and transaction support before writing.

   ```sh
   node scripts/marketplaceStagingFixtures.js prepare
   node scripts/marketplaceStagingFixtures.js seed
   # Use only while the service is stopped.
   node scripts/marketplaceStagingFixtures.js cleanup
   ```

5. Obtain approval for a dedicated Git revision and push. Use a dedicated branch such as **staging/marketplace-chat** and keep other working changes out of that revision. Verify that neither existing Render service tracks it.
6. In Render, verify the new service name **marketplace-integration-staging** is available. Create a separate Node Web Service from the approved branch of the backend repository. Use **npm ci** for build, **npm run start:marketplace-staging** for start, and **/** for health. Disable auto-deploy for controlled tests. Use only an approved instance plan. Do not attach an existing environment group. Use a supported Node 22+ release. Verify the deployed commit and service origin in the owner dashboard before supplying any synthetic passwords or bearer tokens. Configure Atlas ingress for only the new service's outbound ranges.
7. Health must return HTTP 200 with **service: demandpoint-marketplace-integration-staging** **, database: demandpoint-staging**, and **status: ok**. The service reaches its listener only after a successful permission, index and read-only transaction check. Confirm the service's actual HTTPS origin in the dashboard before running the smoke suite. If Render assigns a different hostname, review and update the smoke runner allowlist first.

## Environment variables

| Name | Purpose |
| --- | --- |
| MARKETPLACE_STAGING_MODE | Must be exactly staging. |
| MONGO_URI | Existing staging Atlas TLS connection. Explicit demandpoint-staging path and demandpoint_staging_user username are required. |
| MARKETPLACE_STAGING_JWT_SECRET | Independent staging signing secret of at least 32 bytes. |
| PORT | Explicit process port. Render supplies it. Fixture tooling also validates the process configuration. |
| MARKETPLACE_FIXTURE_PASSWORD | Local seed and smoke runner only. A synthetic password of 16–72 bytes supplied securely. Never set it on the public service. |
| MARKETPLACE_STAGING_TEST_ORIGIN | Smoke runner only. Exact owner-verified HTTPS origin. The runner rejects redirects. |
| EXPO_PUBLIC_MARKETPLACE_STAGING_API_URL | Future Stage 1C mobile configuration. Use the approved HTTPS origin plus /api. |
| EXPO_PUBLIC_ENABLE_MARKETPLACE_CHAT | Future Stage 1C activation flag. Leave unset or false until approved. |

Keep Google, email, SMS, push, upload, payment and analytics configuration out of staging. Public mobile discovery can keep its existing API origin.

## API contract

Mounts health GET /, POST /api/auth/login, GET /api/users/me and the seven routes below under /api/messages. All except health and login require a staging bearer token. The server signs HS256 JWTs for one hour with issuer **demandpoint-marketplace-integration-staging** and audience **demandpoint-marketplace-chat-staging**. The signing secret is separate. Authorization rechecks fixture identity, verification, completed profile, role and suspension on every request. Login uses generic 401 errors, bcrypt, and process-local limits per IP and known synthetic account. Sending is limited per account. JSON bodies are limited to 12 KB. Limits are per process and restart with the service.

Login accepts { email, password } and returns { success: true, token, user }. Hydration returns the unwrapped user. User fields are _id, name, email, role, profileImage if present, profileCompleted, isVerified and isSuspended. Neither route updates login metadata, lastSeen, or notifications.

| Method | Route relative to /api/messages | Success |
| --- | --- | --- |
| GET | /conversations | { success, conversations, totalUnread }. Newest activity first. Search remains local. |
| GET | /conversations/:id | { success, conversation }. |
| GET | /conversations/:id/messages | { success, messages, pagination: { page, limit, total, pages, hasMore, nextCursor } }. |
| POST | /conversations/:id/messages | { success, message, replayed }. First successful send returns 201. Exact replay returns 200. |
| PATCH | /conversations/:id/read | { success, conversation, totalUnread }. Optional body { throughMessageId }. |
| GET | /unread-count | { success, unreadCount }. Counts unread recipient message records. |
| POST | /bookings/:id/conversation | { success, conversation }. Existing and newly created threads return 200. |

Conversation exposes _id, booking, client, artisan, status, lastMessage, lastMessageAt, updatedAt, clientUnreadCount and artisanUnreadCount. Booking is null or {_id, service, date, time, status}. Participants are null or {_id, name, role, profileImage?}. Message fields are _id, conversation, booking, sender, recipient, type, text, read, readAt, createdAt and optional clientMutationId. Staging sends are text only. The existing production attachment contract is unaffected.

Send { text, clientMutationId? }. Whitespace is trimmed and the maximum length is 2,000 characters. Mutation IDs are 1–80 ASCII letters, digits, underscores or hyphens. Send a fresh identifier per intended message and reuse it for retries of the same trimmed text. A reused identifier with different text returns 409 MUTATION_CONFLICT. The replay envelope returns the same persisted message ID. A replay can reflect its current read state. Client mutation IDs remain scoped to the conversation and sender. The message, last-message fields, unread count, and single latest staging-notification record on the conversation commit together. There are no delivery calls. Existing website sends can omit the mutation ID and still receive 201, but omit it only if replay safety is unnecessary.

Use limit=30 for the first history request. Pass the returned nextCursor as before for older history. Keep the limit constant. Never mix page and before. Cursor pages use page: null. Numbered pages still work and are offset-based. Responses are chronological within each page. Ordering uses createdAt and _id, including for equal timestamps. A read request should send the ID of the newest message actually seen. A legacy no-body read captures the current last message once and uses that boundary even when the transaction retries. The unread count spans all conversations.

Use controlled error codes for bad IDs, invalid paging, invalid send or read input, unauthorized sessions, denied participant access, missing resources, closed threads, mutation conflicts, oversized bodies and throttling. Do not retry 400/401/403/404/409 blindly. Honor Retry-After on 429. Reconcile uncertain sends with the same mutation identifier. Future mobile sessions must be scoped to the exact verified staging base. Use focus/foreground and pull-to-refresh first, with non-overlapping foreground polling only if needed.

## Validation

```sh
node --test tests/*.test.js
node scripts/marketplaceStagingSmoke.js
node scripts/marketplaceStagingTransactions.js
```

The smoke runner expects freshly seeded fixtures and a verified dedicated deployment. It performs synthetic writes. It checks both roles, a suspended account, an unrelated client, booking uniqueness, pagination against equal timestamps, retry, a conflicting mutation, read/send overlap and a closed conversation. Run only against marketplace integration staging. The offline test simulates a failure between insert and metadata update. The transaction runner requires a separate fresh fixture seed and a stopped API. It verifies rollback and committed replay against the database through a local dependency injection point. It does not expose an HTTP fault endpoint. Inspect resulting counts, index definitions and the staging event record via the dedicated database connection before authorizing Stage 1C.

Fixtures contain four users, one artisan profile, three bookings, an active conversation with 36 messages, a closed conversation, two unread messages on each side, and a booking with no conversation. All are synthetic. The live matrix should also check transaction retry after a dropped response, real index enforcement, production/auth-only token rejection using synthetic keys, expired tokens, and throttling at the deployed proxy. Use the same run's synthetic records for count assertions and clean them up afterwards.
