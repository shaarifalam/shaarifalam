import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const assetDir = path.join(root, 'README-assets');
const asciiPath = path.join(assetDir, 'ascii-art (1).txt');
const cardPath = path.join(assetDir, 'profile-card.svg');

const username =
  process.env.GITHUB_USERNAME ||
  process.env.GITHUB_REPOSITORY_OWNER ||
  'shaarifalam';

const token = process.env.PROFILE_STATS_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const usePlaceholder = process.argv.includes('--placeholder');
const now = new Date();
const uptimeStart = new Date(process.env.UPTIME_START || '2001-07-03T00:00:00Z');

const query = `
  query ProfileStats($login: String!, $cursor: String) {
    user(login: $login) {
      login
      createdAt
      followers { totalCount }
      following { totalCount }
      repositories(
        first: 100
        after: $cursor
        ownerAffiliations: OWNER
        isFork: false
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
        contributionCalendar {
          totalContributions
        }
      }
    }
  }
`;

const contributionsQuery = `
  query Contributions($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
        contributionCalendar {
          totalContributions
        }
      }
    }
  }
`;

const user = usePlaceholder
  ? createPlaceholderUser(username)
  : token
    ? await fetchProfileStats(username)
    : await fetchPublicProfileStats(username);
const totals = user.repositories.nodes.reduce(
  (acc, repo) => {
    acc.stars += repo.stargazerCount;
    acc.forks += repo.forkCount;
    return acc;
  },
  { stars: 0, forks: 0 }
);

const generatedAt = usePlaceholder
  ? 'Waiting'
  : new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC'
    }).format(now);
const uptime = formatElapsedTime(uptimeStart, now);
const asciiLines = await readAsciiArt();

await mkdir(assetDir, { recursive: true });
await writeFile(
  cardPath,
  createProfileCardSvg({ user, totals, generatedAt, uptime, asciiLines }),
  'utf8'
);
await updateReadme();

console.log(`Updated README card for ${user.login}.`);

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
  user.contributionsCollection = await fetchAllTimeContributions(
    login,
    new Date(user.createdAt),
    now
  );
  return user;
}

async function fetchAllTimeContributions(login, fromDate, toDate) {
  const totals = {
    totalCommitContributions: 0,
    contributionCalendar: {
      totalContributions: 0
    }
  };

  for (let year = fromDate.getUTCFullYear(); year <= toDate.getUTCFullYear(); year += 1) {
    const from = new Date(Date.UTC(year, 0, 1));
    const to = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
    const boundedFrom = from < fromDate ? fromDate : from;
    const boundedTo = to > toDate ? toDate : to;

    const payload = await fetchGraphQL(contributionsQuery, {
      login,
      from: boundedFrom.toISOString(),
      to: boundedTo.toISOString()
    });
    const collection = payload.data?.user?.contributionsCollection;

    if (collection) {
      totals.totalCommitContributions += collection.totalCommitContributions || 0;
      totals.contributionCalendar.totalContributions +=
        collection.contributionCalendar?.totalContributions || 0;
    }
  }

  return totals;
}

async function fetchPublicProfileStats(login) {
  const profile = await fetchRest(`https://api.github.com/users/${encodeURIComponent(login)}`);
  const repos = await fetchPublicRepos(login);
  const commitCount = await fetchPublicCommitCount(login);
  const contributionCount = await fetchPublicContributionCount(login, new Date(profile.created_at), now);

  return {
    login: profile.login,
    followers: { totalCount: profile.followers },
    following: { totalCount: profile.following },
    repositories: {
      totalCount: profile.public_repos,
      nodes: repos
    },
    contributionsCollection: {
      totalCommitContributions: commitCount,
      contributionCalendar: {
        totalContributions: contributionCount
      }
    }
  };
}

async function fetchPublicContributionCount(login, fromDate, toDate) {
  let total = 0;

  for (let year = fromDate.getUTCFullYear(); year <= toDate.getUTCFullYear(); year += 1) {
    total += await fetchPublicContributionYear(login, year);
  }

  return total;
}

async function fetchPublicContributionYear(login, year) {
  try {
    const html = await fetchText(
      `https://github.com/users/${encodeURIComponent(login)}/contributions?from=${year}-01-01&to=${year}-12-31`
    );
    const counts = [...html.matchAll(/data-count="(\d+)"/g)].map((match) => Number(match[1]));

    return counts.reduce((sum, count) => sum + count, 0);
  } catch {
    return 0;
  }
}

