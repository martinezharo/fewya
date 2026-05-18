# Always keep these rules and concepts in mind:

## Coding Standards

- Keep code as efficient as possible: code with fewer errors is the one that isn't written. You should seek the smartest and most scalable way to do everything I tell you.
- Modularize and componentize whenever possible, create separate files for components and functions that are prone to being reused or are simply complex enough to warrant a separate file.
- Make the code scalable.
- Always explain in chat what you've done and don't hesitate to suggest improvements or report bad practices or errors you find.
- Don't hardcode text, create files with variables to facilitate future changes or translations.
- Page routes must always be in English.
- When you make changes to the database structure, update db-structure and generate a new SQL file in a migrations folder with the changes ready to be imported into Supabase.
- NEVER make commits, push, or anything else that alters the Git history unless I explicitly ask you to.
- If I ask you to make a commit, follow Git best practices by dividing by responsibility / category / functionality and avoiding monolithic commits. Always write the message in English.

## Fewya

### Product
- It will be a Mobile First PWA in the shopping section, act more like you're developing a native mobile app than a website.
- The seller section will focus on providing a good desktop experience.
- Buyer and seller sections separated at the user level but sharing the necessary code to increase efficiency.

### Concept Ideas
- A marketplace where small businesses can sell in a more professional way than Wallapop or Vinted, but just as easy to use without the complications of their own website or selling on Amazon.
- The buyer can purchase directly with confidence without chatting, with clear information and variants in a click.
- "Amazon dehumanizes the seller. Wallapop over-humanizes the transaction."
- Buy from the seller, not the platform. This must be clear.
- Goal: Democratize eCommerce.
- Focused on new products, not second-hand.
- The buyer pays for what they see: products and shipping. Commissions and insurance are the seller's responsibility.
- Give sellers more management freedom (like Shopify) and let them manage everything as they see fit in terms of policies.

### Design
The marketplace design must be extremely professional and ultramodern. It must have a minimalist and modern aesthetic on par with Notion, OpenAI, Revolut, or Apple.
Always create versions for light mode and dark mode.

## Stack

### Core
- **Framework:** Astro (SSR enabled for Cloudflare/Supabase).
- **Language:** TypeScript.
- **Styling:** Tailwind CSS

### Infrastructure and Backend
- **Deployment:** Cloudflare Workers.
- **Database:** Supabase (PostgreSQL).
- **Authentication:** Supabase Auth (Initially Google only).

### Development Tools
- **Package Manager:** Bun.
- **Linter:** ESLint with `eslint-plugin-astro`.
- **PWA:** `vite-plugin-pwa` for offline functionality and installation.