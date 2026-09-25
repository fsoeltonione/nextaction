## Goal Description
NextAction is a two-sided contextual promotion network for SaaS products. It connects commercially relevant "Moments" inside SaaS products with relevant offers. Publishers can monetize these Moments, while advertisers can reach users during these semantic events. The platform normalizes technical events into canonical Moments, ensuring relevance and contextual targeting without relying on identity graphs or traditional ad-tech profiles. The MVP focuses on selling "Qualified Click" capacity with a clear economic split (75% Publisher / 25% NextAction) and a strict server-authoritative trust model. The desired UX is ultra-simple, starting with a URL and guiding the user through intent selection (Make Money, Reach Customers, Both) without exposing infrastructure complexity.

## Decisions Made (User Approved)
- **URL-First Processing:** We will use an LLM (e.g., via Google Gemini or OpenAI API) to analyze the provided URL and automatically derive the Product Name, Description, and suggest canonical Moments.
- **Offer Delivery:** The API will support returning raw JSON data by default, allowing publishers to render the offer natively within their own UI components (ensuring it is fail-open and non-intrusive). We can add a drop-in widget/HTML option later if requested.
- **Payments (Deferred):** Real payment gateway integration (like Stripe) is deferred for the MVP due to regional limitations for creators. For now, the system will use a manual or mock credit allocation mechanism to assign the initial "$25 for 25 Qualified Clicks" balance.

## Proposed Changes

The architecture will be split into a simplified frontend for onboarding/dashboard and a robust, secure backend for the Core Runtime.

### Component: Frontend Application (UX & Onboarding)
Focuses on the "Simple input → Recognition → Guided action → Outcome" principle, heavily inspired by the seamless onboarding flow of tools like DataFast.

#### [NEW] Landing Page & Hero URL Input
- **The Hook:** A massive, clean hero section (e.g., "Monetize your SaaS Moments").
- **The Input:** Instead of a standard "Sign Up" button, the primary call-to-action is a single, prominent input field asking for the user's SaaS product URL (e.g., `https://your-saas.com`).
- **The Action:** A prominent "Analyze my product" or "Add my website" button right next to/below the input. Friction (like asking for an email/password) is entirely removed from this initial step.

#### [NEW] Product Understanding & Confirmation State (The "Magic" Moment)
- Upon submitting the URL, transition immediately to a visually engaging loading state ("Analyzing product surfaces...").
- **Recognition:** Present a confirmation card showing the derived details: Product Name, Description, and specifically, the suggested canonical Moments (e.g., "We found: `invoice_created`, `user_signed_up`").
- **Guided Action:** The user simply clicks to confirm or edit these moments.

#### [NEW] Intent Selection & Conditional Auth
- After confirming the product data, present the intent choice as large, clickable cards: "I want to Make Money", "I want to Reach Customers", or "Both".
- **Conditional Auth:** *Only at this point* does the system ask the user to authenticate (Google OAuth or email) to save their workspace. The user is already invested.
- Capability-specific setup follows (e.g., defining an offer and purchasing capacity for advertisers).

#### [NEW] Unified Workspace Dashboard
- A clean, distraction-free interface devoid of ad-tech jargon.
- **Advertiser view:** Active offers, remaining Qualified Clicks, conversion metrics.
- **Publisher view:** Integration snippet (SDK/API keys), Moments captured, earnings balance.

---

### Component: Core Runtime Services (Backend)
Preserves the strict domain chain: Event → Moment → Decision → Delivery → Click → Qualified Click → Settlement.

#### [NEW] Ingestion API (`/track`)
- Fast, asynchronous endpoint to receive raw technical signals from publishers.
- Places events onto a queue for background normalization into canonical Moments.

#### [NEW] Decisioning Engine (`/offer`)
- Synchronous, low-latency endpoint called by publishers when a relevant UI surface is rendered.
- Matches the given Moment to an eligible, funded Offer.
- **Fail-open requirement:** Must return a fast `204 No Content` (no-fill) if processing exceeds a tight timeout threshold, ensuring host SaaS performance is unaffected.

#### [NEW] Settlement & Verification Service (`/click`)
- Endpoint that handles user clicks on offers.
- Performs server-side verification (e.g., validating a signed token embedded in the offer link).
- If qualified: Atomically deducts 1 credit from the advertiser, allocates $0.75 to the publisher, and $0.25 to NextAction. Records the `Settlement`.

---

### Component: Data Model (Database)
Relational schema designed for financial integrity and idempotency.

#### [NEW] Database Schema Design
- `workspaces`: Represents a user/company entity.
- `products`: Linked to a workspace, contains URL, name, description.
- `moments`: Canonical semantic events (e.g., `invoice_created`), linked to products.
- `advertiser_balances`: Tracks purchased capacity (Qualified Clicks remaining).
- `offers`: Advertiser campaigns targeting specific Moments.
- `settlements`: Immutable ledger of atomic transactions representing a Qualified Click.

## Verification Plan

### Automated Tests
- **Unit Tests:** Verify the normalization logic mapping technical events to canonical Moments.
- **Integration Tests:** Test the atomic settlement transaction to ensure balances are never deducted twice for the same click token (Idempotency).
- **Latency Tests:** Ensure the `/offer` endpoint returns a no-fill response within acceptable limits (e.g., < 100ms) under simulated load.

### Manual Verification
1. **End-to-End Publisher Loop:** Simulate a Moment occurrence -> Receive an Offer -> Simulate a click -> Verify the click is marked as Qualified and the Publisher's balance increases.
2. **End-to-End Advertiser Loop:** Purchase capacity -> Create an Offer -> Ensure the Offer is delivered to a matching Publisher Moment -> Verify balance decreases by 1 after a simulated Qualified Click.
3. **UX Onboarding:** Walk through the URL-first flow to ensure it feels fluid and removes infrastructure complexity as specified.
