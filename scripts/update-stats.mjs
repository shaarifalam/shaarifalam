import fs from "node:fs/promises";

const SVG_PATH = "README-assets/profile-card.svg";
const API_VERSION = "2022-11-28";
const VALUE_RIGHT_X = 908;
const LEADER_MIN_X = 552;
const MONO_CHAR_WIDTH = 7.2;
const LEADER_GAP = 10;

const username = process.env.GITHUB_USERNAME;
const token = process.env.PROFILE_STATS_TOKEN || process.env.GITHUB_TOKEN;
const uptimeStart = process.env.UPTIME_START || "2001-07-03T00:00:00Z";
const timeZone = process.env.PROFILE_TIME_ZONE || "Asia/Kolkata";

if (!username) {
  throw new Error("GITHUB_USERNAME is required");
}

const headers = {
  "Accept": "application/vnd.github+json",
  "User-Agent": "shaarifalam-profile-stats",
  "X-GitHub-Api-Version": API_VERSION
};

if (token) {
  headers.Authorization = `Bearer ${token}`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function formatUptime(startDate, now = new Date()) {
  let years = now.getUTCFullYear() - startDate.getUTCFullYear();
  let months = now.getUTCMonth() - startDate.getUTCMonth();

  if (
    now.getUTCDate() < startDate.getUTCDate() ||
    (now.getUTCDate() === startDate.getUTCDate() &&
      (now.getUTCHours() < startDate.getUTCHours() ||
        (now.getUTCHours() === startDate.getUTCHours() && now.getUTCMinutes() < startDate.getUTCMinutes()) ||
        (now.getUTCHours() === startDate.getUTCHours() &&
          now.getUTCMinutes() === startDate.getUTCMinutes() &&
          now.getUTCSeconds() < startDate.getUTCSeconds())))
  ) {
    months -= 1;
  }

  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const anchor = new Date(Date.UTC(
    startDate.getUTCFullYear() + years,
    startDate.getUTCMonth() + months,
    startDate.getUTCDate(),
    startDate.getUTCHours(),
    startDate.getUTCMinutes(),
    startDate.getUTCSeconds()
  ));

  let seconds = Math.max(0, Math.floor((now.getTime() - anchor.getTime()) / 1000));
  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;

  return `${years}y ${months}mo ${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function formatUpdated(now = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(now);
}

async function githubJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body.slice(0, 240)}`);
  }

  return response.json();
}

async function listOwnedRepos() {
  const repos = [];
  for (let page = 1; ; page += 1) {
    const batch = await githubJson(
      `https://api.github.com/users/${encodeURIComponent(username)}/repos?type=owner&per_page=100&page=${page}`
    );

    repos.push(...batch);

    if (batch.length < 100) {
      return repos;
    }
  }
}

async function getCommitCount() {
  try {
    const result = await githubJson(
      `https://api.github.com/search/commits?q=author:${encodeURIComponent(username)}`,
      {
        headers: {
          Accept: "application/vnd.github+json"
        }
      }
    );

    return result.total_count;
  } catch (error) {
    console.warn(`Could not update commit count: ${error.message}`);
    return null;
  }
}

async function getContributionCount() {
  if (!token) {
    console.warn("Could not update contributions: no GitHub token available");
    return null;
  }

  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1, 0, 0, 0)).toISOString();
  const to = now.toISOString();
  const query = `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
          }
        }
      }
    }
  `;

  try {
    const result = await githubJson("https://api.github.com/graphql", {
      method: "POST",
      body: JSON.stringify({
        query,
        variables: { login: username, from, to }
      })
    });

    if (result.errors?.length) {
      throw new Error(result.errors.map((entry) => entry.message).join("; "));
    }

    return result.data?.user?.contributionsCollection?.contributionCalendar?.totalContributions ?? null;
  } catch (error) {
    console.warn(`Could not update contribution count: ${error.message}`);
    return null;
  }
}

function currentStat(svg, stat) {
  const match = svg.match(new RegExp(`<text\\b(?=[^>]*\\bdata-stat="${stat}")[^>]*>([\\s\\S]*?)</text>`));
  return match ? match[1] : "";
}

function replaceStat(svg, stat, value) {
  const escaped = escapeXml(value);
  const textPattern = new RegExp(`(<text\\b(?=[^>]*\\bdata-stat="${stat}")[^>]*>)([\\s\\S]*?)(</text>)`);
  const linePattern = new RegExp(`(<line\\b(?=[^>]*\\bdata-leader="${stat}")[^>]*\\bx2=")([^"]+)(")`);
  const nextX = Math.max(LEADER_MIN_X, Math.round(VALUE_RIGHT_X - String(value).length * MONO_CHAR_WIDTH - LEADER_GAP));

  let next = svg.replace(textPattern, `$1${escaped}$3`);
  next = next.replace(linePattern, `$1${nextX}$3`);
  return next;
}

async function main() {
  let svg = await fs.readFile(SVG_PATH, "utf8");
  const user = await githubJson(`https://api.github.com/users/${encodeURIComponent(username)}`);
  const repos = await listOwnedRepos();
  const commitCount = await getCommitCount();
  const contributionCount = await getContributionCount();

  const stats = {
    uptime: formatUptime(new Date(uptimeStart)),
    repos: formatNumber(user.public_repos ?? repos.length),
    stars: formatNumber(repos.reduce((sum, repo) => sum + (repo.stargazers_count || 0), 0)),
    commits: commitCount == null ? currentStat(svg, "commits") : formatNumber(commitCount),
    followers: formatNumber(user.followers),
    contributions: contributionCount == null ? currentStat(svg, "contributions") : formatNumber(contributionCount),
    updated: formatUpdated()
  };

  for (const [stat, value] of Object.entries(stats)) {
    svg = replaceStat(svg, stat, value);
  }

  await fs.writeFile(SVG_PATH, svg);
  console.log(`Updated ${SVG_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
