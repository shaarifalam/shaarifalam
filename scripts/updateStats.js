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

const topRepos = repos
  .slice(0, 3)
  .map((repo) => `${repo.name} (${repo.stargazerCount} stars)`)
  .join(' • ') || 'No public repos yet';

const generatedAt = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC'
}).format(new Date());

const statsText = `shaarif@alam -----------------------------------------
OS............................. Web, Mobile, IoT, Linux
Uptime................................. 22+ years
Host.......................... UI/UX Designer, Frontend
Kernel.................... IoT Software Designer
IDE............................ Figma, VS Code, Blender

Languages.Programming........ ${topLanguages}
Languages.Computer........... HTML, CSS, React, Node.js
Languages.Real............... English, Hindi, Urdu

Hobbies.Software............. Dashboards, Design Systems
Hobbies.Hardware............. GPS, Fleet, IoT Devices

Contact
Email.Personal............... shaarifalam@gmail.com
GitHub....................... github.com/${user.login}
LinkedIn..................... linkedin.com/in/shaarifalam

GitHub Stats
Repos........................ ${formatNumber(user.repositories.totalCount)}
Contributions................ ${formatNumber(user.contributionsCollection.contributionCalendar.totalContributions)}
Stars........................ ${formatNumber(totals.stars)}
Followers.................... ${formatNumber(user.followers.totalCount)}
Forks........................ ${formatNumber(totals.forks)}
Commits...................... ${formatNumber(user.contributionsCollection.totalCommitContributions)}
PRs.......................... ${formatNumber(user.contributionsCollection.totalPullRequestContributions)}
Updated...................... ${generatedAt} UTC`;

await writeFile(
  path.join(root, 'assets', 'profile-card.svg'),
  createProfileCardSvg({ user, totals, topLanguages, generatedAt }),
  'utf8'
);
await writeFile(
  path.join(root, 'assets', 'terminal.svg'),
  createTerminalSvg({ user, totals, topLanguages, topRepos, generatedAt }),
  'utf8'
);

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

function createTerminalSvg({ user, totals, topLanguages, topRepos, generatedAt }) {
  const lines = [
    `${user.login}@github`,
    '──────────────────────────────',
    `Repos     : ${formatNumber(user.repositories.totalCount)}`,
    `Stars     : ${formatNumber(totals.stars)}`,
    `Forks     : ${formatNumber(totals.forks)}`,
    `Followers : ${formatNumber(user.followers.totalCount)}`,
    `Yearly    : ${formatNumber(user.contributionsCollection.contributionCalendar.totalContributions)} contributions`,
    `Commits   : ${formatNumber(user.contributionsCollection.totalCommitContributions)}`,
    `PRs       : ${formatNumber(user.contributionsCollection.totalPullRequestContributions)}`,
    `Languages : ${topLanguages}`,
    `Top Repos : ${topRepos}`,
    `Updated   : ${generatedAt} UTC`
  ];

  return `<svg width="760" height="430" viewBox="0 0 760 430" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="GitHub terminal stats for ${escapeXml(user.login)}">
  <defs>
    <linearGradient id="terminal-bg" x1="0" y1="0" x2="760" y2="430" gradientUnits="userSpaceOnUse">
      <stop stop-color="#111827"/>
      <stop offset="0.48" stop-color="#172554"/>
      <stop offset="1" stop-color="#064E3B"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#020617" flood-opacity="0.35"/>
    </filter>
  </defs>
  <rect width="760" height="430" rx="18" fill="url(#terminal-bg)"/>
  <rect x="26" y="24" width="708" height="382" rx="14" fill="#020617" fill-opacity="0.84" stroke="#38BDF8" stroke-opacity="0.35" filter="url(#shadow)"/>
  <circle cx="58" cy="55" r="7" fill="#F87171"/>
  <circle cx="82" cy="55" r="7" fill="#FBBF24"/>
  <circle cx="106" cy="55" r="7" fill="#34D399"/>
  <text x="42" y="96" fill="#E5E7EB" font-family="SFMono-Regular, Consolas, Liberation Mono, monospace" font-size="21" font-weight="700">${escapeXml(lines[0])}</text>
  ${lines
    .slice(1)
    .map((line, index) => {
      const y = 128 + index * 24;
      const color = index === 0 ? '#38BDF8' : index % 3 === 0 ? '#A7F3D0' : '#CBD5E1';
      return `<text x="42" y="${y}" fill="${color}" font-family="SFMono-Regular, Consolas, Liberation Mono, monospace" font-size="18">${escapeXml(line)}</text>`;
    })
    .join('\n  ')}
</svg>
`;
}

