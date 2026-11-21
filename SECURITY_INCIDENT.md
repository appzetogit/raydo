# Recurring payload injection

Two waves so far. The second (November 2026) is newer and worse, so it comes first;
the original `vite.config.js` findings follow it unchanged.

---

# Wave 2 (Nov 2026): GitHub branches rewritten from the `appzetogit` account

Found 2026-11-20 while preparing a deploy. Written up 2026-11-21.

**Status: ongoing.** Both branches on GitHub carry the payload right now, and they
have been rewritten again after every cleanup or new push. The pushes came from the
`appzetogit` account (see below), so that account or a machine signed in as it is
compromised. Until that is fixed, assume anything pushed to GitHub can be rewritten.

## What changed

The attacker does not add new commits. It **rewrites your latest commit** on each
branch and force-pushes the copy, keeping the original author (`omp10`), author
date and message. The committer date moves by only a few seconds, so in `git log`
the rewritten commit looks exactly like the one you made.

Each rewrite adds the same five changes:

| File | Change | Effect |
|---|---|---|
| `Backend/init`, `Frontend/init` (new) | ~30 lines of harmless-looking setup code, then on one line, after hundreds of spaces, a ~21,000-character obfuscated script | The payload. Runs under Node with full access (`require`, `module`); sets the identifier `global.z = '-n9000'` |
| `Backend/package.json` | `start` and `dev` become `node init && ...` | The payload runs whenever the API or the dev server starts, including under pm2 on the server |
| `Frontend/package.json` | `dev`, `build`, `start` become `node init && ...` | The payload runs on every build, **before** `check-source-integrity.mjs` |
| `.gitignore` | removes `.env`, `.env.*` and `.vscode/*` | The next ordinary `git add -A` would commit and push every secret key file |
| `Frontend/vite.config.js` | 266 tab characters appended after the closing `});` | Padding only in this version; the spot the wave-1 payload used |

The two `init` files are byte-identical. The identifier differs from wave 1
(`global.i = 'A8-3388-2'`) but the hiding technique is the same: code pushed far to
the right of an ordinary-looking line.

## Timeline on GitHub

From GitHub's push events and `git reflog` (UTC):

| When | Branch | Pushed by | Before → after | |
|---|---|---|---|---|
| 11-04 12:32 | `main` | `omp10` | `12c6cdc` → `258a128` | genuine |
| 11-05 08:00 | `review-otp-login` | `omp10` | `161aff9` → `2cc3eec` | genuine |
| 11-10 08:50 | `main` | **`appzetogit`** | `258a128` → `4512128` | rewritten copy of `258a128` |
| 11-10 08:50 | `review-otp-login` | **`appzetogit`** | `2cc3eec` → `4b25d71` | rewritten copy of `2cc3eec` |
| 11-14 16:33 | `main` | **`appzetogit`** | `4512128` → `4d0fa76` | rewritten again |
| 11-14 16:33 | `review-otp-login` | **`appzetogit`** | `4b25d71` → `997fd21` | rewritten again |
| before 11-20 | `main` | not in the events feed | → `77f30f9` | current head, parent `12c6cdc` |
| before 11-20 | `review-otp-login` | not in the events feed | → `8408d90` | current head, parent `161aff9` |

Both branches are pushed within seconds of each other, every time. That is a
script, not a person.

## Why the existing guard did not help

- `check-source-integrity.mjs` scans files with code extensions only. An
  extensionless `init` is never read.
- In the rewritten `Frontend/package.json` the build runs `node init` **before**
  the guard, so the payload has already executed by the time the guard starts.
- The `.githooks/pre-commit` hook protects commits made on a clean machine. These
  commits are made somewhere else and force-pushed, so it never sees them.

## What is clean

As of 2026-11-20, checked on the local clone in `D:\projects\raydo`:

- no `init` files; `package.json` scripts do not call `node init`
- no tracked text file has a line over 3,000 characters (only images and video do)
- local `main` still has the genuine `258a128`; the stage 2 franchise commit
  `fc7e736` and the partner-portal commit `d3dcb6e` sit on top of it, **unpushed**

Today's builds, tests and preview runs used this clean copy only.

## Not known yet

- **Whether the server pulled a rewritten commit.** If `/root/raydo-new` is on
  `4512128`, `4d0fa76` or `77f30f9`, the payload ran as root every time pm2
  started the API, and every secret on that box should be treated as exposed.
- **How the `appzetogit` account is being used**: a stolen token, an SSH or deploy
  key, an OAuth or GitHub App, or a machine that stays signed in.
- **Whether wave 1 and wave 2 are the same intruder.** Same hiding technique,
  different identifier, and wave 2 has moved from one developer's working tree to
  the shared GitHub account.

## What still needs a person

1. **Lock down `appzetogit`**: change the password and enable two-factor login.
   Revoke its personal access tokens, SSH keys, deploy keys and authorised
   OAuth/GitHub Apps. Read its security log for where the pushes came from.
2. **Find and clean the machine** that is signed in to GitHub as `appzetogit`.
3. **On the server**, before anything else: `git -C /root/raydo-new log -1`, and
   check for `init` files and `node init` in either `package.json`. If they are
   there, stop pm2, then change the Mongo URI, JWT secrets, Razorpay, Firebase and
   SMS keys.
4. **Only after 1–3**, restore both branches from the clean local clone and turn
   on branch protection for `main` (no force pushes, required reviews). Until
   then a restore will simply be rewritten again.
5. **Close the guard's gaps**: make it scan extensionless files at the root of
   `Frontend/` and `Backend/`, make it refuse any `package.json` script that runs a
   file other than the known ones, and run it in CI on every push.
6. **Never deploy with a bare `git pull`.** Check out a reviewed commit by hash
   and compare `package.json` scripts before running `npm`.

---

# Wave 1 (Aug–Sep 2026): payload injected into `Frontend/vite.config.js`

Findings from tracing the seven "strip the EtherHiding payload" commits. Written
down because the important parts are timestamps and open questions, and both get
lost in a chat log.

**Status: the source of the injection is NOT in this repository and has not been
found.** Everything below is scoping and containment, not a fix.

---

## What it is

An obfuscated JavaScript payload appended to `Frontend/vite.config.js`, after
several hundred TAB characters so that in an editor it sits far off the right-hand
edge of a line that looks perfectly normal. The infected file carries a single line
of **32,013 characters**.

It assigns `global.i = 'A8-3388-2'` — a campaign or victim identifier — and is
EtherHiding: it fetches its real instructions from a blockchain contract, so there
is no domain to block and no takedown to wait for.

`vite.config.js` is a file the build **executes**. A payload there runs with the
developer's privileges on whatever machine builds, and can fold itself into the
shipped bundle.

---

## Exposure: `main` carried it for roughly nine days

The payload was not merely present in working trees. It was **committed**, each
time swept up by an ordinary feature commit whose author was not looking at
`vite.config.js`.

| infected from | until | duration | committed by |
|---|---|---|---|
| 08-22 18:45 | 08-25 17:26 | ~3 days | `d90a01d` feat(food): desktop split-screen layout |
| 08-27 18:08 | 08-31 13:30 | ~4 days | `e5dedc1` feat(food): inline form validation |
| 08-31 18:38 | 09-01 11:24 | ~17 hours | `47b1f0c` fix(food): finish the Cloudinary migration |
| 09-01 11:29 | 09-01 12:05 | ~36 min | `1997992` build: refuse to build source carrying an injected payload |
| 09-08 18:42 | 09-09 12:00 | ~17 hours | `e83d169` fix(pricing): revert reset the menu |
| 09-15 16:27 | 09-15 17:43 | ~76 min | `eec8f23` fix(payout): the percentage beside the tax |
| 09-15 19:02 | 09-16 12:34 | ~17.5 hours | `4a78bad` feat(cart): the priced trip distance |

