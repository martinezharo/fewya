# AGENTS.md
## Project
Fewya is a marketplace specialized in new products from professional sellers.
It has two distinct sides:

* Buyer side: A shopping experience on par with Amazon. Mobile / PWA first. No noise.
* Seller side: Desktop first, without losing responsiveness on other devices. Focused on letting you manage your business easily, getting you selling within minutes just like on platforms such as Wallapop and Vinted, while still offering the core tools that more complex platforms like Amazon or Shopify provide.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Priorities
* Optimal performance.
* Unbreakable security.
* Modern, professional UI/UX, consistent across the entire site.

## Maintainability
Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.