import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const username =
  process.env.GITHUB_USERNAME ||
  process.env.GITHUB_REPOSITORY_OWNER ||
  'shaarifalam';

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

if (!token) {
  console.error('Missing GITHUB_TOKEN or GH_TOKEN.');
  console.error('Create a GitHub token locally, or let GitHub Actions provide GITHUB_TOKEN.');
  process.exit(1);
}

const query = `
  query ProfileStats($login: String!, $cursor: String) {
    user(login: $login) {
      login
      name
      followers { totalCount }
      following { totalCount }
      repositories(
        first: 100
        after: $cursor
        ownerAffiliations: OWNER
        isFork: false
        privacy: PUBLIC
        orderBy: { field: STARGAZERS, direction: DESC }
      ) {
        totalCount
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          name
          stargazerCount
          forkCount
          primaryLanguage {
            name
          }
        }
      }
      contributionsCollection {
        totalCommitContributions
        totalIssueContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
        contributionCalendar {
          totalContributions
        }
      }
    }
  }
`;

const user = await fetchProfileStats(username);
const repos = user.repositories.nodes;
const totals = repos.reduce(
  (acc, repo) => {
    acc.stars += repo.stargazerCount;
    acc.forks += repo.forkCount;
    if (repo.primaryLanguage?.name) {
      acc.languages.set(
        repo.primaryLanguage.name,
        (acc.languages.get(repo.primaryLanguage.name) || 0) + 1
      );
    }
    return acc;
  },
  { stars: 0, forks: 0, languages: new Map() }
);

const topLanguages = [...totals.languages.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .slice(0, 4)
  .map(([language]) => language)
  .join(' • ') || 'Design Systems • Frontend';

const generatedAt = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC'
}).format(new Date());

const statsBlock = `<pre><sub>shaarif@alam -----------------------------------------
OS............................. Web, Mobile, IoT, Linux
Uptime......................... 22+ years
Host........................... UI/UX Designer, Frontend
Kernel......................... IoT Software Designer
IDE............................ Figma, VS Code, Blender

Languages.Programming......... ${escapeXml(topLanguages)}
Languages.Computer............ HTML, CSS, React, Node.js
Languages.Real................ English, Hindi, Urdu

Hobbies.Software.............. Dashboards, Design Systems
Hobbies.Hardware.............. GPS, Fleet, IoT Devices

Contact
Email.Personal................ shaarifalam@gmail.com
Email.Personal................ github.com/${escapeXml(user.login)}
Email.Work.................... available on request
LinkedIn...................... linkedin.com/in/shaarifalam
Discord....................... shaarifalam

GitHub Stats -------------------------------
Repos: ${formatNumber(user.repositories.totalCount)}   Stars: ${formatNumber(totals.stars)}   Commits: ${formatNumber(user.contributionsCollection.totalCommitContributions)}   Followers: ${formatNumber(user.followers.totalCount)}
Lines of Code on GitHub: N/A
Updated: ${escapeXml(generatedAt)} UTC</sub></pre>`;

await updateReadme(statsBlock);

console.log(`Updated stats for ${user.login}.`);

async function fetchProfileStats(login) {
  let cursor;
  let user;
  const repos = [];

  do {
    const payload = await fetchGraphQL(query, { login, cursor });
    const pageUser = payload.data?.user;

    if (!pageUser) {
      throw new Error(`GitHub user not found: ${login}`);
    }

    repos.push(...pageUser.repositories.nodes);
    user = pageUser;
    cursor = pageUser.repositories.pageInfo.endCursor;
  } while (user.repositories.pageInfo.hasNextPage);

  user.repositories.nodes = repos;
  return user;
}

async function fetchGraphQL(graphqlQuery, variables) {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': `${username}-profile-stats`
    },
    body: JSON.stringify({ query: graphqlQuery, variables })
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join('\n'));
  }

  return payload;
}

async function updateReadme(block) {
  const readmePath = path.join(root, 'README.md');
  const readme = await readFile(readmePath, 'utf8');
  const start = '<!-- GITHUB-STATS:START -->';
  const end = '<!-- GITHUB-STATS:END -->';
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`);

  if (!pattern.test(readme)) {
    throw new Error(`README.md is missing ${start} / ${end} markers.`);
  }

  const nextReadme = readme.replace(pattern, `${start}\n${block}\n${end}`);
  await writeFile(readmePath, nextReadme, 'utf8');
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value || 0);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
