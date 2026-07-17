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

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const usePlaceholder = process.argv.includes('--placeholder');

const query = `
  query ProfileStats($login: String!, $cursor: String) {
    user(login: $login) {
      login
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
        contributionCalendar {
          totalContributions
        }
      }
    }
  }
`;

if (!token && !usePlaceholder) {
  console.error('Missing GITHUB_TOKEN or GH_TOKEN.');
  console.error('Run `npm run update-stats -- --placeholder` to render a local placeholder card.');
  process.exit(1);
}

const user = usePlaceholder ? createPlaceholderUser(username) : await fetchProfileStats(username);
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
    }).format(new Date());
const asciiLines = await readAsciiArt();

await mkdir(assetDir, { recursive: true });
await writeFile(
  cardPath,
  createProfileCardSvg({ user, totals, generatedAt, asciiLines }),
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

function createProfileCardSvg({ user, totals, generatedAt, asciiLines }) {
  const rows = [
    ['OS', 'Web, Mobile, Embedded, Linux', 'blue'],
    ['Uptime', '22+ years', 'blue'],
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
    ['Current.Mission', 'Building intelligent IoT experiences 🚀', 'green'],
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

  return `<svg width="1200" height="540" viewBox="0 0 1200 540" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Shaarif Alam README terminal profile">
  <rect width="1200" height="540" fill="#0d1117"/>
  <text x="18" y="27" fill="#7d8590" font-family="SFMono-Regular, Consolas, Liberation Mono, monospace" font-size="11">shaarifalam / README.md</text>
  <rect x="18" y="47" width="1164" height="465" rx="6" fill="#111820" stroke="#30363d"/>
  <g font-family="SFMono-Regular, Consolas, Liberation Mono, monospace">
    <g font-size="2.12" font-weight="700" fill="#c9d1d9">
      ${asciiLines.map((line, index) => `<text x="38" y="${76 + index * 4.55}" xml:space="preserve">${escapeXml(line)}</text>`).join('\n      ')}
    </g>
    <g font-size="8.2">
      <text x="380" y="78" fill="#c9d1d9" font-weight="700">shaarif@alam</text>
      <text x="492" y="78" fill="#7d8590">----------------------------------------------------------------</text>
      ${renderInfoRows(rows)}
    </g>
  </g>
</svg>
`;
}

function renderInfoRows(rows) {
  let y = 102;
  const labelX = 380;
  const valueX = 595;

  return rows
    .map((row) => {
      if (!row) {
        y += 10;
        return '';
      }

      const [label, value, type] = row;

      if (type === 'heading') {
        const line = `<text x="${labelX}" y="${y}" fill="#c9d1d9" font-weight="700">${escapeXml(label)}</text>`;
        y += 13;
        return line;
      }

      const labelWidth = label.length * 4.9;
      const dotCount = Math.max(3, Math.floor((valueX - labelX - labelWidth) / 4.9));
      const valueColor = type === 'green' ? '#7ee787' : type === 'blue' ? '#79c0ff' : '#c9d1d9';
      const line = `<text x="${labelX}" y="${y}" fill="#f0a45d">${escapeXml(label)}</text><text x="${labelX + labelWidth}" y="${y}" fill="#30363d">${'.'.repeat(dotCount)}</text><text x="${valueX}" y="${y}" fill="${valueColor}">${escapeXml(value)}</text>`;
      y += 12.5;
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
