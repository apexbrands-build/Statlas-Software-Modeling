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

## One-time setup the strategist does on GitHub and Vercel
- GitHub > repo Settings > Branches: add a protection rule for `main` (require a pull request, no direct pushes) and, optionally, for `preview`.
- Vercel > project Settings: Production Branch = `main`; give the `preview` branch a fixed domain (Settings > Domains > assign to branch `preview`); every environment variable is currently scoped to **Production only** (checked 2026-10-14: none has Preview or Development), so a deployment of `preview` or `development` starts with no Supabase keys and no `NEXT_PUBLIC_DATA_MODE` and will not load real data. In Settings > Environment Variables, tick **Preview** on the ones the app needs (the Supabase and `NEXT_PUBLIC_*` ones first). Doing that points previews at the same live database; the safer route is a separate development Supabase project and its own keys for Preview.
