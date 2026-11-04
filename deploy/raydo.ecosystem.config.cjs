/**
 * pm2 config for raydo.in (/root/raydo-new, port from Backend/.env).
 *
 * One API process, not a cluster: the SP booking scheduler and the socket namespace are
 * singletons, so a second worker would double every vendor alert. Sockets ride the API
 * port, so nginx proxies /socket.io/ there too.
 *
 * Start:   pm2 startOrReload deploy/raydo.ecosystem.config.cjs --env production --update-env
 */
const env = { NODE_ENV: 'production' };

module.exports = {
  apps: [
    {
      name: 'raydo-api',
      cwd: '/root/raydo-new/Backend',
      script: 'server.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '20s',
      max_memory_restart: '800M',
      watch: false,
      merge_logs: true,
      time: true,
      kill_timeout: 12000,
      env,
      env_production: env,
    },
    {
      // All six BullMQ consumers; see src/queues/workers/index.js.
      name: 'raydo-workers',
      cwd: '/root/raydo-new/Backend',
      script: 'src/queues/workers/index.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '20s',
      max_memory_restart: '500M',
      watch: false,
      merge_logs: true,
      time: true,
      kill_timeout: 20000,
      env,
      env_production: env,
    },
  ],
};
