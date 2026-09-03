upstream web { server web:3000; }
upstream api { server api:3001; }

server {
  listen 80;
  server_name ${DOMAIN} www.${DOMAIN};
  location /.well-known/acme-challenge/ { root /var/www/certbot; }
  location / { return 301 https://$host$request_uri; }
}

server {
  listen 443 ssl http2;
  server_name ${DOMAIN} www.${DOMAIN};

  ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;

  add_header Strict-Transport-Security "max-age=31536000" always;
  add_header X-Content-Type-Options nosniff;
  add_header X-Frame-Options DENY;
  add_header Referrer-Policy strict-origin-when-cross-origin;

  client_max_body_size 60m;

  location /widget.js { proxy_pass http://web/widget.js; }
  location /sdk/wacalls.js { proxy_pass http://web/sdk/wacalls.js; }
  location /widget/ { proxy_pass http://api; }
  location /api/ {
    proxy_pass http://api;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
  location /health { proxy_pass http://api/health; }
  location /ready { proxy_pass http://api/ready; }
  location /ws {
    proxy_pass http://api/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
  location / {
    proxy_pass http://web;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
