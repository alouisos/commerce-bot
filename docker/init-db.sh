#!/bin/bash
# Runs once on first start of an empty data volume. The main database
# `concierge` is created by POSTGRES_DB; add the test database here.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  CREATE DATABASE concierge_test;
SQL
