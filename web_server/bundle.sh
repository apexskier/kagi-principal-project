#! /bin/bash
set -e

# I'm using a hand rolled bundling script, since the project is small enough it
# feels worth it.
# this is pretty explicit and easy to debug. If the project grew a lot, it would
# be worth restructuring to use a bundler.

rm -rf bundle
mkdir bundle
cd bundle
mkdir web_server
mkdir db

cp ../dist/*.js web_server
cp ../../db/dist/*.js db
cp ../index.html web_server
cp ../*.ejs web_server