function createProfileCardSvg({ user, totals, topLanguages, generatedAt }) {
  const asciiLines = [
    '&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&%%',
    '&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&%%',
    '&&&&&&&&&&&&&&&&&&&&&&&&&&%%&&&%&%%&%&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&&%%',
    '&&&&&&&&&&&&&&&&&&&&&&&&%%%#%##%#(#*.,*/%&&&&&&&&&&&&&&&&&&&&&&&&&&&%%',
    '&&&&&&&&&&&&&&&&&&&&&%%%%(,,,......  ...,**%&&&&&&&&&&&&&&&&&&&&&&&&%%',
    '&&&&&&&&&&&&&&&&&&&%%#(*,,*,  ,.    ....,/,.(%&&&&&&&&&&&&&&&&&&&&&&%%',
    '&&&&&&&&&&&&&&&%%%%%#*,,,.... ,.   .  . .   ./%&&&&&&&&&&&&&&&&&&&&%%%',
    '&&&&&&&&&&&&&&&&%%%%#*,,.....  ,.    .        /%&&&&&&&&&&&&&&&&&&&%%%',
    '&&&&&&&&&&&&&&&&&%%%%*,... .  ...    .        (%&&&&&&&&&&&&&&&&&&&%%%',
    '&&&&&&&&&&&&&&&%&%%%%(,./,,/(/,. .*,. ..     .%&&&&&&&&&&&&&&&&&&&&%%%',
    '&&&&&&&&&&&&&&&&&&%%%%(.#(,/**/(/*...,,*,     %&&&&&&&&&&&&&&&&&&&&%%%',
    '&&&&&&&&&&&&&&&&&&&&&%%(##((//(#(,,,/*,,,,,  /&&&&&&&&&&&&&&&&&&&&&%%%',
    '&&&&&&&&&&&&&&&&&&&&&&&(#%%%%##%#(//(((((*,.,*(&&&&&&&&&&&&&&&&&&&&%%%',
    '&&&&&&&&&&&&&&&&&&&&&&&(#%%%%%(((*.*((((/*,.,/#&&&&&&&&&&&&&&&&&&&&%%%',
    '&&&&&&&&&&&&&&&&&&&&&&&%/(##/(((///**,**,,.,#%&&&&&&&&&&&&&&&&&&&&&%%%',
    '&&&&&&&&&&&&&&&&&&&&&&&%(*/#####((*///*.   %&&&&&&&&&&&&&&&&&&&&&&&%%%',
    '&&&&&&&&&&&&&&&&&&&&&&&&&%./####*.*//*.   ,&&&&&&&&&&&&&&&&&&&&&&&&%%%',
    '&&&&&&&&&&&&&&&&&&&&&&&&&&%%*...       .,,,.  #&&&&&&&&&&&&&&&&&&&&%%%',
    '&&&&&&&&&&&&&&&&&&&&&&&&&&%*(#(*..,**,****.     /&&&&&&&&&&&&&&&&&&%%%',
    '&&&&&&&&&&&&&&&&&&&&&&&&&%%..#####((/(/*           ..,%&&&&&&&&&&&&%%%',
    '%%%%%%%%&&%&&&&&&&&&&%%/*,,, .(##(((/.                ...../%&&&&&&%%%',
    '%%%%%%%%%%%%%%%%%%**,,,,,.                      ...........   .,&&&%%%',
    '%%%%%%%%%%%%%%*,,,,,,,,,  ............ ....................      .%%%%',
    '%%%%%%%%%%%%,,,..,,,,,,,,,,.,,,,..........................   .     %%%',
    '%%%%%%%%%%%,,.,..,,,,,,,,,,,,,,,................... ....     .     .%%',
    '%%%%%%%%%%,,..,..,,,,,,,...,,.....,................  ...     .      /%',
    '%%%%%%%%%%.. ...,,,,,,.,,........................... ..            . #',
    '%%%%%%%%%#..  ,,.,,,,,.................................           .. .'
  ];

  const rows = [
    ['OS', 'Web, Mobile, IoT, Linux', 'blue'],
    ['Uptime', '22+ years', 'blue'],
    ['Host', 'UI/UX Designer, Frontend', 'blue'],
    ['Kernel', 'IoT Software Designer', 'blue'],
    ['IDE', 'Figma, VS Code, Blender', 'blue'],
    null,
    ['Languages.Programming', topLanguages, 'body'],
    ['Languages.Computer', 'HTML, CSS, React, Node.js', 'body'],
    ['Languages.Real', 'English, Hindi, Urdu', 'body'],
    null,
    ['Hobbies.Software', 'Dashboards, Design Systems', 'body'],
    ['Hobbies.Hardware', 'GPS, Fleet, IoT Devices', 'body'],
    null,
    ['Contact', '', 'heading'],
    ['Email.Personal', 'shaarifalam@gmail.com', 'blue'],
    ['GitHub', `github.com/${user.login}`, 'blue'],
    ['LinkedIn', 'linkedin.com/in/shaarifalam', 'blue'],
    null,
    ['GitHub Stats', '', 'heading'],
    ['Repos', formatNumber(user.repositories.totalCount), 'green'],
    ['Contributions', formatNumber(user.contributionsCollection.contributionCalendar.totalContributions), 'green'],
    ['Stars', formatNumber(totals.stars), 'blue'],
    ['Followers', formatNumber(user.followers.totalCount), 'red'],
    ['Updated', `${generatedAt} UTC`, 'body']
  ];

  const rightX = 330;
  const valueX = 570;
  let y = 92;
  const rightRows = rows
    .map((row) => {
      if (!row) {
        y += 12;
        return '';
      }

      const [label, value, type] = row;

      if (type === 'heading') {
        const heading = `<text x="${rightX}" y="${y}" fill="#c9d1d9" font-weight="700">${escapeXml(label)}</text>`;
        y += 18;
        return heading;
      }

      const valueColor = type === 'green' ? '#7ee787' : type === 'red' ? '#ff7b72' : type === 'blue' ? '#79c0ff' : '#c9d1d9';
      const dotted = '.'.repeat(Math.max(3, 32 - label.length));
      const line = `<text x="${rightX}" y="${y}" fill="#f0a45d">${escapeXml(label)}</text><text x="${rightX + label.length * 8}" y="${y}" fill="#30363d">${dotted}</text><text x="${valueX}" y="${y}" fill="${valueColor}">${escapeXml(value)}</text>`;
      y += 16;
      return line;
    })
    .filter(Boolean)
    .join('\n    ');

  const ascii = asciiLines
    .map((line, index) => `<text x="28" y="${68 + index * 11}" xml:space="preserve">${escapeXml(line)}</text>`)
    .join('\n    ');

  return `<svg width="820" height="460" viewBox="0 0 820 460" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Shaarif Alam README terminal profile">
  <rect width="820" height="460" fill="#0d1117"/>
  <text x="16" y="28" fill="#8b949e" font-family="SFMono-Regular, Consolas, Liberation Mono, monospace" font-size="12">shaarifalam / README.md</text>
  <rect x="16" y="44" width="788" height="396" rx="4" fill="#111820" stroke="#30363d"/>
  <g font-family="SFMono-Regular, Consolas, Liberation Mono, monospace" font-size="6.8" fill="#c9d1d9">
    ${ascii}
  </g>
  <g font-family="SFMono-Regular, Consolas, Liberation Mono, monospace" font-size="12">
    <text x="${rightX}" y="68" fill="#c9d1d9" font-weight="700">shaarif@alam</text>
    <text x="424" y="68" fill="#8b949e">---------------------------------</text>
    ${rightRows}
  </g>
</svg>
`;
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
