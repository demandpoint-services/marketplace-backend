# Stage 2 service marketplace integration

Stage 2 extends the existing Marketplace Integration Staging app and uses the existing synthetic client and artisan accounts. The deployed service must return `{"serviceMarketplace":true}` from `GET /api/stage2` before an Android lifecycle review. Staging startup adds indexes to its own booking and service-notification collections after verifying the database identity and transaction support. Stage 2 booking and conversation records carry their own fixture marker. Do not reset fixtures to perform the review.

## Android development client

Use the existing development APK and Metro. Keep the Stage 1C marketplace staging URL and Chat flag, and set `EXPO_PUBLIC_ENABLE_SERVICE_MARKETPLACE=true` in Metro's development environment. With that flag, public professional discovery uses the assigned staging catalogue and Profile, Activity, Chat, reviews and notifications share the existing marketplace staging token. Product and space discovery keep their normal configuration. Google and protected production traffic are outside this mode.

1. As a guest, open a staging professional from Home or Hire and choose **Request a service**. Sign in with the assigned client account and confirm that the professional and selected service are retained.
2. Review and submit a request using a future Nigeria date and time. Confirm the reference, schedule, and address in Activity.
3. Sign out and sign in as the assigned artisan. Open the incoming notification, accept the request, send a booking-linked message, start work, and request completion confirmation.
4. Switch back to the client. Open Chat from the booking and check message history and unread counters. Confirm completion and submit a review. Reopen the professional to check the server-calculated rating and feedback.
5. Check the cancellation and decline paths with separate synthetic requests. Exercise a slow or interrupted submission and retry the same request. Its reference should remain the same.

## Main API release checks

The main API includes an additive participant-scoped booking detail and cursor list, a cursor notification inbox, and backwards-compatible message pagination and writes. Legacy website booking creation still returns the original booking shape. Legacy messages still support attachments and a send without a mutation ID.

Before deploying the main API changes, use an approved read-only connection with an explicit database in `MARKETPLACE_INDEX_CHECK_URI` and run `node scripts/checkServiceMarketplaceIndexes.js`. It reports only readiness and duplicate presence. Provision missing partial unique indexes only after reviewing the output. Keyed writes fail closed when their unique index is missing.

- Bookings require the unique `{ client: 1, clientMutationId: 1 }` index, partial on a string mutation ID.
- Messages require the unique `{ conversation: 1, sender: 1, clientMutationId: 1 }` index with the same partial predicate.
- Conversations require the existing unique `{ booking: 1 }` index.

Verify transaction support and run website and mobile contract checks against an approved representative dataset before enabling protected production traffic. Verify legacy numbered history and attachments, concurrent booking conversation opens, conditional read boundaries, notification preferences, and recovery between network loss and a committed write. The mobile build keeps protected service calls pinned to marketplace staging. Production credentials, transport enablement, and on-device production checks require separate approval.
