## Local development

Development is configured for VSCode.

Requires a locally installed node toolchain (currently targeting v22).

Spin up service dependencies with docker compose.

```bash
docker-compose up -d
```

Migrations are run automatically for postgres.

Run the http requests in `configure_opensearch.http` to configure OpenSearch (use the recommended `humao.rest-client` VSCode extension to run from within the editor)

After dependencies are running and configured, use the launch tasks to run the web server and crawler(s).

## Deploying

This project is deployed to a kubernetes cluster using Helm. After kubernetes credentials and connection is established in your local environment, run.

For initial setup:

```bash
helm install --create-namespace --namespace $NAMESPACE $DEPLOYMENT_NAME .
```

Migrations and database setup is currently manual:

```bash
# connect to the postgres instance
kubectl port-forward pods/postgres-{pod-identifier} 5432:5432
# from the migrations dir
cd postgres_migrations/
# use an environment with psql (I don't have it locally)
docker run -v $PWD:/app -w /app --rm -it --entrypoint bash --network=host postgres
# run a migration - this assumes macOS docker
psql -h host.docker.internal -U postgres -d postgres --password -a -f ./migrate_{number}.sql
```

## Data dump

### Postgres

Use `pg_dump` and `pg_restore` to dump and restore data.

Example to dump local:

```bash
docker run -v $PWD:/app -w /app --rm -it --entrypoint bash --network=host
pg_dump -h host.docker.internal -U postgres > ./bulk_data/postgres.sql
```

### OpenSearch

Use [`elasticdump`](https://github.com/elasticsearch-dump/elasticsearch-dump).

Example:

```bash
npx elasticdump \
  --type=data \
  --input=http://localhost:9200/page_content_2 \
  --output=./bulk_data/opensearch-data.json
```
