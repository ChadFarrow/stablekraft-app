module.exports = {
  apps: [
    {
      name: 'stablekraft-app',
      script: 'npm',
      args: 'start',
      cwd: '/var/www/re.podtards.com',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        BUNNY_CDN_HOSTNAME: 're-podtards-cdn.b-cdn.net',
        BUNNY_CDN_ZONE: 're-podtards-cdn'
      },
      error_file: '/var/log/stablekraft-app-error.log',
      out_file: '/var/log/stablekraft-app-out.log',
      log_file: '/var/log/stablekraft-app-combined.log',
      time: true
    }
  ]
}; 