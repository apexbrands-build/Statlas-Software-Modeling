# Git workflow: three branches (set 2026-10-14, strategist's rule)

Production is never where new work happens. Real users are coming, so nothing reaches `main` without passing through the other two branches.

| Branch | What it is | Who changes it |
|---|---|---|
| `main` | **Production.** Vercel deploys it to https://apex-data-beta.vercel.app. | Only by merging `preview` into it, when the strategist says release. |
| `preview` | **Staging.** What is about to go live, tested on its Vercel preview deployment. | Only by merging `development` into it. |
| `development` | **Where all work happens.** Claude commits here, one commit per finished piece. | Claude (and anyone building). |

Flow: build and commit on `development` -> merge `development` into `preview`, check it on the preview URL -> merge `preview` into `main` to release.

## Rules for Claude
- Start every session with `git branch --show-current`. If it is `main` or `preview`, switch to `development` before touching anything (`git switch development`). Uncommitted work travels with the switch.
- Commit only on `development`, named files only (see the repo rule about never staging `docs` wholesale). Never commit on `main` or `preview`, and never merge into them unless the strategist asks in that message.
- Claude cannot push; the strategist pushes with GitHub Desktop. A new branch must be published once (Branch > Publish branch).
- A change that took production down is undone by reverting on `development` and promoting again, not by editing `main` directly. A hotfix on `main` is allowed only when the strategist asks for one, and is merged back into `development` the same day.

## Releasing (strategist, GitHub Desktop)
1. Current Branch: `preview`. Branch > Merge into current branch > `development`. Push origin.
2. Wait for the Vercel preview deployment of `preview` to finish; click through the changed screens.
3. Current Branch: `main`. Branch > Merge into current branch > `preview`. Push origin. Vercel deploys production.

## What is not separated yet
All three branches still talk to the **same Supabase database** and the same connector tokens. Database migrations are applied to that one live project, so they take effect for production at once; Claude applies them only when asked, keeps them additive, checks them in a rolled-back transaction first and says so. A separate development database (Supabase branching or a second project) is the next step if wanted.

## Vercel (set up 2026-10-14)
- Production branch is `main`: its deployments are `target: production`; every other branch deploys as a preview.
- Stable preview addresses (no domain needed): `https://statlas-software-modeling-git-development-apex-brands.vercel.app` and `https://statlas-software-modeling-git-preview-apex-brands.vercel.app`. They sit behind Vercel login (deployment protection), so open them while logged in to Vercel.
- **Previews read the live database through your login (changed 2026-10-20, strategist's choice).** Preview-scoped variables: `NEXT_PUBLIC_DATA_MODE=supabase`, `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (both public by design; row-level security applies). The other 21 variables, including the service-role key, `TOKEN_ENCRYPTION_KEY` and the Shopify / Meta / Google secrets, stay Production-only, so a preview cannot run a sync or use a connector token. What a preview can still do: read your clients and write whatever you save in the app (plans, ad plan, settings) to the same database as production, so test with care. Sign in with your normal account. `NEXT_PUBLIC_` variables are baked in at build time: after any change, push or Redeploy the branch.
- The earlier setup (demo data on previews, no keys) is in this file's history; a separate test database remains the safer option if previews ever need to write freely.

## GitHub (the strategist, 2 minutes; Claude has no GitHub access)
Repo `apexbrands-build/Statlas-Software-Modeling` > Settings > Branches > Add branch protection rule:
1. Branch name pattern `main`; tick **Require a pull request before merging** (and, optionally, Do not allow bypassing). Do the same for `preview` if wanted.
2. From then on `main` only changes by merging a pull request from `preview` (Pull requests > New > base `main`, compare `preview`), so GitHub Desktop can no longer push straight to it.
3. Branch protection on a private repository needs a paid GitHub plan (Team or Pro); on the free plan the Branches page offers it only for public repositories. If it is not available, the rule in this file still holds, and Claude never commits to `main`.
