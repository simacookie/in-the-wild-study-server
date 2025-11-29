Problem:
After upgrading to docker version 29.0.0, the API version is 1.52 (minimum version 1.44).
Traefik uses 1.24 so it has stopped working

---

Solution: 
https://community.traefik.io/t/traefik-stops-working-it-uses-old-api-version-1-24/29019

Set Minimum Docker API Version

If you prefer to keep Docker 29, you can set the minimum API version so Traefik works correctly.

Create or edit the systemd override file:

sudo vim /etc/systemd/system/docker.service.d/min_api_version.conf

Add the following content:

[Service]
Environment="DOCKER_MIN_API_VERSION=1.24"

Reload systemd and restart Docker:

sudo systemctl daemon-reload
sudo systemctl restart docker

Verify the environment variable is applied:

sudo systemctl show docker | grep DOCKER_MIN_API_VERSION