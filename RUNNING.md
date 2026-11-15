# How the scheduled jobs in this repo run

This file tells you what runs automatically in this repo, what each job needs, and how to run the jobs on a different machine. Use it if you move the jobs off GitHub Actions.

## Summary

All four scheduled jobs are only HTTP calls. They do not check out the code. Each job sends `curl` requests to the admin API of the live site, and the app on Railway does the work. Thus, you can run them from any machine that has `bash`, `curl` and `jq`.

| Workflow file | Starts when | What it does |
|---|---|---|
| `refresh-playlists.yml` | Every day at 09:00 UTC. Also by hand. | Checks the admin secret, then reparses the music feeds, reparses the curated podcasts, repairs feed data, imports new albums (publisher feeds and artists), refreshes the 12 playlists, and deletes diagnostics older than 30 days. If the admin secret check fails, the job stops. Most other steps only log a warning when they fail. |
| `refresh-artists-targeted.yml` | Every 3 hours. Also by hand. | Imports new albums from artists that have no publisher feed, then reparses the new feeds. |
| `refresh-podcasts-targeted.yml` | Sundays and Tuesdays, at :15 and :45 past 11, 12 and 13 UTC. Also by hand. | Reparses UpBeats (Sunday) or Two For Tunestr (Tuesday) in its publish window. On other days it does nothing. |
| `check-dead-feeds.yml` | Mondays at 10:00 UTC. Also by hand. | Finds feeds that return 404/410. It moves each feed to its new home, or hides it, then refreshes the moved feeds. |

Other workflows (`ci.yml`, `issue-automation.yml`) start on push, PR or issue events. They do not run on a schedule.

## Secrets

These secrets are in **Settings → Secrets and variables → Actions** on GitHub. GitHub does not show the values again, so keep a copy in your password manager.

| Secret | Environment variable in the job | What it is |
|---|---|---|
| `ADMIN_SECRET` | `AUTH_HEADER` (`Authorization: Bearer <ADMIN_SECRET>`) | Must be the same value as the `ADMIN_SECRET` variable of the StableKraft service on Railway. If the two values are different, `refresh-playlists.yml` fails at step 1. |
| `PLAYLIST_BASE_URL` | `BASE_URL` | Optional. The base URL of the site. If it is not set, the jobs use `https://stablekraft.app`. |

## Run the jobs locally

These steps are for a Linux server, for example your Ubuntu server.

### 1. Install the tools
```bash
sudo apt install curl jq
```

### 2. Put the secrets in an env file
```bash
# /etc/stablekraft-jobs.env   (chmod 600, owned by the job user)
BASE_URL=https://stablekraft.app
AUTH_HEADER="Authorization: Bearer <the ADMIN_SECRET value from Railway>"
```
Keep the quotes on `AUTH_HEADER`. The value has spaces, and the shell needs the quotes to read it.

### 3. Get each job as a script
The job is the `run: |` block of each workflow file. Copy that block into a script, with `#!/usr/bin/env bash` and `set -e` at the top. For example, `refresh-playlists.sh`. Update the scripts when you change a workflow file.

### 4. Run a job
```bash
set -a; . /etc/stablekraft-jobs.env; set +a
bash refresh-playlists.sh
```

### 5. Schedule
Use systemd timers or cron with the same times (all times are UTC):

```
0 9 * * *              refresh-playlists.sh
0 */3 * * *            refresh-artists-targeted.sh
15,45 11,12,13 * * 0,2 refresh-podcasts-targeted.sh
0 10 * * 1             check-dead-feeds.sh
```

If you run the jobs locally, disable the `schedule:` triggers in the workflow files. If you do not, each job runs two times.

## Notes

- The jobs call `/api/admin/*` endpoints. These endpoints are in this repo, in the app that runs on Railway. If you move the app, change `BASE_URL`.
- `refresh-playlists.yml` makes many long calls. The reparse step can take up to 12 calls of 290 s each. A local timer must allow at least 1 hour for this job.
- `check-dead-feeds.yml` writes its audit trail (moved and hidden feeds) to the job log. With a local run, keep the log, for example with `>> /var/log/stablekraft-dead-feeds.log`.
