# Staging authentication service

Use a separate Render Web Service with its own staging branch, environment, and HTTPS hostname. Keep automatic deploys disabled during the probe. Select Node 24, build with `npm ci`, start with `npm run start:staging-auth`, and use `/` as the health-check path. Render supplies `PORT`. Allow that service to reach the staging Atlas cluster over TLS.

| Environment variable | Required configuration |
| --- | --- |
| `STAGING_AUTH_MODE` | `staging` |
| `MONGO_URI` | A TLS-enabled URI whose path explicitly selects `demandpoint-staging`, using `demandpoint_staging_user` and its staging password |
| `JWT_SECRET` | An independently generated staging signing secret of at least 32 bytes |
| `GOOGLE_CLIENT_ID` | The existing Google Web OAuth Client ID |
| `PORT` | Render-supplied listener port |

The entry point reads only the environment supplied to the process. Keep the staging JWT secret distinct from production. The server can validate its presence and length but has no access to the production signing secret for comparison. Provision both unique identity indexes on staging before deployment. The server disables Mongoose automatic collection and index creation and confirms the effective database and authenticated privileges before listening. The staging user must have only `readWrite@demandpoint-staging`.

| Route | Database effects |
| --- | --- |
| `GET /` | No database operation during the request. Startup verifies the connection and role before the route becomes available. |
| `POST /api/auth/google` | Existing linked users are read and issued a JWT. A first sign-in can insert a staging user if the hardened checks and identity indexes permit it. The staging callback creates no notifications and sends no email. |
| `POST /api/auth/google/link` | Requires a staging bearer JWT, current account password, and a fresh Google credential. Can atomically set `googleId` and update the document timestamp. Requires a separately approved staging password-account fixture because this service has no password login or registration routes. |
| `GET /api/users/me` | Requires a staging bearer JWT and loads the user via the shared auth middleware. Returns allowlisted account fields. There is no presence timestamp write or subscription initialization. |

This service does not mount onboarding, password, payment, marketplace, or admin routes. It does not import production email, media, payment, or scheduling configuration. Public marketplace discovery remains a separate mobile API origin. Tests that create or link an account need separate approval and a staging cleanup plan. Google token verification may fetch Google's signing keys during a live request.

Run the offline suite with `node --test tests/*.test.js`. Deploy only a reviewed revision that includes the staging files and hardened Google controllers.