`1997992` is the commit that ADDED the integrity guard, and it is itself infected.

---

## Did it ship?

**Through GitHub Actions: almost certainly not, since 2026-09-01.**

- `.github/workflows/deploy.yml` is `workflow_dispatch` only. Push-to-main
  auto-deploy is commented out, so nine days of infected `main` did not deploy
  themselves.
- The deploy runs `npm run build` in `Frontend`, and that script begins with
  `node scripts/check-source-integrity.mjs`. Verified against the genuine payload:
  the guard stops the build.
- So a manual deploy from an infected commit would have **failed**, not shipped.

**Before 2026-09-01, it would have shipped.** The guard was added by `1997992` on
09-01. The three earlier windows — 08-22, 08-27, 08-31 — predate it. Any deploy in
those windows built and published a poisoned bundle.

**OPEN, and the most important question here.** `Backend/server.js:254` exposes a
second deploy path:

```js
app.post('/api/deploy', ...)   // → exec('cd ~ && ./deploy.sh')
```

**Checked on the server, 2026-09-16: `~/deploy.sh` does not exist.** pm2 runs as
root, so the webhook's `cd ~ && ./deploy.sh` points at `/root/deploy.sh`, which is
missing. As the box stands today, that path cannot build anything, poisoned or not.

What this does NOT prove: that the file never existed. If it was present during one
of the windows above and has since been removed, it could still have shipped a
poisoned bundle. Deploy logs or shell history for those dates are the only way to
close that. It is also worth deciding whether `/api/deploy` should exist at all --
an unauthenticated-by-default route that execs a shell script is a standing risk,
and today it does nothing useful.

The local `Frontend/dist/` is clean, but it was built 2026-08-27 17:57, inside one
clean window. It says nothing about what the server built.

---

## Where it is NOT coming from

Checked and ruled out:

- no git hooks; `core.hooksPath` unset
- neither `package.json` declares install hooks
- the marker `A8-3388-2` appears nowhere in `node_modules`
- the only install hooks among installed packages belong to `esbuild`, `core-js`,
  `@firebase/util` and `protobufjs`

So something **outside the repository** writes that file: an editor extension, a
compromised global npm package, or another process on the developer machine. A
file inside this project cannot determine which.

One related detail already recorded in `check-source-integrity.mjs`: the same
payload was once committed to the seller app disguised as
`public/fonts/fa-solid-500.woff2` — an asset name that is not an asset — with an
editor task added to run it. **An editor task** is a strong hint about the vector.

---

## What has been done

| | |
|---|---|
| `Frontend/scripts/check-source-integrity.mjs` | pre-existing, wired into `npm run build`, catches it reliably |
| `.githooks/pre-commit` | **new** — runs the same check at commit time, which is where the payload actually entered. Not enabled automatically: `git config core.hooksPath .githooks` |

The guard was never the weak point. Its **timing** was: it ran at build, and none
of the seven authors above were building the frontend.

---

## What still needs a person

1. **Read `~/deploy.sh` on the server.** It decides whether the webhook path is
   guarded. This is the open question that determines whether a poisoned bundle
   reached users.
2. **Rotate every credential that machine can read**, `Backend/.env` included —
   Mongo URI, Razorpay keys, Firebase service account, JWT secrets. The payload
   executed with the developer's privileges at least seven times.
3. **Audit editor extensions and global npm packages** (`npm ls -g --depth=0`).
   The weekly-ish cadence with no in-repo vector fits an extension that
   self-updates.
4. **Check deploy history against the three pre-09-01 windows.** If a deploy
   happened in one, the bundle users received contained the payload.
5. **Enable the hook on every clone**, and consider a CI job that runs the
   integrity check on pull requests, so a poisoned commit cannot reach `main` even
   from a machine where the hook is not enabled.
