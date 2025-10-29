# Playwright Snapshot Archiver

This repository captures point-in-time snapshots of public webpages using GitHub Actions and Playwright. Each run of the workflow launches headless Chromium, downloads a target URL, extracts a readable text rendition, and stores both the raw HTML and cleaned text inside the repository under `archive/<timestamp>/`.

Snapshots are automatically committed back to the repository so you can track how a page changes over time without managing any servers.

## Quick start

Follow these steps to stand up the repository and trigger your first snapshot run:

1. **Create a GitHub repository.** Either fork this project or push the contents to a new repo whose default branch is `main`.
2. **Enable GitHub Actions.** Open the repo's **Settings → Actions** page and ensure workflows are permitted to run on `main`.
3. **Push the workflow.** Push (or merge) the latest commit to GitHub so that the `Snapshot URL` workflow is available in the Actions tab.
4. **Trigger a snapshot.**
   - From the GitHub UI: go to **Actions → Snapshot URL → Run workflow**, provide a URL such as `https://example.com`, and click **Run workflow**.
   - From an API client: create a Personal Access Token with the `repo` (or `public_repo`) scope, then run the `curl` command in [REST API trigger](#rest-api-trigger-repository_dispatch), substituting your repository path and target URL.
5. **Verify results.** Within a minute or two the workflow commits new files under `archive/<timestamp>/`. Each run contains `page.html` and `page.txt`. The commit message follows `snapshot: <timestamp> <URL>`.

Once these steps complete you can repeatedly trigger the workflow to archive additional URLs.

## Repository structure

```
archive/
  └── <timestamp>/
      ├── page.html   # Raw HTML returned by Chromium
      ├── page.txt    # Readable text with scripts/styles removed
      └── meta.json   # Metadata (URL, timestamp, HTTP status, etc.)
.github/
  └── workflows/
      └── snapshot.yml
scripts/
  ├── snapshot.js        # Playwright-powered snapshotter
  └── commit-and-push.sh # Helper for committing workflow results
```

`archive/.gitkeep` ensures the archive directory exists before the first snapshot.

Each captured URL is also published under `docs/latest/` so downstream consumers can fetch stable URLs hosted via GitHub Pages:

```
docs/
  ├── index.html                # Human-friendly table of the latest snapshots
  └── latest/
      ├── <slug>.html           # Latest raw HTML snapshot for the URL
      ├── <slug>.txt            # Latest cleaned text snapshot
      ├── <slug>.meta.json      # Snapshot metadata (at minimum { "url", "timestamp" })
      └── index.json            # Machine-readable listing (one entry per URL)
```

`docs/latest/index.json` now includes `meta` alongside `html` and `text`, pointing to the corresponding `.meta.json` file for each URL.

## Triggering snapshots

### Manual trigger (workflow_dispatch)

1. Navigate to the **Actions** tab in your GitHub repository.
2. Select the **Snapshot URL** workflow.
3. Click **Run workflow**, provide the target URL, and confirm.

The workflow will enqueue immediately and, once completed, commit the snapshot files back to the repository.

### REST API trigger (repository_dispatch)

You can trigger the same workflow using GitHub's REST API. Replace `YOUR_TOKEN`, `OWNER`, and `REPO` with your values:

```bash
curl -X POST \
  -H "Authorization: token YOUR_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/OWNER/REPO/dispatches \
  -d '{"event_type":"snapshot_request","client_payload":{"target_url":"https://example.com"}}'
```

The Personal Access Token must include `repo` scope (for private repositories) or `public_repo` (for public repositories) so that GitHub Actions can write commits.

## How it works

1. **Input resolution** – The workflow accepts either a manual input (`workflow_dispatch`) or a `repository_dispatch` payload and validates the target URL.
2. **Snapshot capture** – `scripts/snapshot.js` launches Playwright Chromium, navigates to the URL, records the HTML, and extracts human-readable text by removing `script`, `style`, and `noscript` nodes.
3. **Archival** – Files are stored under `archive/<ISO8601 timestamp>/`. If a snapshot already exists for the exact second, the workflow appends `-dupN` to keep directories unique.
4. **Commit automation** – `scripts/commit-and-push.sh` adds the archive directory, confirms there is enough disk space, and pushes a commit with the message `snapshot: <timestamp> <URL>` directly to the current branch (default `main`).

All commands run within GitHub Actions using Node.js 20 and Playwright.

## Local testing

To run the snapshot script locally:

```bash
npm install
node scripts/snapshot.js "https://example.com"
```

The script prints the filesystem paths that contain the archived snapshot. Subsequent runs during the same second will automatically create suffixed directories.

## Troubleshooting

- **Navigation errors** – If Chromium cannot load the page, the workflow fails and prints a descriptive error message (HTTP status codes outside 200–399, timeouts, invalid certificates, etc.).
- **Disk pressure** – The commit helper checks for at least 10 MB of free space before committing to avoid exhausting the ephemeral GitHub Actions runner disk.
- **Missing URL** – The workflow aborts early if no URL is provided in the manual input or dispatch payload.

## License

This project is distributed under the [MIT License](LICENSE).
