import type { AuthConfig } from "convex/server";

/**
 * Clerk issues the session token consumed by Convex. The `convex` audience is
 * also configured in Clerk's JWT template created during the migration.
 */
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
