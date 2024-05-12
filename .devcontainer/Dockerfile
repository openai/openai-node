# syntax=docker/dockerfile:1
FROM debian:bookworm-slim AS stainless

RUN apt-get update && apt-get install -y \
  nodejs \
  npm \
  yarnpkg \
  && apt-get clean autoclean

# Ensure UTF-8 encoding
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# Yarn
RUN ln -sf /usr/bin/yarnpkg /usr/bin/yarn

WORKDIR /workspace

COPY package.json yarn.lock /workspace/

RUN yarn install

COPY . /workspace
