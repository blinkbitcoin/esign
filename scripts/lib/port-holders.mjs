// Who holds this worktree's ports (make ports) and what may be stopped
// (make ports-free). Pure: the CLI (scripts/e2e/ports.mjs) gathers the raw
// `lsof`, `docker ps` and `git worktree list` output and executes the plan;
// everything here is parsing and decisions, tested in port-holders.test.mjs.
import { basename } from 'node:path';
import { SERVICES } from './ports.mjs';

/** Metro's port: React Native's default, one per machine, outside the block */
export const METRO_PORT = 8081;

/**
 * Listening sockets from `lsof -nP -iTCP -sTCP:LISTEN -F pcn`: a `p<pid>`
 * line, its `c<command>`, then `f<fd>` / `n<addr>` pairs. One entry per
 * pid + port (the IPv4 and IPv6 sockets of one server collapse).
 */
export const parseLsofListeners = text => {
  const seen = new Set();
  const listeners = [];
  let pid;
  let command;
  for (const line of text.split('\n')) {
    const tag = line[0];
    const value = line.slice(1);
    if (tag === 'p') {
      pid = Number(value);
    } else if (tag === 'c') {
      command = value;
    } else if (tag === 'n') {
      const match = value.match(/:(\d+)$/);
      if (match && !seen.has(`${pid}:${match[1]}`)) {
        seen.add(`${pid}:${match[1]}`);
        listeners.push({ pid, command, port: Number(match[1]) });
      }
    }
  }
  return listeners;
};

/** pid → working directory from `lsof -a -p <pids> -d cwd -F pn` */
export const parseCwds = text => {
  const cwds = new Map();
  let pid;
  for (const line of text.split('\n')) {
    if (line[0] === 'p') {
      pid = Number(line.slice(1));
    } else if (line[0] === 'n') {
      cwds.set(pid, line.slice(1));
    }
  }
  return cwds;
};

/**
 * Containers from `docker ps --format` with the columns name, ports, compose
 * project, compose working dir and compose config files (tab-separated).
 * Host ports come out of `0.0.0.0:4312->5432/tcp, [::]:4312->5432/tcp`.
 */
export const parseDockerPs = text =>
  text
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => {
      const [
        name,
        ports = '',
        project = '',
        workingDir = '',
        configFiles = '',
      ] = line.split('\t');
      const hostPorts = [
        ...new Set([...ports.matchAll(/:(\d+)->/g)].map(m => Number(m[1]))),
      ];
      return { name, hostPorts, project, workingDir, configFiles };
    });

const under = (dir, root) => dir === root || dir.startsWith(`${root}/`);

/** Whose a directory is: this worktree, a sibling worktree of this repo, or nobody we know */
export const ownerOf = (dir, { worktrees, self }) => {
  if (!dir) {
    return 'foreign';
  }
  if (under(dir, self)) {
    return 'this worktree';
  }
  const sibling = worktrees.find(({ path }) => under(dir, path));
  return sibling ? `worktree ${basename(sibling.path)}` : 'foreign';
};

/**
 * One row per service of the block, plus Metro: the port and, when something
 * listens there, the holder. A container wins over the process (Docker's
 * own proxy is what lsof sees on the host).
 */
export const holders = ({
  ports,
  listeners,
  cwds,
  containers,
  worktrees,
  self,
}) => {
  const owner = dir => ownerOf(dir, { worktrees, self });
  const holderOf = port => {
    const container = containers.find(c => c.hostPorts.includes(port));
    if (container) {
      return {
        kind: 'container',
        label: container.project
          ? `${container.name} (compose ${container.project})`
          : container.name,
        project: container.project,
        configFiles: container.configFiles,
        owner: owner(container.workingDir),
      };
    }
    const listener = listeners.find(l => l.port === port);
    if (listener) {
      return {
        kind: 'process',
        label: `${listener.command} (pid ${listener.pid})`,
        pid: listener.pid,
        owner: owner(cwds.get(listener.pid)),
      };
    }
    return undefined;
  };
  const rows = Object.entries(SERVICES).map(([key, { env, what }]) => ({
    service: key,
    env,
    what,
    port: ports[key],
    holder: holderOf(ports[key]),
  }));
  rows.push({
    service: 'metro',
    env: '-',
    what: 'Metro (React Native default, one per machine, outside the block)',
    port: METRO_PORT,
    holder: holderOf(METRO_PORT),
    global: true,
  });
  return rows;
};

const pad = (text, width) => String(text).padEnd(width);

/** The table `make ports` prints */
export const renderPorts = (rows, { base, source, self }) => {
  const width = Math.max(...rows.map(r => r.service.length));
  const lines = [
    `port block ${base} (${source}) - ${self}`,
    `${pad('service', width)}  port   holder`,
  ];
  for (const { service, port, holder } of rows) {
    const held = holder ? `${holder.label} [${holder.owner}]` : '-';
    lines.push(`${pad(service, width)}  ${pad(port, 5)}  ${held}`);
  }
  return lines;
};

/**
 * What `make ports-free` stops: holders that belong to this worktree, plus
 * a sibling worktree's leftovers with `force`; never a foreign process. One
 * action per pid or compose project. Metro is stopped only when it is ours.
 */
export const freePlan = (rows, { force = false } = {}) => {
  const stop = [];
  const keep = [];
  const planned = new Set();
  for (const { port, holder, service } of rows) {
    if (!holder) {
      continue;
    }
    const ours = holder.owner === 'this worktree';
    const sibling = holder.owner.startsWith('worktree ');
    if (ours || (force && sibling)) {
      const id =
        holder.kind === 'container'
          ? `compose:${holder.project || holder.label}`
          : `pid:${holder.pid}`;
      if (!planned.has(id)) {
        planned.add(id);
        stop.push(
          holder.kind === 'container'
            ? {
                kind: 'compose-down',
                project: holder.project,
                configFiles: holder.configFiles,
                label: holder.label,
              }
            : { kind: 'kill', pid: holder.pid, label: holder.label },
        );
      }
    } else {
      keep.push({
        service,
        port,
        label: holder.label,
        reason: sibling
          ? `${holder.owner} - FORCE=1 stops it`
          : 'not this repo - stop it yourself',
      });
    }
  }
  return { stop, keep };
};