async function fetchPublicCommitCount(login) {
  try {
    const payload = await fetchRest(
      `https://api.github.com/search/commits?q=author:${encodeURIComponent(login)}`,
      { accept: 'application/vnd.github.cloak-preview+json' }
    );

    return payload.total_count || 0;
  } catch {
    return 0;
  }
}

async function fetchPublicRepos(login) {
  const repos = [];
  let page = 1;

  while (true) {
    const pageRepos = await fetchRest(
      `https://api.github.com/users/${encodeURIComponent(login)}/repos?per_page=100&type=owner&sort=updated&page=${page}`
    );

    repos.push(
      ...pageRepos
        .filter((repo) => !repo.fork)
        .map((repo) => ({
          name: repo.name,
          stargazerCount: repo.stargazers_count,
          forkCount: repo.forks_count,
          primaryLanguage: repo.language ? { name: repo.language } : null
        }))
    );

    if (pageRepos.length < 100) {
      return repos;
    }

    page += 1;
  }
}

async function fetchRest(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: options.accept || 'application/vnd.github+json',
      'User-Agent': `${username}-profile-stats`
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub REST request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html',
      'User-Agent': `${username}-profile-stats`
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub page request failed: ${response.status} ${response.statusText}`);
  }

  return response.text();
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

async function updateReadme() {
  const readmePath = path.join(root, 'README.md');
  const readme = await readFile(readmePath, 'utf8');
  const nextReadme = `<p align="center">
  <img src="./README-assets/profile-card.svg" alt="Shaarif Alam README terminal profile" width="100%" />
</p>
`;

  if (readme === nextReadme) {
    return;
  }

  await writeFile(readmePath, nextReadme, 'utf8');
}

async function readAsciiArt() {
  const ascii = await readFile(asciiPath, 'utf8');
  return ascii
    .replaceAll('\u00a0', ' ')
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
}

function createProfileCardSvg({ user, totals, generatedAt, uptime, asciiLines }) {
  const rows = [
    ['OS', 'Web, Mobile, Embedded, Linux', 'blue'],
    ['Uptime', uptime, 'blue'],
    ['Host', 'UI/UX Designer, Frontend', 'blue'],
    ['Kernel', 'IoT Software Designer', 'blue'],
    ['IDE', 'Figma, VS Code', 'blue'],
    null,
    ['Embedded.Systems', 'GPS • GSM • BLE • RFID • IoT Sensors', 'body'],
    ['Mechanical.CAD', 'SolidWorks • Blender', 'body'],
    ['Frontend.Stack', 'React • TypeScript • Tailwind CSS', 'body'],
    ['Design.Systems', 'Figma • UI/UX • Component Libraries', 'body'],
    ['Mapping.Tech', 'Google Maps • Mapbox • GIS', 'body'],
    ['Cloud.Services', 'GitHub • Vercel • Firebase', 'body'],
    ['Data.Storage', 'MySQL • PostgreSQL • Firebase', 'body'],
    ['Protocols', 'MQTT • REST API • WebSocket', 'body'],
    ['Industry.Focus', 'Fleet Management • Telematics • Asset Tracking', 'body'],
    ['Current.Mission', 'Building intelligent IoT experiences', 'green'],
    null,
    ['Contact', '', 'heading'],
    ['Email.Personal', 'shaarifalam@gmail.com', 'blue'],
    ['GitHub', `github.com/${user.login}`, 'blue'],
    ['LinkedIn', 'linkedin.com/in/shaarifalam', 'blue'],
    ['Discord', 'shaarifalam', 'blue'],
    null,
    ['GitHub Stats', '', 'heading'],
    ['Repos', formatNumber(user.repositories.totalCount), 'green'],
    ['Stars', formatNumber(totals.stars), 'body'],
    ['Commits', formatNumber(user.contributionsCollection.totalCommitContributions), 'blue'],
    ['Followers', formatNumber(user.followers.totalCount), 'body'],
    ['Contributions', formatNumber(user.contributionsCollection.contributionCalendar.totalContributions), 'blue'],
    ['Updated', generatedAt, 'green']
  ];

  return `<svg width="960" height="540" viewBox="0 0 960 540" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Shaarif Alam README terminal profile">
  <rect width="960" height="540" fill="#0d1117"/>
  <text x="18" y="27" fill="#7d8590" font-family="SFMono-Regular, Consolas, Liberation Mono, monospace" font-size="11">shaarifalam / README.md</text>
  <rect x="18" y="47" width="924" height="465" rx="6" fill="#111820" stroke="#30363d"/>
  <g font-family="SFMono-Regular, Consolas, Liberation Mono, monospace">
    <g font-size="1.95" font-weight="700" fill="#c9d1d9" transform="matrix(1.9 0 0 1 -37.8 0)">
      ${asciiLines.map((line, index) => `<text x="42" y="${76 + index * 5.2}" xml:space="preserve">${escapeXml(line)}</text>`).join('\n      ')}
    </g>
    <g font-size="11.2">
      <text x="430" y="78" fill="#c9d1d9" font-weight="700">shaarif@alam</text>
      <text x="544" y="78" fill="#7d8590">-----------------------------------------------</text>
      ${renderInfoRows(rows)}
    </g>
  </g>
</svg>
`;
}

function renderInfoRows(rows) {
  let y = 101;
  const labelX = 430;
  const valueX = 650;
  const valueMaxWidth = 255;
  const charWidth = 6.7;

  return rows
    .map((row) => {
      if (!row) {
        y += 8;
        return '';
      }

      const [label, value, type] = row;

      if (type === 'heading') {
        const line = `<text x="${labelX}" y="${y}" fill="#c9d1d9" font-weight="700">${escapeXml(label)}</text>`;
        y += 13;
        return line;
      }

      const labelWidth = label.length * charWidth;
      const dotCount = Math.max(3, Math.floor((valueX - labelX - labelWidth) / charWidth));
      const valueColor = type === 'green' ? '#7ee787' : type === 'blue' ? '#79c0ff' : '#c9d1d9';
      const valueTextLength = String(value).length * 6.2;
      const fitAttrs =
        valueTextLength > valueMaxWidth
          ? ` textLength="${valueMaxWidth}" lengthAdjust="spacingAndGlyphs"`
          : '';
      const line = `<text x="${labelX}" y="${y}" fill="#f0a45d">${escapeXml(label)}</text><text x="${labelX + labelWidth}" y="${y}" fill="#30363d">${'.'.repeat(dotCount)}</text><text x="${valueX}" y="${y}" fill="${valueColor}"${fitAttrs}>${escapeXml(value)}</text>`;
      y += 14;
      return line;
    })
    .filter(Boolean)
    .join('\n      ');
}

function createPlaceholderUser(login) {
  return {
    login,
    followers: { totalCount: 0 },
    following: { totalCount: 0 },
    repositories: {
      totalCount: 0,
      nodes: [
        { name: 'profile', stargazerCount: 0, forkCount: 0, primaryLanguage: { name: 'JavaScript' } },
        { name: 'design-system', stargazerCount: 0, forkCount: 0, primaryLanguage: { name: 'TypeScript' } }
      ]
    },
    contributionsCollection: {
      totalCommitContributions: 0,
      contributionCalendar: {
        totalContributions: 0
      }
    }
  };
}

function formatElapsedTime(start, end) {
  if (Number.isNaN(start.getTime()) || start > end) {
    return '22+ years';
  }

  let cursor = new Date(start);
  let years = 0;
  let months = 0;

  while (addUtcYears(cursor, 1) <= end) {
    cursor = addUtcYears(cursor, 1);
    years += 1;
  }

  while (addUtcMonths(cursor, 1) <= end) {
    cursor = addUtcMonths(cursor, 1);
    months += 1;
  }

  let remainingMs = end.getTime() - cursor.getTime();
  const days = Math.floor(remainingMs / 86_400_000);
  remainingMs -= days * 86_400_000;
  const hours = Math.floor(remainingMs / 3_600_000);
  remainingMs -= hours * 3_600_000;
  const minutes = Math.floor(remainingMs / 60_000);
  remainingMs -= minutes * 60_000;
  const seconds = Math.floor(remainingMs / 1_000);

  return `${years}y ${months}mo ${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function addUtcYears(date, years) {
  const next = new Date(date);
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}

function addUtcMonths(date, months) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value || 0);
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
