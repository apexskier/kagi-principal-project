#! /bin/sh
set -e

# I'm using a hand rolled bundling script, since the project is small enough it
# feels worth it.
# this is pretty explicit and easy to debug. If the project grew a lot, it would
# be worth restructuring to use a bundler.

rm -rf ./bundle
mkdir ./bundle

cd ./bundle
mkdir -p ./crawlers/page_scraper
mkdir ./db

cp ../dist/*.js ./crawlers/page_scraper
cp ../../../db/dist/*.js ./db
