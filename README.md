This is a search engine tailored for developer documentation.

If on GitHub.com, use the table of contents ↗️

## Local development

Requirements:

- [Node.js](https://nodejs.org/en/download) 22 (LTS)
- [Docker](https://docs.docker.com/get-started/get-docker/) (with [Docker Compose](https://docs.docker.com/compose/))

Development is configured for [VSCode](https://code.visualstudio.com/Download).

Spin up service dependencies with docker compose.

```bash
docker-compose up -d
```

Migrations are run automatically for Postgres.

Run the http requests in `configure_opensearch.http` to configure OpenSearch (use the recommended `humao.rest-client` VSCode extension to run from within the editor).

After dependencies are running and configured, use the launch tasks to run the web server and crawler(s).

| Service                   | URL                   |
| ------------------------- | --------------------- |
| Application Web Interface | http://localhost:3000 |
| OpenSearch Dashboards     | http://localhost:5601 |
| DB Adminer                | http://localhost:8080 |

The local postgres db uses defaults (username: `postgres`, database: `postgres`), and `password` for password.

## Deploying

This project is deployed to a managed DigitalOcean Kubernetes cluster using Helm.

### Initial setup

This expects a managed DigitalOcean Kubernetes cluster to be set up, and locally accessible via kubectl.

First, deploy these Kubernetes secrets:

```yaml
kind: Secret
type: kubernetes.io/dockerconfigjson
apiVersion: v1
metadata:
  name: dockerconfigjson-github-com
stringData:
  .dockerconfigjson: |
    {"auths":{"ghcr.io":{"auth":"..."}}}


# the value for auth is base64 encoded "username:ghp_...." with a github access token
---
apiVersion: v1
kind: Secret
metadata:
  name: postgres-secret
stringData:
  POSTGRES_USER: postgres
  POSTGRES_PASSWORD: ... # a secure password
  POSTGRES_DB: postgres
  PGDATA: /var/lib/postgresql/data/pgdata
```

Helm is used to manage deployment.

```bash
helm dependency update
helm install --values ./values.yaml --set 'email=$EMAIL' $DEPLOYMENT_NAME .
```

Initial postgres migrations are automated, but subsequent migrations are manual.

```bash
# connect to the postgres instance
kubectl port-forward service/postgres 5432

# ---

# from the migrations dir
cd postgres_migrations/
# use an environment with psql (I don't have it locally)
docker run -v $PWD:/app -w /app --rm -it --entrypoint bash --network=host postgres
# run a migration - this assumes macOS docker
psql -h host.docker.internal -U postgres -d postgres --password -a -f ./migrate_{number}.sql
```

Run the http requests in `configure_opensearch.http` to configure OpenSearch (use the recommended `humao.rest-client` VSCode extension to run from within the editor), after port forwarding to the cluster.

```bash
# connect to the opensearch cluster
kubectl port-forward service/opensearch-cluster-master 9200
```

### Upgrades

Use helm to upgrade the deployment environment and configuration.

```bash
helm upgrade --values ./values.yaml --set 'email=$EMAIL' $DEPLOYMENT_NAME .
```

Use `kubectl` to redeploy jobs with new code.

```bash
kubectl rollout restart deployment/web-server
kubectl rollout restart deployment/page-scraper
```

## Monitoring

Monitoring is not robust currently.

Kubernetes logs are available.

An opensearch dashboard is running without auth. Port forward and visit http://localhost:5601 to use it.

```bash
kubectl port-forward service/prod-opensearch-dashboards 5601
```

## Data dump

If restoring to a live environment, you should take everything down first, to drop connections to the database.

```bash
kubectl scale deployment page-scraper --replicas=0
kubectl scale deployment web-server --replicas=0
```

Also remember to connect to the services appropriately (e.g. port forwarding with `kubectl`).

### Postgres

Use `pg_dump` and `pg_restore` to dump and restore data.

Example to dump:

```bash
docker run -v "$PWD:/app" -w /app --rm -it --entrypoint bash --network=host postgres
pg_dump -h host.docker.internal -U postgres > ./bulk_data/postgres.sql
```

Example to restore:

```bash
docker run -v "$PWD:/app" -w /app --rm -it --entrypoint bash --network=host postgres
dropdb -h host.docker.internal -U postgres postgres
createdb -h host.docker.internal -U postgres postgres
psql -h host.docker.internal -U postgres -d postgres -f ./bulk_data/postgres.sql
```

### OpenSearch

Use [`elasticdump`](https://github.com/elasticsearch-dump/elasticsearch-dump). This'll take a while, as this contains full text data.

Example to dump:

```bash
npx elasticdump \
  --type=data \
  --input=http://localhost:9200/page_content_1 \
  --output=./bulk_data/opensearch-data.json
```

Example to restore;

```bash
npx elasticdump \
  --type data \
  --input ./bulk_data/opensearch-data.json \
  --output http://localhost:9200/page_content_1
```

## Architecture

This system is deployed to a Kubernetes cluster, for simpler management (e.g. rolling deployment, file driven configuration, and networking).

Two applications drive the custom logic. One is a simple [web server](./web_server/) and the other is a [page scraper](./crawlers/page_scraper/).

We use cert-manager, Lets Encrypt, and NGINX to handle external network ingress, TLS, etc.

Two databases are used. Postgres acts as a queue, storing URLs discovered and scraped, and serves as a record for the sites we're allowed to scrape. OpenSearch is our search database, responsible for indexing and searching documents.

```mermaid
graph TD
  subgraph Kubernetes Cluster
    WebServer@{shape: procs, label: "<b>Web Server</b>"}
    PageScraper@{shape: procs, label: "<b>Page Scraper</b>"}
    Postgres[Postgres]
    OpenSearch@{shape: procs, label: OpenSearch Cluster}
    OpenSearchDash[OpenSearch Dashboards]
    CertManager[cert-manager]
    IngressNginx[NGINX Ingress Controller]
    PGPersistentVolume@{shape: lin-cyl, label: DigitalOcean Block Storage}
    OSPersistentVolume@{shape: cyl, label: DigitalOcean Block Storage}
  end

  subgraph External
    User[User / Browser]
    GitHubCR[GitHub Container Registry]
    LetsEncrypt[Let's Encrypt]
    DigitalOceanLB[DigitalOcean Load Balancer]
    DNS[DNS: kagi-principal-project.camlittle.com]
  end

  %% Ingress and Load Balancer
  User --> DNS
  DNS --> DigitalOceanLB
  DigitalOceanLB --> IngressNginx
  IngressNginx --> WebServer

  %% Web Server and Page Scraper
  WebServer --> OpenSearch --> PGPersistentVolume
  WebServer --> Postgres --> OSPersistentVolume
  PageScraper --> Postgres
  PageScraper --> OpenSearch

  %% OpenSearch Dashboards
  OpenSearchDash --> OpenSearch

  %% cert-manager and Let's Encrypt
  CertManager -->|ACME Challenge| LetsEncrypt
  CertManager --> IngressNginx

  %% Images from GitHub Container Registry
  GitHubCR --> WebServer
  GitHubCR --> PageScraper

  %% Secrets and Config
  CertManager -->|TLS Secrets| IngressNginx

  %% Highlight application code
  classDef appCode stroke-width:2px;
  class WebServer,PageScraper appCode;
```

## Choices

Current architecture and code choices balance speed, efficiency, and long-term flexibility. One major influence is [the twelve-factor app](https://12factor.net) methodology.

### Technologies

#### Production

- **[DigitalOcean](https://www.digitalocean.com)** (cloud provider)  
  I have an established DigitalOcean account I use for personal projects. I've attempted to use technologies that are portable to other providers (e.g. Kubernetes, block storage) rather than locking into specific offerings.
- **[Kubernetes (K8s)](https://kubernetes.io)** (container orchestration)  
  Kubernetes allows me to configure a lot of tricky things like networking, public ingress, and scaling in code. It also gives a lot of portability if I want to deploy to different providers or locally.
- **[Helm](https://helm.sh)** (k8s package management)  
  I've used Helm in one other project. It allows me to more efficiently manage my k8s configuration, and allows me to version lock and reproduce deployments of dependencies within a cluster.
- **[TypeScript](https://www.typescriptlang.org)** (language)  
  I use TypeScript for a few reasons. I'm very familiar with it, it's got a very strong and flexible type system (which helps prevent mistakes), and it's portable the browser and server environment (though I'm not taking advantage of this yet).
- **[Node.js](nodejs.org)** (runtime)  
  NodeJS is a stable and widely used runtime. I considered Bun or Deno, but don't see strong enough advantages right now. Since I'm using TypeScript that would be relatively easy to change in future.
- **[Express](https://expressjs.com)** (web framework)  
  Express is not the most modern web framework, but it's fast, simple, and widely used. I didn't want to choose a framework that's overloaded with features (e.g. built in SSR, has custom syntax, uses custom import standards) or would have too much lock-in.
- **[EJS](https://ejs.co/)** (UI templating)  
  EJS is fairly old school, and is something I'd expect to change in future. It's simple and safe though. In future I'd likely choose something with more composability and that would coordinate with client-side rendering and JS. (e.g. to have more locale-aware rendering and progressive enhancements)
- **[Pino](https://getpino.io)** (logging)  
  This is a new logging framework for me. I chose it for easy composable structured logging, and because it has transports to easily stream logs to ElasticSearch or OpenTelemetry in future, if that wasn't handled on the K8s side.
- **[Postgres](https://postgresql.org)** (relational database)  
  I wanted to use a relational database for simpler management and storage of data I'm not indexing for full-text search. Postgres is highly scalable and widely used, and I've used it before. I'm using the [`postgres`](https://github.com/porsager/postgres) client (new to me), which is very ergonomic and simple, but doesn't act as an ORM. I find it a little nicer than [`pg`](https://github.com/brianc/node-postgres) which I've used previously.
- **[OpenSearch](https://opensearch.org)** (search database)  
  Given I don't have a lot of depth with database, I chose one designed for the problem at hand (complex and full text searching, plugable ML search algorithms, vector embeddings, highly scalable and configurable, and fully open source and self hostable), rather than trying something more bespoke. I've considered using OpenSearch professionally in the past, but hadn't gotten the point of touching it. It was relatively easy to get set up locally and remotely. I disabled the security plugin to avoid dealing with HTTPS certificates. This isn't something I'd generally do in the real world, but in this case my Kubernetes cluster protects against public access.

#### Development

- **[Prettier](https://prettier.io)** (formatter)  
  I strongly prefer using prettier. It hugely cuts down on noise when reviewing PRs and examinging the history of a project (e.g. when using `git bisect` or trying to understand context).
- **[ESLint](https://eslint.org)** (linter)  
  This is the standard for TypeScript.
- **[`node:test`](https://nodejs.org/api/test.html)** (testing)  
  This was my first time using `node:test`. Previously, I've used a framework more tightly coupled to another framework (e.g. vitest when using Vite, Jest when using React). While nowadays those are all options, a quick scan of the `node:test` showed that it's pretty comprehensive. It's super simple, built-in, and I'm pretty happy with it. I'd likely change in future if I changed other frameworks or build tools.
- (bundler)
  I hand wrote my bundling scripts. I considered something like esbuild, Vite, or RollUp, but didn't want to spend the time configuring them. A simple shell script is simple and easier to debug.
- **[VSCode](https://code.visualstudio.com/)** (editor)  
  There are of newer, fancier editors out there, but VSCode is widely used and highly configurable. It's also what I'm used to.
- **[GitHub](https://github.com/)** (CI, code hosting, collaboration)  
  I have an established, paid, account already and like the products.

#### Patterns

- **Wide usage**  
  This makes it easier to debug and find help online, it makes it more likely a contributor will be able to jump in with minimal onboarding, and it makes it more likely it'll work.
- **Open**  
  I need to be able to self-host stuff for the scope of this project, since I don't have any money or a ton of resources to throw at it. I also need open source licensing.
- **Familiarity**  
  In order to rapidly develop, I wanted to avoid unnecessarily using brand-new technologies.
- **Simplicity**  
  Simple tools are more understandable and easier to change in the future.

I decided to manage my Databases directly in Kubernetes, even though both are available managed through DigitalOcean. This saves me money during this demo, and networking is slightly simpler.

## Challenges

### OpenSearch

The biggest challenge so far has been OpenSearch, since I'm brand new to it.

Getting it running locally was surprisingly easy, but it took me a couple tries to get the index's mappings figured out, disable the security plugin for the current, and quite a while to get deployed.

I'm also having major latency issues, which I think is because of my naive initial configuration and the resource constraints within my Kubernetes cluster. However, from my research, I'm confident this can be overcome by allocating more resources (especially memory), warming up, and allocating dedicated search and ingest nodes in the cluster. Moving to a managed offering (e.g. OpenSearch through DigitalOcean, ElasticSearch through AWS) would also potentially help.

### Storage provisioning

I hadn't used DigitalOcean's Kubernetes managed block storage before, and it took me a few tries to get it provisioned. Once I switched to a Helm deployment of OpenSearch I was able to find the appropriate `PersistentVolumeClaim` configuration for Postgres, which ended up being much simpler than expected.

### Page Ranking

The biggest unexpected challenge so far is languages. I'm not considering language in indexing or searching, and I see a lot of non-English results when testing. One contribution to this is that a lot of developer focused search terms are the same regardless of language, or are adopted words from English.

## Page Ranking

At this point, I haven't optimized page rankings.

I'm attempting to fetch the most relevant content of the page by looking for the `<main>` element (to avoid indexing content common to each page). I'm then stripping HTML and relying on OpenSearch's text search handling.

### In future

* I'd like to switch to a better tokenization heuristic, which OpenSearch should be able to do for me (I haven't verified stop words are removed, for example).
* As mentioned above, be language aware. (index and search on language, based primarily on the `Accept-Language` header during search and the `<html lang>` attribute during indexing).
* Add more user control. Since developers trend to be more towards "power-users", I think advanced search operators are more valuable. (e.g. search by specific language, use quotes for exact text matching, search by specific site)
* Code aware search. This is a much more complex feature, but allow searching for specific syntax (e.g.`===`, `?.`). This would likely require a specific tokenization algorithm (maybe run a lexer on `<pre>` tag contents?) and would be indexed separately from the normal text content.
