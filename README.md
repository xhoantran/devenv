# @new-wave/devenv

Dev environment framework — bare metal to running workspace in one command.

Define your services, repos, and projects in a single YAML file, then run `devenv up` to clone repos, start services, build, and run everything in dependency order.

## Install

```bash
npm install -g @new-wave/devenv
```

## Quick Start

Create a `devenv.yml` in your workspace root:

```yaml
name: my-app

repos:
  backend:
    url: https://github.com/org/backend
  frontend:
    url: https://github.com/org/frontend

services:
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
    ready: redis-cli ping

projects:
  backend:
    repo: backend
    runtime: java
    setup: ./mvnw clean package -DskipTests
    run: ./mvnw spring-boot:run
    port: 8080
    depends_on: [redis]

  frontend:
    repo: frontend
    runtime: node
    setup: npm install
    run: npm run dev
    port: 5173
    depends_on: [backend]
```

Then run:

```bash
devenv up
```

## Commands

| Command | Description |
| --- | --- |
| `devenv up` | Full setup: install packages → clone repos → start services → build → run |
| `devenv down` | Stop all running services and projects |
| `devenv services` | Start only services (Docker containers, Supabase) |
| `devenv status` | Show running services and projects |

### Options

```
-c, --config <path>   Config file path (default: devenv.yml)
-d, --dir <path>      Working directory for repos (default: .)
-t, --token <token>   GitHub token for private repos
--skip-system          Skip system package installation
```

## Configuration

### `system`

Install system packages and language runtimes.

```yaml
system:
  packages: [make, git, curl]
  runtimes:
    node: 20
    java: 21
    python: 3.11
```

Auto-detects the OS package manager (apt, yum, dnf, brew, apk).

### `repos`

Git repositories to clone.

```yaml
repos:
  api:
    url: https://github.com/org/api
    branch: develop  # default: main
```

### `services`

Docker containers and Supabase instances.

```yaml
services:
  # Docker service
  postgres:
    image: postgres:16-alpine
    ports: ["5432:5432"]
    env:
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes: ["/var/lib/postgresql/data"]
    ready: pg_isready

  # Supabase service
  supabase:
    type: supabase
    config: ${repos.core-infra}/supabase
```

### `projects`

Applications to build and run. Supported runtimes: `node`, `java`, `python`, `go`.

```yaml
projects:
  api:
    repo: api
    runtime: java
    setup: ./mvnw clean package
    run: ./mvnw spring-boot:run
    port: 8080
    depends_on: [supabase, redis]
    env:
      SPRING_PROFILES_ACTIVE: local
      SUPABASE_URL: ${supabase.url}
    env_file: .env.local
```

Set `run: skip` for projects that only need a build step.

### Variable Interpolation

Reference environment variables, repo paths, and service outputs in your config:

```yaml
env:
  API_KEY: ${MY_API_KEY}              # Environment variable
  INFRA_PATH: ${repos.core-infra}     # Path to cloned repo
  DB_URL: ${supabase.db_url}          # Service output
  ANON_KEY: ${supabase.anon_key}      # Service output
```

## Example

See [example.devenv.yml](example.devenv.yml) for a full multi-service configuration with Supabase, LocalStack, Redis, and four projects across Java, Node.js, and Python.

## License

MIT
